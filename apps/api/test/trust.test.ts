import { beforeAll, describe, expect, it } from "vitest";
import { liftExpiredSuspensions } from "../src/services/trust.js";
import { makeHarness } from "./helpers/harness.js";
import { HOUR, PRICE, makeMarket } from "./helpers/market.js";

let h: Awaited<ReturnType<typeof makeHarness>>;
let m: Awaited<ReturnType<typeof makeMarket>>;
beforeAll(async () => {
  h = await makeHarness();
  m = await makeMarket(h);
});

const LONG = "سلوك غير لائق أثناء الدرس ويحتاج مراجعة";

describe("reports", () => {
  it("lets either side report the other, derives who is reported, and stops duplicates and floods", async () => {
    const t = await m.teacher();
    const l = await m.verified("learner");
    await m.openWindow(t, 2);
    const b = await m.bookAndPay(l, t, m.at(2, 9));

    const r = await h.call("POST", "/api/reports", { token: l.token, body: { bookingId: b.id, category: "conduct", reason: LONG } });
    expect(r.status).toBe(201);
    const row = await h.db.query<{ reported_user_id: string; reporter_id: string }>("SELECT reported_user_id, reporter_id FROM reports WHERE id = $1", [r.body.id]);
    expect(row.rows[0]).toEqual({ reported_user_id: t.id, reporter_id: l.id });
    expect((await h.call("POST", "/api/reports", { token: l.token, body: { bookingId: b.id, category: "conduct", reason: LONG } })).body.error).toBe("report_exists");

    const back = await h.call("POST", "/api/reports", { token: t.token, body: { bookingId: b.id, category: "no_show", reason: "المتعلم لم يحضر في الموعد المحدد" } });
    expect(back.status).toBe(201);
    expect((await h.db.query<{ reported_user_id: string }>("SELECT reported_user_id FROM reports WHERE id = $1", [back.body.id])).rows[0]!.reported_user_id).toBe(l.id);

    const stranger = await m.verified("learner");
    expect((await h.call("POST", "/api/reports", { token: stranger.token, body: { bookingId: b.id, category: "other", reason: LONG } })).status).toBe(404);
    expect((await h.call("POST", "/api/reports", { token: l.token, body: { bookingId: b.id, category: "other", reason: "قصير" } })).status).toBe(400);

    const mine = await h.call("GET", "/api/reports/mine", { token: l.token });
    expect(mine.body.items).toHaveLength(1);
    expect(JSON.stringify(mine.body)).not.toContain(t.id); // reporters learn the status, not who handles it or what was decided
  });

  it("limits a user to five reports a day", async () => {
    const l = await m.verified("learner");
    const t = await m.teacher();
    await m.openWindow(t, 2, 6, 18);
    let last;
    for (let i = 0; i < 6; i++) {
      const b = await m.bookAndPay(l, t, m.at(2, 7 + i * 2));
      last = await h.call("POST", "/api/reports", { token: l.token, body: { bookingId: b.id, category: "other", reason: `${LONG} ${i}` } });
    }
    expect(last!.status).toBe(429);
  });
});

