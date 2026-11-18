import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { makeHarness } from "./helpers/harness.js";
import { HOUR, makeMarket, PRICE } from "./helpers/market.js";

let h: Awaited<ReturnType<typeof makeHarness>>;
let m: Awaited<ReturnType<typeof makeMarket>>;
beforeAll(async () => {
  h = await makeHarness({ defaultRates: true });
  m = await makeMarket(h);
});

// Every test starts from the shipped defaults, whatever an earlier test set.
beforeEach(async () => {
  await h.db.query("UPDATE platform_settings SET value = $1 WHERE key = 'commission'", [JSON.stringify({ founderLimit: 100, founder: { initialBps: 500, afterBps: 300, threshold: 10 }, standard: { initialBps: 1500, afterBps: 1000, threshold: 10 } })]);
});

const boss = async () => (await h.staff("super_admin")).token;
const setPolicy = async (policy: unknown) => h.call("PUT", "/api/admin/settings/commission", { token: await boss(), body: policy });
const code = async (body: Record<string, unknown>) => h.call("POST", "/api/admin/discount-codes", { token: await boss(), body: { label: "عرض", kind: "percent", value: 20, ...body } });
const book = (token: string, teacherId: string, start: Date, discountCode?: string) =>
  h.call("POST", "/api/bookings", { token, body: { teacherId, categoryId: m.catId, startsAt: start.toISOString(), ...(discountCode ? { discountCode } : {}) } });

/** Books, pays what the booking asks, the teacher accepts and completes. Returns the booking id. */
async function lesson(l: { token: string }, t: { id: string; token: string }, hour: number, discountCode?: string) {
  await m.openWindow(t, 2, 6, 18).catch(() => {}); // the window may already be open
  const start = m.at(2, hour);
  const b = await book(l.token, t.id, start, discountCode);
  expect(b.status).toBe(201);
  const pay = h.payments.authorize(b.body.amountHalalas, { booking_id: b.body.bookingId });
  expect((await h.call("POST", `/api/bookings/${b.body.bookingId}/payment`, { token: l.token, body: { paymentId: pay.id } })).status).toBe(200);
  await h.call("POST", `/api/bookings/${b.body.bookingId}/accept`, { token: t.token });
  m.goTo(new Date(start.getTime() + 2 * HOUR));
  const done = await h.call("POST", `/api/bookings/${b.body.bookingId}/complete`, { token: t.token });
  expect(done.status).toBe(200);
  return { id: b.body.bookingId as string, done: done.body, booking: b.body };
}

describe("commission policy settings", () => {
  it("is the super admin's alone, validated, and audited", async () => {
    const policy = (await h.call("GET", "/api/admin/settings/commission", { token: await boss() })).body.policy;
    expect(policy).toEqual({ founderLimit: 100, founder: { initialBps: 500, afterBps: 300, threshold: 10 }, standard: { initialBps: 1500, afterBps: 1000, threshold: 10 } });
    for (const role of ["vetting_officer", "safety_officer", "finance_officer"]) {
      const tok = (await h.staff(role)).token;
      expect((await h.call("GET", "/api/admin/settings/commission", { token: tok })).status).toBe(403);
      expect((await h.call("PUT", "/api/admin/settings/commission", { token: tok, body: policy })).status).toBe(403);
    }
    expect((await setPolicy({ ...policy, standard: { initialBps: 6000, afterBps: 1000, threshold: 10 } })).status).toBe(400); // 60% is refused
    expect((await setPolicy({ ...policy, standard: { initialBps: 1500, afterBps: 1000, threshold: 0 } })).status).toBe(400);
    expect((await setPolicy({ ...policy, extra: 1 })).status).toBe(400);
    expect((await setPolicy({ ...policy, standard: { initialBps: 1200, afterBps: 800, threshold: 10 } })).status).toBe(200);
    const log = await h.db.query("SELECT 1 FROM audit_log WHERE action = 'settings.commission_changed'");
    expect(log.rowCount).toBe(1);
    expect((await setPolicy(policy)).status).toBe(200);
  });
});

