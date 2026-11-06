import { beforeAll, describe, expect, it } from "vitest";
import { teacherCompensation } from "../src/domain/guarantee.js";
import { makeHarness } from "./helpers/harness.js";
import { HOUR, PRICE, makeMarket } from "./helpers/market.js";

let h: Awaited<ReturnType<typeof makeHarness>>;
let m: Awaited<ReturnType<typeof makeMarket>>;
beforeAll(async () => {
  h = await makeHarness();
  m = await makeMarket(h);
});

/** A finished, paid lesson. Reuse a learner or teacher to build a history between the same two people. */
async function lesson(opts: { learner?: { token: string; id: string }; teacher?: { token: string; id: string }; hour?: number } = {}) {
  const learner = opts.learner ?? (await m.verified("learner"));
  const teacher = opts.teacher ?? (await m.teacher());
  const booking = await m.completedLesson(learner, teacher, opts.hour ?? 9);
  return { learner, teacher, booking: { ...booking, priceHalalas: PRICE } };
}

const status = async (token: string, id: string) => (await h.call("GET", `/api/bookings/${id}/guarantee`, { token })).body as { eligible: boolean; reason?: string };
const claim = (token: string, id: string, why = "not_a_good_fit") => h.call("POST", `/api/bookings/${id}/guarantee`, { token, body: { why } });

describe("the rule", () => {
  it("gives the teacher half of a first lesson's normal net, rounded down", () => {
    expect(teacherCompensation(10_000)).toBe(4_000); // 20% commission -> net 8,000 -> half
    expect(teacherCompensation(10_001)).toBe(Math.floor(((10_001 - Math.floor((10_001 * 2000 + 5000) / 10_000)) * 5000) / 10_000));
  });
});

describe("claiming", () => {
  it("refunds the whole lesson at the provider, tops the teacher up, and shows in earnings and the payout run", async () => {
    const mk = await lesson();
    const { learner: l, teacher: t, booking: b } = mk;
    expect(await status(l.token, b.id)).toMatchObject({ eligible: true });
    expect((await status(t.token, b.id)).reason).toBe("not_payer");

    const r = await claim(l.token, b.id);
    expect(r.status).toBe(200);
    expect(r.body.refundedHalalas).toBe(b.priceHalalas);
    expect(await m.providerStatus(b.paymentId)).toBe("refunded");

    const row = (await h.db.query<{ status: string; refunded_halalas: number; commission_halalas: number; platform_credit_halalas: number }>("SELECT status, refunded_halalas, commission_halalas, platform_credit_halalas FROM payments WHERE booking_id = $1", [b.id])).rows[0]!;
    expect(row).toMatchObject({ status: "refunded", refunded_halalas: b.priceHalalas, commission_halalas: 0, platform_credit_halalas: teacherCompensation(b.priceHalalas) });

    // the learner sees a full refund, the teacher sees the platform top-up
    expect(r.body.booking.payment).toMatchObject({ refundedHalalas: b.priceHalalas });
    const tv = (await h.call("GET", `/api/bookings/${b.id}`, { token: t.token })).body;
    expect(tv.payment).toMatchObject({ platformCreditHalalas: teacherCompensation(b.priceHalalas), netHalalas: teacherCompensation(b.priceHalalas) });
    const earn = (await h.call("GET", "/api/teacher/earnings", { token: t.token })).body;
    expect(earn.heldInDisputeWindowHalalas + earn.availableForNextRunHalalas).toBe(teacherCompensation(b.priceHalalas));

    // it is a system-decided dispute, so it can neither be claimed again nor disputed afterwards
    expect((await claim(l.token, b.id)).body).toMatchObject({ error: "guarantee_unavailable", details: { reason: "dispute_exists" } });
    expect((await h.call("POST", `/api/bookings/${b.id}/dispute`, { token: l.token, body: { reason: "ثاني اعتراض على نفس الدرس لا يجوز" } })).status).toBe(409);

    // after the window the credit is paid out like any earning
    h.clock.advance(49 * HOUR);
    const fin = await h.staff("finance_officer");
    const prev = await h.call("GET", "/api/admin/finance/payout-runs/preview", { token: fin.token });
    const mine = prev.body.batches.find((x: { teacherId: string }) => x.teacherId === t.id);
    expect(mine?.amount).toBe(teacherCompensation(b.priceHalalas));
    const list = await h.call("GET", "/api/admin/finance/disputes?status=decided", { token: fin.token });
    expect(list.body.items.find((x: { bookingId: string }) => x.bookingId === b.id)?.kind).toBe("guarantee");
    const inbox = (await h.call("GET", "/api/notifications", { token: t.token })).body.items as { kind: string }[];
    expect(inbox.some((n) => n.kind === "guarantee_claimed")).toBe(true);
  });

  it("is only for the first lesson with that teacher", async () => {
    const first = await lesson();
    const t = first.teacher;
    const l = first.learner;
    // a second completed lesson with the same teacher is not covered
    const second = await lesson({ teacher: t, learner: l });
    expect(await status(l.token, second.booking.id)).toMatchObject({ eligible: false, reason: "not_first_lesson" });
    // the first one was the first, but its window closed long ago
    expect((await status(l.token, first.booking.id)).reason).toBe("window_closed");
  });

  it("closes when the dispute window ends", async () => {
    const mk = await lesson();
    h.clock.advance(49 * HOUR);
    expect(await status(mk.learner.token, mk.booking.id)).toMatchObject({ eligible: false, reason: "window_closed" });
    expect((await claim(mk.learner.token, mk.booking.id)).status).toBe(409);
  });

  it("is not available once the lesson is already disputed, or before it is completed", async () => {
    const mk = await lesson();
    await h.call("POST", `/api/bookings/${mk.booking.id}/dispute`, { token: mk.learner.token, body: { reason: "اعتراض عادي وليس ضماناً للدرس" } });
    expect((await status(mk.learner.token, mk.booking.id)).reason).toBe("dispute_exists");

    const t = await m.teacher();
    const l = await m.verified("learner");
    await m.openWindow(t, 2);
    const b = await m.bookAndPay(l, t, m.at(2, 9));
    expect((await status(l.token, b.id)).reason).toBe("not_completed");
    expect((await claim(l.token, b.id)).status).toBe(409);
  });

  it("limits each learner to three claims", async () => {
    const l = await m.verified("learner");
    for (let i = 0; i < 3; i++) {
      const mk = await lesson({ learner: l });
      expect((await claim(l.token, mk.booking.id)).status).toBe(200);
    }
    const fourth = await lesson({ learner: l });
    expect(await status(l.token, fourth.booking.id)).toMatchObject({ eligible: false, reason: "learner_limit_reached" });
  });

  it("does not touch the learner's money when the provider refuses", async () => {
    const mk = await lesson();
    const real = h.payments.refund.bind(h.payments);
    h.payments.refund = async () => { throw new Error("provider down"); };
    const r = await claim(mk.learner.token, mk.booking.id);
    expect(r.status).toBeGreaterThanOrEqual(400);
    h.payments.refund = real;
    expect((await h.db.query<{ status: string }>("SELECT status FROM payments WHERE booking_id = $1", [mk.booking.id])).rows[0]!.status).toBe("captured");
    expect((await h.db.query("SELECT 1 FROM disputes WHERE booking_id = $1", [mk.booking.id])).rowCount).toBe(0);
    expect((await claim(mk.learner.token, mk.booking.id)).status).toBe(200);
  });
});