describe("safety queue", () => {
  it("works the queue: safety reports first, claim, read the chat (audited), resolve only your own", async () => {
    const t = await m.teacher();
    const l = await m.verified("learner");
    await m.openWindow(t, 2);
    const b = await m.bookAndPay(l, t, m.at(2, 9));
    await h.call("POST", `/api/bookings/${b.id}/messages`, { token: t.token, body: { body: "كلمني على 0551234567" } }); // blocked, flagged
    const other = await h.call("POST", "/api/reports", { token: l.token, body: { bookingId: b.id, category: "other", reason: LONG } });
    expect(other.status).toBe(201);
    const l2 = await m.verified("learner");
    const t2 = await m.teacher();
    await m.openWindow(t2, 3);
    const b2 = await m.bookAndPay(l2, t2, m.at(3, 9));
    const urgent = await h.call("POST", "/api/reports", { token: l2.token, body: { bookingId: b2.id, category: "safety", reason: LONG } });

    const officer = await h.staff("safety_officer");
    const q = await h.call("GET", "/api/admin/safety/queue", { token: officer.token });
    const ids = q.body.reports.map((r: { id: string }) => r.id);
    expect(ids.indexOf(urgent.body.id)).toBeLessThan(ids.indexOf(other.body.id));
    expect(q.body.flags.length).toBeGreaterThan(0);

    const detail = await h.call("GET", `/api/admin/safety/reports/${other.body.id}`, { token: officer.token });
    expect(detail.body.messages[0]).toMatchObject({ blocked: true, blockReason: expect.any(String) });
    expect(JSON.stringify(detail.body)).not.toContain("1234567891"); // no national IDs
    expect((await h.db.query("SELECT 1 FROM audit_log WHERE action = 'safety.viewed_report' AND actor_id = $1", [officer.id])).rowCount).toBe(1);

    const resolve = (token: string) => h.call("POST", `/api/admin/safety/reports/${other.body.id}/resolve`, { token, body: { outcome: "resolved", note: "تمت المراجعة واتخاذ الإجراء" } });
    expect((await resolve(officer.token)).body.error).toBe("invalid_state"); // not claimed yet
    expect((await h.call("POST", `/api/admin/safety/reports/${other.body.id}/claim`, { token: officer.token })).status).toBe(200);
    expect((await h.call("POST", `/api/admin/safety/reports/${other.body.id}/claim`, { token: officer.token })).status).toBe(409);
    const colleague = await h.staff("safety_officer");
    expect((await resolve(colleague.token)).body.error).toBe("not_assigned_to_you");
    expect((await resolve(officer.token)).status).toBe(200);
    expect((await h.call("GET", "/api/reports/mine", { token: l.token })).body.items[0].status).toBe("resolved");
  });

  it("reviews rule flags and audits it", async () => {
    const officer = await h.staff("safety_officer");
    const q = await h.call("GET", "/api/admin/safety/queue", { token: officer.token });
    const f = q.body.flags[0];
    const view = await h.call("GET", `/api/admin/safety/flags/${f.id}`, { token: officer.token });
    expect(view.body.message.body).toContain("0551234567");
    expect((await h.call("POST", `/api/admin/safety/flags/${f.id}/review`, { token: officer.token, body: { outcome: "confirmed", note: "تأكد التسريب" } })).status).toBe(200);
    expect((await h.call("POST", `/api/admin/safety/flags/${f.id}/review`, { token: officer.token, body: { outcome: "dismissed", note: "تأكد التسريب" } })).status).toBe(409);
    expect((await h.db.query("SELECT 1 FROM audit_log WHERE action = 'safety.flag_reviewed' AND target_id = $1", [f.id])).rowCount).toBe(1);
  });

  it("is closed to everyone but safety officers", async () => {
    const l = await m.verified("learner");
    const fin = await h.staff("finance_officer");
    const admin = await h.staff("super_admin");
    for (const tok of [l.token, fin.token, admin.token]) expect((await h.call("GET", "/api/admin/safety/queue", { token: tok })).status).toBe(403);
    expect((await h.call("GET", "/api/admin/safety/queue")).status).toBe(401);
  });
});