describe("rates follow the teacher's group and the number of lessons", () => {
  it("charges a founding teacher 5% then 3% after 10 lessons, and everyone else 15% then 10%", async () => {
    await setPolicy({ founderLimit: 100, founder: { initialBps: 500, afterBps: 300, threshold: 2 }, standard: { initialBps: 1500, afterBps: 1000, threshold: 2 } });
    const founder = await m.teacher();
    const regular = await m.teacher();
    await h.db.query("UPDATE teacher_profiles SET founding = true WHERE user_id = $1", [founder.id]);
    const l = await m.verified("learner");
    const rows: Record<string, number[]> = { founder: [], regular: [] };
    let hour = 6;
    for (let i = 0; i < 3; i++) {
      for (const [name, t] of [["founder", founder], ["regular", regular]] as const) {
        const b = await lesson(l, t, hour++);
        rows[name]!.push(b.done.payment.commissionHalalas);
      }
    }
    // threshold 2: lessons 1 and 2 at the initial rate, lesson 3 at the lower rate
    expect(rows.founder).toEqual([500, 500, 300]);
    expect(rows.regular).toEqual([1500, 1500, 1000]);
    const stored = await h.db.query<{ commission_bps: number }>("SELECT p.commission_bps FROM payments p JOIN bookings b ON b.id = p.booking_id WHERE b.teacher_id = $1 ORDER BY p.captured_at", [founder.id]);
    expect(stored.rows.map((r) => r.commission_bps)).toEqual([500, 500, 300]);
  });

  it("a later settings change does not rewrite what was already settled, and a refund uses the stored rate", async () => {
    await setPolicy({ founderLimit: 100, founder: { initialBps: 500, afterBps: 300, threshold: 10 }, standard: { initialBps: 1500, afterBps: 1000, threshold: 10 } });
    const t = await m.teacher();
    const l = await m.verified("learner");
    const b = await lesson(l, t, 6);
    expect(b.done.payment.commissionHalalas).toBe(1500);
    await setPolicy({ founderLimit: 100, founder: { initialBps: 500, afterBps: 300, threshold: 10 }, standard: { initialBps: 3000, afterBps: 3000, threshold: 10 } });
    const finance = (await h.staff("finance_officer")).token;
    const d = await h.call("POST", `/api/bookings/${b.id}/dispute`, { token: l.token, body: { reason: "الدرس لم يكن كما وُصف تماماً في الإعلان" } });
    expect(d.status).toBe(201);
    const dec = await h.call("POST", `/api/admin/finance/disputes/${d.body.id}/decide`, { token: finance, body: { outcome: "partial_refund", refundHalalas: 5000, note: "استرداد جزئي" } });
    expect(dec.status).toBe(200);
    const p = (await h.db.query<{ commission_halalas: number }>("SELECT commission_halalas FROM payments WHERE booking_id = $1", [b.id])).rows[0]!;
    expect(p.commission_halalas).toBe(750); // 15% of the 5,000 kept, not the new 30%
  });
});

