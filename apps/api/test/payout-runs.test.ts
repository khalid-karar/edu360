import { beforeAll, describe, expect, it } from "vitest";
import { makeHarness } from "./helpers/harness.js";
import { HOUR, makeMarket } from "./helpers/market.js";

// Payout runs sweep every eligible payment in the database, so this file has its own database.
let h: Awaited<ReturnType<typeof makeHarness>>;
let m: Awaited<ReturnType<typeof makeMarket>>;
beforeAll(async () => {
  h = await makeHarness();
  m = await makeMarket(h);
});

const run = (token: string) => h.call("POST", "/api/admin/finance/payout-runs", { token });
const mine = (res: { body: any }, teacherId: string) => (res.body.payouts as { id: string; teacherId: string; amountHalalas: number; status: string }[]).filter((p) => p.teacherId === teacherId);
const earnings = (token: string) => h.call("GET", "/api/teacher/earnings", { token }).then((r) => r.body);

describe("payout runs", () => {
  it("waits out the 48-hour dispute window, holds a first payout for a second approver, and pays", async () => {
    const t = await m.teacher();
    const l = await m.verified("learner");
    await m.completedLesson(l, t);
    const fin1 = await h.staff("finance_officer");

    // Inside the window: nothing to pay, and the teacher sees it as held.
    expect(mine(await run(fin1.token), t.id)).toEqual([]);
    expect(await earnings(t.token)).toMatchObject({ heldInDisputeWindowHalalas: 8000, availableForNextRunHalalas: 0 });

    h.clock.advance(49 * HOUR);
    const fin2 = await h.staff("finance_officer");
    expect(await earnings(t.token)).toMatchObject({ heldInDisputeWindowHalalas: 0, availableForNextRunHalalas: 8000 });
    const first = mine(await run(fin2.token), t.id);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ amountHalalas: 8000, status: "pending" });
    const id = first[0]!.id;

    const approver = await h.staff("finance_officer"); // fin1's 8-hour session ended long ago
    const act = (token: string, path: string, body: object = {}) => h.call("POST", `/api/admin/finance/payouts/${id}/${path}`, { token, body });
    expect((await act(fin2.token, "approve")).body.error).toBe("second_approver_required");
    expect((await act(approver.token, "mark-paid", { bankReference: "SARIE-1" })).body.error).toBe("invalid_state"); // cannot pay what is not approved
    expect((await act(approver.token, "approve")).body.status).toBe("approved");

    const detail = await h.call("GET", `/api/admin/finance/payouts/${id}`, { token: approver.token });
    expect(detail.body.teacher.iban).toBe("SA0380000000608010167519");
    expect(detail.body.lines).toHaveLength(1);
    expect((await h.db.query("SELECT 1 FROM audit_log WHERE action = 'finance.viewed_iban' AND target_id = $1", [id])).rowCount).toBe(1);
    expect(JSON.stringify((await h.call("GET", "/api/admin/finance/payouts", { token: approver.token })).body)).not.toContain("SA03800");

    expect((await act(approver.token, "mark-paid", { bankReference: "SARIE-884211" })).body.status).toBe("paid");
    expect((await act(approver.token, "mark-paid", { bankReference: "SARIE-884211" })).body.error).toBe("invalid_state");
    expect(await earnings(t.token)).toMatchObject({ paidHalalas: 8000, availableForNextRunHalalas: 0, inPayoutHalalas: 0 });
    expect((await earnings(t.token)).payouts[0]).toMatchObject({ status: "paid", bankReference: "SARIE-884211" });

    // Nothing is paid twice.
    expect(mine(await run(approver.token), t.id)).toEqual([]);

    // The next payout is approved by the run itself: the teacher already has a track record.
    await m.completedLesson(l, t, 12);
    h.clock.advance(49 * HOUR);
    const fin3 = await h.staff("finance_officer");
    const second = mine(await run(fin3.token), t.id);
    expect(second[0]).toMatchObject({ amountHalalas: 8000, status: "approved" });
  });

  it("holds a brand-new teacher's first payout for 14 days", async () => {
    const t = await m.teacher({ approvedAt: h.clock.now() });
    const l = await m.verified("learner");
    await m.completedLesson(l, t);
    h.clock.advance(49 * HOUR);
    const fin = await h.staff("finance_officer");
    expect(mine(await run(fin.token), t.id)).toEqual([]);
    const preview = await h.call("GET", "/api/admin/finance/payout-runs/preview", { token: fin.token });
    expect(preview.body.skipped.new_teacher_hold).toBeGreaterThan(0);
    h.clock.advance(14 * 24 * HOUR);
    const fin2 = await h.staff("finance_officer");
    expect(mine(await run(fin2.token), t.id)).toHaveLength(1);
  });

  it("skips payments that are in dispute, and pays them once the dispute is settled in the teacher's favour", async () => {
    const t = await m.teacher();
    const l = await m.verified("learner");
    const b = await m.completedLesson(l, t);
    await h.call("POST", `/api/bookings/${b.id}/dispute`, { token: l.token, body: { reason: "لم يتم تقديم الدرس كاملاً" } });
    h.clock.advance(49 * HOUR);
    const fin = await h.staff("finance_officer");
    expect(mine(await run(fin.token), t.id)).toEqual([]);
    const d = (await h.call("GET", "/api/admin/finance/disputes", { token: fin.token })).body.items.find((x: { bookingId: string }) => x.bookingId === b.id);
    await h.call("POST", `/api/admin/finance/disputes/${d.id}/decide`, { token: fin.token, body: { outcome: "release_to_teacher", note: "الدرس تم وفق الاتفاق" } });
    expect(mine(await run(fin.token), t.id)[0]).toMatchObject({ amountHalalas: 8000 });
  });

  it("pays a partly refunded lesson on what the teacher kept", async () => {
    const t = await m.teacher();
    const l = await m.verified("learner");
    const b = await m.completedLesson(l, t);
    await h.call("POST", `/api/bookings/${b.id}/dispute`, { token: l.token, body: { reason: "تأخر المعلم عن بداية الدرس" } });
    const fin = await h.staff("finance_officer");
    const d = (await h.call("GET", "/api/admin/finance/disputes", { token: fin.token })).body.items.find((x: { bookingId: string }) => x.bookingId === b.id);
    await h.call("POST", `/api/admin/finance/disputes/${d.id}/decide`, { token: fin.token, body: { outcome: "partial_refund", refundHalalas: 5000, note: "تعويض عن التأخير" } });
    h.clock.advance(49 * HOUR);
    const fin2 = await h.staff("finance_officer");
    // Kept 5000, 20% commission = 1000, teacher net 4000.
    expect(mine(await run(fin2.token), t.id)[0]).toMatchObject({ amountHalalas: 4000 });
  });

  it("skips teachers whose payouts are frozen", async () => {
    const t = await m.teacher();
    const l = await m.verified("learner");
    await m.completedLesson(l, t);
    await h.db.query("UPDATE teacher_profiles SET payouts_frozen = true WHERE user_id = $1", [t.id]);
    h.clock.advance(49 * HOUR);
    const fin = await h.staff("finance_officer");
    expect(mine(await run(fin.token), t.id)).toEqual([]);
    expect((await earnings(t.token)).payoutsFrozen).toBe(true);
    await h.db.query("UPDATE teacher_profiles SET payouts_frozen = false WHERE user_id = $1", [t.id]);
    expect(mine(await run(fin.token), t.id)).toHaveLength(1);
  });

  it("a failed transfer puts the payments back for the next run; a held payout can be released", async () => {
    const t = await m.teacher();
    const l = await m.verified("learner");
    await m.completedLesson(l, t);
    h.clock.advance(49 * HOUR);
    const a = await h.staff("finance_officer");
    const b = await h.staff("finance_officer");
    const created = mine(await run(a.token), t.id)[0]!;
    const act = (token: string, path: string, body: object = {}) => h.call("POST", `/api/admin/finance/payouts/${created.id}/${path}`, { token, body });

    expect((await act(b.token, "hold", { note: "التحقق من الحساب البنكي" })).body.status).toBe("on_hold");
    expect((await act(b.token, "approve")).body.status).toBe("approved");
    expect((await act(b.token, "fail", { note: "رفض البنك الحوالة" })).body.status).toBe("failed");
    expect((await h.db.query("SELECT payout_id FROM payments p JOIN bookings k ON k.id = p.booking_id WHERE k.teacher_id = $1", [t.id])).rows[0]).toEqual({ payout_id: null });

    const again = mine(await run(a.token), t.id);
    expect(again).toHaveLength(1);
    expect(again[0]!.id).not.toBe(created.id);
    expect(again[0]!.amountHalalas).toBe(8000);
  });

  it("two runs at the same time still pay each payment once", async () => {
    const t = await m.teacher();
    const l = await m.verified("learner");
    await m.completedLesson(l, t);
    h.clock.advance(49 * HOUR);
    const a = await h.staff("finance_officer");
    const b = await h.staff("finance_officer");
    await Promise.all([run(a.token), run(b.token)]);
    const n = await h.db.query<{ n: number }>("SELECT count(*)::int AS n FROM payouts WHERE teacher_id = $1 AND status <> 'failed'", [t.id]);
    expect(n.rows[0]!.n).toBe(1);
  });

  it("is closed to everyone but finance officers, and teachers only see their own money", async () => {
    const l = await m.verified("learner");
    const t = await m.teacher();
    const safety = await h.staff("safety_officer");
    const admin = await h.staff("super_admin");
    for (const tok of [l.token, t.token, safety.token, admin.token]) {
      expect((await h.call("POST", "/api/admin/finance/payout-runs", { token: tok })).status).toBe(403);
      expect((await h.call("GET", "/api/admin/finance/payouts", { token: tok })).status).toBe(403);
    }
    expect((await h.call("GET", "/api/teacher/earnings", { token: l.token })).status).toBe(403);
    expect((await h.call("GET", "/api/teacher/earnings")).status).toBe(401);
  });
});