describe("strikes", () => {
  const strike = (token: string, userId: string, body: object = {}) => h.call("POST", `/api/admin/safety/users/${userId}/strike`, { token, body: { reason: LONG, ...body } });

  it("climbs the ladder: warning, 14-day suspension with the teacher removed and lessons cancelled, then a ban", async () => {
    const t = await m.teacher();
    const l = await m.verified("learner");
    await m.openWindow(t, 2);
    const b = await m.bookAndPay(l, t, m.at(2, 9));
    await h.call("POST", `/api/bookings/${b.id}/accept`, { token: t.token });
    const officer = await h.staff("safety_officer");

    const one = await strike(officer.token, t.id);
    expect(one.body).toMatchObject({ level: 1, action: "warn", cancelledBookings: 0 });
    expect((await h.call("GET", "/api/auth/me", { token: t.token })).body.status).toBe("active");

    const two = await strike(officer.token, t.id);
    expect(two.body).toMatchObject({ level: 2, action: "suspend_14d", cancelledBookings: 1 });
    expect(await m.providerStatus(b.paymentId)).toBe("voided"); // the learner is not charged
    expect((await h.db.query<{ status: string; cancelled_by: string }>("SELECT status, cancelled_by FROM bookings WHERE id = $1", [b.id])).rows[0]).toEqual({ status: "cancelled", cancelled_by: "system" });
    const prof = await h.db.query<{ status: string; payouts_frozen: boolean }>("SELECT status, payouts_frozen FROM teacher_profiles WHERE user_id = $1", [t.id]);
    expect(prof.rows[0]).toEqual({ status: "suspended", payouts_frozen: true });
    expect((await h.call("GET", `/api/teachers/${t.id}`, { token: l.token })).status).toBe(404);
    expect((await h.call("GET", "/api/teacher/me", { token: t.token })).status).toBe(403);
    const own = await h.call("GET", "/api/account/strikes", { token: t.token });
    expect(own.body.status).toBe("suspended");
    expect(own.body.strikes).toHaveLength(2);

    // After 14 days the suspension ends on its own and the teacher is back in search.
    h.clock.advance(14 * 24 * HOUR + 60_000);
    expect(await liftExpiredSuspensions(h.db, h.clock.now())).toBeGreaterThan(0);
    expect((await h.db.query<{ status: string; payouts_frozen: boolean }>("SELECT status, payouts_frozen FROM teacher_profiles WHERE user_id = $1", [t.id])).rows[0]).toEqual({ status: "approved", payouts_frozen: false });
    expect((await h.call("GET", `/api/teachers/${t.id}`, { token: l.token })).status).toBe(200);

    const later = await h.staff("safety_officer"); // the first officer's 8-hour session has long expired
    const three = await strike(later.token, t.id);
    expect(three.body).toMatchObject({ level: 3, action: "ban" });
    expect((await h.call("GET", "/api/teacher/earnings", { token: t.token })).body.error).toBe("account_banned");
    expect((await strike(later.token, t.id)).body.error).toBe("already_banned");
    expect(await liftExpiredSuspensions(h.db, h.clock.now())).toBe(0); // a ban is never lifted by the sweep
  });

  it("zero-tolerance conduct is an instant ban", async () => {
    const t = await m.teacher();
    const officer = await h.staff("safety_officer");
    const r = await strike(officer.token, t.id, { zeroTolerance: true });
    expect(r.body).toMatchObject({ level: 3, action: "ban" });
    expect((await h.db.query<{ status: string }>("SELECT status FROM users WHERE id = $1", [t.id])).rows[0]!.status).toBe("banned");
  });

  it("applies to learners too, ties to a report, and cannot target staff, children, strangers or the wrong report", async () => {
    const officer = await h.staff("safety_officer");
    const l = await m.verified("learner");
    const t = await m.teacher();
    await m.openWindow(t, 2);
    const b = await m.bookAndPay(l, t, m.at(2, 9));
    const rep = await h.call("POST", "/api/reports", { token: t.token, body: { bookingId: b.id, category: "conduct", reason: LONG } });
    expect((await strike(officer.token, t.id, { reportId: rep.body.id })).body.error).toBe("report_mismatch"); // the report is against the learner
    const ok = await strike(officer.token, l.id, { reportId: rep.body.id });
    expect(ok.body.action).toBe("warn");
    expect((await h.call("GET", `/api/admin/safety/users/${l.id}/strikes`, { token: officer.token })).body.strikes).toHaveLength(1);

    const g = await m.verified("guardian");
    const kid = (await h.call("POST", "/api/guardian/children", { token: g.token, body: { displayName: "طفل", birthYear: h.clock.now().getUTCFullYear() - 9, gender: "male" } })).body;
    expect((await strike(officer.token, kid.id)).body.error).toBe("cannot_strike_role");
    expect((await strike(officer.token, officer.id)).body.error).toBe("cannot_strike_role");
    expect((await strike(officer.token, "00000000-0000-4000-8000-000000000000")).status).toBe(404);
    expect((await strike(officer.token, l.id, { reason: "قصير" })).status).toBe(400);
    expect((await strike(l.token, t.id)).status).toBe(403);
  });
});