describe("discount codes", () => {
  it("are created by the super admin only, with unique upper-case codes", async () => {
    expect((await code({ code: "founding-day", value: 20 })).status).toBe(201); // upper-cased
    expect((await code({ code: "FOUNDING-DAY" })).body.error).toBe("code_taken");
    expect((await code({ code: "AB" })).status).toBe(400);
    expect((await code({ code: "BIG95", value: 95 })).status).toBe(400);
    expect((await code({ code: "BACKWARDS", startsAt: "2026-12-01T00:00:00Z", endsAt: "2026-11-01T00:00:00Z" })).status).toBe(400);
    const tok = (await h.staff("finance_officer")).token;
    expect((await h.call("POST", "/api/admin/discount-codes", { token: tok, body: { code: "NOPE", label: "عرض", kind: "percent", value: 10 } })).status).toBe(403);
    expect((await h.call("GET", "/api/admin/discount-codes", { token: tok })).status).toBe(403);
    const list = await h.call("GET", "/api/admin/discount-codes", { token: await boss() });
    expect(list.body.items.map((c: { code: string }) => c.code)).toContain("FOUNDING-DAY");
  });

  it("lowers what the learner pays but not what the teacher earns; the platform tops up", async () => {
    await code({ code: "SAVE20", value: 20 });
    const t = await m.teacher();
    const l = await m.verified("learner");
    const q = await h.call("POST", "/api/bookings/quote", { token: l.token, body: { teacherId: t.id, categoryId: m.catId, code: "save20" } });
    expect(q.body).toEqual({ listHalalas: PRICE, discountHalalas: 2000, payHalalas: 8000 });
    const b = await lesson(l, t, 6, "save20");
    expect(b.booking).toMatchObject({ amountHalalas: 8000, listHalalas: PRICE });
    // standard teacher, first lesson: 15% of the 100 SAR price = 15; learner paid 80; platform adds 20; teacher nets 85
    expect(b.done.payment).toMatchObject({ capturedHalalas: 8000, commissionHalalas: 1500, platformCreditHalalas: 2000, netHalalas: 8500 });
    const lv = await h.call("GET", `/api/bookings/${b.id}`, { token: l.token });
    expect(lv.body.payment).toEqual({ status: "captured", capturedHalalas: 8000, refundedHalalas: 0 }); // the learner sees only what they paid
  });

  it("refuses unknown, disabled, not-yet-started, expired, exhausted and already-used codes", async () => {
    const t = await m.teacher();
    const l = await m.verified("learner");
    await m.openWindow(t, 3, 6, 18);
    const day = (hour: number) => m.at(3, hour);
    const q = (c: string) => h.call("POST", "/api/bookings/quote", { token: l.token, body: { teacherId: t.id, categoryId: m.catId, code: c } });
    expect((await q("NOPE")).body.error).toBe("code_invalid");

    const off = (await code({ code: "OFFCODE" })).body.id;
    await h.call("POST", `/api/admin/discount-codes/${off}/active`, { token: await boss(), body: { active: false } });
    expect((await q("OFFCODE")).body.error).toBe("code_invalid");

    const now = h.clock.now().getTime();
    await code({ code: "SOON", startsAt: new Date(now + 5 * HOUR).toISOString() });
    expect((await q("SOON")).body.error).toBe("code_not_started");
    await code({ code: "GONE", startsAt: new Date(now - 5 * HOUR).toISOString(), endsAt: new Date(now - HOUR).toISOString() });
    expect((await q("GONE")).body.error).toBe("code_expired");

    await code({ code: "ONLYONE", maxUses: 1, perUserLimit: 5 });
    expect((await book(l.token, t.id, day(6), "ONLYONE")).status).toBe(201);
    const other = await m.verified("learner");
    const tooLate = await book(other.token, t.id, day(8), "ONLYONE");
    expect(tooLate.body.error).toBe("code_exhausted");

    await code({ code: "ONCE", perUserLimit: 1 });
    expect((await book(l.token, t.id, day(10), "ONCE")).status).toBe(201);
    expect((await book(l.token, t.id, day(12), "once")).body.error).toBe("code_already_used");
  });

  it("a hold that expires frees the use; a fixed code never takes the price below 1 SAR", async () => {
    await code({ code: "LASTONE", maxUses: 1, perUserLimit: 3 });
    const t = await m.teacher();
    await m.openWindow(t, 4, 6, 18);
    const a = await m.verified("learner");
    const c = await m.verified("learner");
    expect((await book(a.token, t.id, m.at(4, 6), "LASTONE")).status).toBe(201);
    expect((await book(c.token, t.id, m.at(4, 8), "LASTONE")).body.error).toBe("code_exhausted");
    h.clock.advance(20 * 60_000); // the 15-minute payment hold lapses
    expect((await book(c.token, t.id, m.at(4, 8), "LASTONE")).status).toBe(201);

    await code({ code: "HUGE", kind: "fixed", value: 999_999, perUserLimit: 5 });
    const q = await h.call("POST", "/api/bookings/quote", { token: a.token, body: { teacherId: t.id, categoryId: m.catId, code: "HUGE" } });
    expect(q.body).toEqual({ listHalalas: PRICE, discountHalalas: PRICE - 100, payHalalas: 100 });
  });

  it("is for learners and guardians, and the code field is validated", async () => {
    const t = await m.teacher();
    const tt = await m.teacher();
    expect((await h.call("POST", "/api/bookings/quote", { token: tt.token, body: { teacherId: t.id, categoryId: m.catId, code: "SAVE20" } })).status).toBe(403);
    const l = await m.verified("learner");
    expect((await h.call("POST", "/api/bookings/quote", { token: l.token, body: { teacherId: t.id, categoryId: m.catId, code: "" } })).status).toBe(400);
    expect((await h.call("POST", "/api/bookings/quote", { body: { teacherId: t.id, categoryId: m.catId, code: "X" } })).status).toBe(401);
  });
});

describe("a discounted lesson in the refund paths", () => {
  it("the first-lesson guarantee refunds what the learner paid and tops the teacher up on their real net", async () => {
    await setPolicy({ founderLimit: 100, founder: { initialBps: 500, afterBps: 300, threshold: 10 }, standard: { initialBps: 1500, afterBps: 1000, threshold: 10 } });
    await code({ code: "GUARANTEED", value: 20 });
    const t = await m.teacher();
    const l = await m.verified("learner");
    const b = await lesson(l, t, 6, "GUARANTEED");
    const r = await h.call("POST", `/api/bookings/${b.id}/guarantee`, { token: l.token, body: { why: "not_a_good_fit" } });
    expect(r.status).toBe(200);
    expect(r.body.refundedHalalas).toBe(8000);
    const p = (await h.db.query<{ platform_credit_halalas: number; commission_halalas: number }>("SELECT platform_credit_halalas, commission_halalas FROM payments WHERE booking_id = $1", [b.id])).rows[0]!;
    expect(p.commission_halalas).toBe(0);
    expect(p.platform_credit_halalas).toBe(4250); // half of the teacher's normal net of 85.00
  });
});