describe("reviews", () => {
  it("lets the payer review a completed lesson once, shows the average, and filters contact details", async () => {
    const t = await m.teacher();
    const l = await m.verified("learner");
    const b = await m.completedLesson(l, t);
    const review = (body: object) => h.call("POST", `/api/bookings/${b.id}/review`, { token: l.token, body });
    expect((await review({ rating: 6 })).status).toBe(400);
    expect((await review({ rating: 5, comment: "واتساب 0551234567" })).body.error).toBe("comment_blocked");
    expect((await review({ rating: 5, comment: "معلم ممتاز وصبور" })).status).toBe(201);
    expect((await review({ rating: 1 })).body.error).toBe("already_reviewed");
    expect((await h.call("POST", `/api/bookings/${b.id}/review`, { token: t.token, body: { rating: 5 } })).status).toBe(403);
    const prof = await h.call("GET", `/api/teachers/${t.id}`, { token: l.token });
    expect(prof.body.rating).toEqual({ average: 5, count: 1 });
  });

  it("is refused for lessons that were not completed", async () => {
    const t = await m.teacher();
    const l = await m.verified("learner");
    await m.openWindow(t, 2);
    const b = await m.bookAndPay(l, t, m.at(2, 9));
    expect((await h.call("POST", `/api/bookings/${b.id}/review`, { token: l.token, body: { rating: 4 } })).body.error).toBe("not_reviewable");
  });
});

describe("disputes and refunds", () => {
  const dispute = (token: string, id: string, reason = "الدرس لم يكن كما هو متفق عليه") => h.call("POST", `/api/bookings/${id}/dispute`, { token, body: { reason } });

  it("full refund: the provider refunds, the teacher earns nothing, and a second decision is refused", async () => {
    const t = await m.teacher();
    const l = await m.verified("learner");
    const b = await m.completedLesson(l, t);
    expect((await dispute(l.token, b.id)).status).toBe(201);
    expect((await dispute(l.token, b.id)).body.error).toBe("dispute_exists");
    expect((await h.call("GET", `/api/bookings/${b.id}/dispute`, { token: t.token })).body.status).toBe("open"); // the teacher can see one was opened

    const fin = await h.staff("finance_officer");
    const open = await h.call("GET", "/api/admin/finance/disputes", { token: fin.token });
    const d = open.body.items.find((x: { bookingId: string }) => x.bookingId === b.id);
    const detail = await h.call("GET", `/api/admin/finance/disputes/${d.id}`, { token: fin.token });
    expect(detail.body.payment).toMatchObject({ capturedHalalas: PRICE, commissionHalalas: 2000, paidOut: false });

    const r = await h.call("POST", `/api/admin/finance/disputes/${d.id}/decide`, { token: fin.token, body: { outcome: "full_refund", note: "الدرس لم يُقدَّم كما ينبغي" } });
    expect(r.body.refundedHalalas).toBe(PRICE);
    expect(await m.providerStatus(b.paymentId)).toBe("refunded");
    const p = await h.db.query("SELECT status, refunded_halalas, commission_halalas FROM payments WHERE booking_id = $1", [b.id]);
    expect(p.rows[0]).toEqual({ status: "refunded", refunded_halalas: PRICE, commission_halalas: 0 });
    expect((await h.call("POST", `/api/admin/finance/disputes/${d.id}/decide`, { token: fin.token, body: { outcome: "release_to_teacher", note: "قرار متأخر مرفوض" } })).body.error).toBe("already_decided");
    expect((await h.call("GET", `/api/bookings/${b.id}/dispute`, { token: l.token })).body).toMatchObject({ status: "decided", outcome: "full_refund", refundHalalas: PRICE });
    expect((await h.call("GET", "/api/teacher/earnings", { token: t.token })).body.availableForNextRunHalalas).toBe(0);
  });

  it("partial refund recomputes the teacher's commission on what was kept", async () => {
    const t = await m.teacher();
    const l = await m.verified("learner");
    const b = await m.completedLesson(l, t);
    await dispute(l.token, b.id);
    const fin = await h.staff("finance_officer");
    const d = (await h.call("GET", "/api/admin/finance/disputes", { token: fin.token })).body.items.find((x: { bookingId: string }) => x.bookingId === b.id);
    const decide = (body: object) => h.call("POST", `/api/admin/finance/disputes/${d.id}/decide`, { token: fin.token, body: { note: "تعويض جزئي عن الدرس", ...body } });
    expect((await decide({ outcome: "partial_refund", refundHalalas: PRICE })).body.error).toBe("bad_refund_amount");
    expect((await decide({ outcome: "partial_refund", refundHalalas: 0 })).status).toBe(400);
    expect((await decide({ outcome: "partial_refund" })).status).toBe(400);
    expect((await decide({ outcome: "partial_refund", refundHalalas: 4000 })).body.refundedHalalas).toBe(4000);
    // Kept 6000; commission 20% = 1200; teacher net 4800.
    const p = await h.db.query("SELECT status, refunded_halalas, commission_halalas FROM payments WHERE booking_id = $1", [b.id]);
    expect(p.rows[0]).toEqual({ status: "partially_refunded", refunded_halalas: 4000, commission_halalas: 1200 });
    expect((await h.call("GET", "/api/teacher/earnings", { token: t.token })).body.availableForNextRunHalalas + (await h.call("GET", "/api/teacher/earnings", { token: t.token })).body.heldInDisputeWindowHalalas).toBe(4800);
  });

  it("release to teacher refunds nothing and the money stays with the teacher", async () => {
    const t = await m.teacher();
    const l = await m.verified("learner");
    const b = await m.completedLesson(l, t);
    await dispute(l.token, b.id);
    const fin = await h.staff("finance_officer");
    const d = (await h.call("GET", "/api/admin/finance/disputes", { token: fin.token })).body.items.find((x: { bookingId: string }) => x.bookingId === b.id);
    const r = await h.call("POST", `/api/admin/finance/disputes/${d.id}/decide`, { token: fin.token, body: { outcome: "release_to_teacher", note: "الدرس تم وفق الاتفاق" } });
    expect(r.body.refundedHalalas).toBe(0);
    expect(await m.providerStatus(b.paymentId)).toBe("captured");
  });

  it("only the payer, only for a charged lesson, and only within 48 hours", async () => {
    const t = await m.teacher();
    const l = await m.verified("learner");
    const b = await m.completedLesson(l, t);
    expect((await dispute(t.token, b.id)).status).toBe(403);
    const x = await m.verified("learner");
    expect((await dispute(x.token, b.id)).status).toBe(404);
    expect((await h.call("POST", `/api/bookings/${b.id}/dispute`, { token: l.token, body: { reason: "قصير" } })).status).toBe(400);
    h.clock.advance(49 * HOUR);
    expect((await dispute(l.token, b.id)).body.error).toBe("dispute_window_closed");

    await m.openWindow(t, 2, 6, 18);
    const pending = await m.bookAndPay(l, t, m.at(2, 11));
    expect((await dispute(l.token, pending.id)).body.error).toBe("not_disputable");
  });

  it("a payout that already left cannot be refunded here", async () => {
    const t = await m.teacher();
    const l = await m.verified("learner");
    const b = await m.completedLesson(l, t);
    await dispute(l.token, b.id);
    const fin = await h.staff("finance_officer");
    const d = (await h.call("GET", "/api/admin/finance/disputes", { token: fin.token })).body.items.find((x: { bookingId: string }) => x.bookingId === b.id);
    await h.db.query("INSERT INTO payouts (teacher_id, amount_halalas, status) VALUES ($1, 8000, 'paid')", [t.id]);
    await h.db.query("UPDATE payments SET payout_id = (SELECT id FROM payouts WHERE teacher_id = $1) WHERE booking_id = $2", [t.id, b.id]);
    const r = await h.call("POST", `/api/admin/finance/disputes/${d.id}/decide`, { token: fin.token, body: { outcome: "full_refund", note: "محاولة استرداد بعد التحويل" } });
    expect(r.body.error).toBe("already_paid_out");
    expect(await m.providerStatus(b.paymentId)).toBe("captured");
  });

  it("is closed to everyone but finance officers", async () => {
    const l = await m.verified("learner");
    const officer = await h.staff("safety_officer");
    for (const tok of [l.token, officer.token]) expect((await h.call("GET", "/api/admin/finance/disputes", { token: tok })).status).toBe(403);
  });
});
