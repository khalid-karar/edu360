import { beforeAll, describe, expect, it } from "vitest";
import { makeHarness } from "./helpers/harness.js";
import { HOUR, makeMarket } from "./helpers/market.js";

let h: Awaited<ReturnType<typeof makeHarness>>;
let m: Awaited<ReturnType<typeof makeMarket>>;
beforeAll(async () => {
  h = await makeHarness();
  m = await makeMarket(h);
});

const LONG = "سلوك غير لائق أثناء الدرس ويحتاج مراجعة";
const APPEAL = "أعترض على هذه المخالفة لأن ما حدث كان سوء فهم وقد وثّقته في المحادثة.";
const strike = (token: string, userId: string, body: object = {}) => h.call("POST", `/api/admin/safety/users/${userId}/strike`, { token, body: { reason: LONG, ...body } });
const signIn = async (phone: string) => {
  h.clock.advance(11 * 60_000);
  const rq = await h.call("POST", "/api/auth/otp/request", { body: { phone } });
  return (await h.call("POST", "/api/auth/otp/verify", { body: { phone, code: rq.body.mock_code } })).body as { token: string; next: string | null };
};

describe("suspending a payer", () => {
  it("cancels their upcoming lessons, releases the hold and tells the teacher; a warning changes nothing", async () => {
    const t = await m.teacher();
    const l = await m.verified("learner");
    await m.openWindow(t, 2);
    const b = await m.bookAndPay(l, t, m.at(2, 9));
    await h.call("POST", `/api/bookings/${b.id}/accept`, { token: t.token });
    const officer = await h.staff("safety_officer");

    expect((await strike(officer.token, l.id)).body).toMatchObject({ action: "warn", cancelledBookings: 0 });
    expect((await h.db.query<{ status: string }>("SELECT status FROM bookings WHERE id = $1", [b.id])).rows[0]!.status).toBe("confirmed");

    expect((await strike(officer.token, l.id)).body).toMatchObject({ action: "suspend_14d", cancelledBookings: 1 });
    expect((await h.db.query<{ status: string; cancelled_by: string }>("SELECT status, cancelled_by FROM bookings WHERE id = $1", [b.id])).rows[0]).toEqual({ status: "cancelled", cancelled_by: "system" });
    expect(await m.providerStatus(b.paymentId)).toBe("voided");
    const inbox = (await h.call("GET", "/api/notifications", { token: t.token })).body.items as { kind: string }[];
    expect(inbox.some((n) => n.kind === "booking_cancelled")).toBe(true);
  });
});

describe("appeals", () => {
  async function bannedTeacher() {
    const t = await m.teacher();
    const first = await h.staff("safety_officer");
    await strike(first.token, t.id, { zeroTolerance: true });
    return { t, first };
  }

  it("lets a banned person see their record and appeal, once per strike, and nothing else", async () => {
    const { t } = await bannedTeacher();
    const s = await signIn(t.phone);
    expect(s.next).toBe("appeal");
    expect((await h.call("GET", "/api/bookings", { token: s.token })).body.error).toBe("account_banned");

    const rec = await h.call("GET", "/api/account/strikes", { token: s.token });
    expect(rec.body.status).toBe("banned");
    expect(rec.body.strikes[0]).toMatchObject({ action: "ban", canAppeal: true, voided: false });
    const id = rec.body.strikes[0].id as string;

    expect((await h.call("POST", "/api/appeals", { token: s.token, body: { strikeId: id, reason: "قصير" } })).status).toBe(400);
    expect((await h.call("POST", "/api/appeals", { token: s.token, body: { strikeId: id, reason: APPEAL } })).status).toBe(201);
    expect((await h.call("POST", "/api/appeals", { token: s.token, body: { strikeId: id, reason: APPEAL } })).body.error).toBe("appeal_exists");
    expect((await h.call("GET", "/api/account/strikes", { token: s.token })).body.strikes[0]).toMatchObject({ canAppeal: false, appealStatus: "open" });

    const other = await m.verified("learner");
    expect((await h.call("POST", "/api/appeals", { token: other.token, body: { strikeId: id, reason: APPEAL } })).status).toBe(404); // not their strike
  });

  it("closes the window after 30 days", async () => {
    const { t } = await bannedTeacher();
    const s = await signIn(t.phone);
    const id = (await h.call("GET", "/api/account/strikes", { token: s.token })).body.strikes[0].id as string;
    h.clock.advance(31 * 24 * HOUR);
    const s2 = await signIn(t.phone);
    expect((await h.call("GET", "/api/account/strikes", { token: s2.token })).body.strikes[0].canAppeal).toBe(false);
    expect((await h.call("POST", "/api/appeals", { token: s2.token, body: { strikeId: id, reason: APPEAL } })).body.error).toBe("appeal_window_closed");
  });

  it("is decided by a different officer; reversing voids the strike, restores the account and the ladder starts over", async () => {
    const { t, first } = await bannedTeacher();
    const l = await m.verified("learner");
    const s = await signIn(t.phone);
    const strikeId = (await h.call("GET", "/api/account/strikes", { token: s.token })).body.strikes[0].id as string;
    const filed = await h.call("POST", "/api/appeals", { token: s.token, body: { strikeId, reason: APPEAL } });

    const author = await h.staff("safety_officer");
    // the strike's own author may not judge it
    await h.db.query("UPDATE strikes SET issued_by = $2 WHERE id = $1", [strikeId, author.id]);
    const own = await h.call("POST", `/api/admin/safety/appeals/${filed.body.id}/decide`, { token: author.token, body: { outcome: "reversed", note: "قرار المؤلف نفسه غير مقبول" } });
    expect(own.body.error).toBe("cannot_decide_own_strike");
    await h.db.query("UPDATE strikes SET issued_by = $2 WHERE id = $1", [strikeId, first.id]);

    const queue = await h.call("GET", "/api/admin/safety/appeals", { token: author.token });
    expect(queue.body.items.map((a: { id: string }) => a.id)).toContain(filed.body.id);
    const detail = await h.call("GET", `/api/admin/safety/appeals/${filed.body.id}`, { token: author.token });
    expect(detail.body).toMatchObject({ reason: APPEAL, strike: { action: "ban", zeroTolerance: true } });

    expect((await h.call("POST", `/api/admin/safety/appeals/${filed.body.id}/decide`, { token: author.token, body: { outcome: "reversed", note: "قصير" } })).status).toBe(400);
    const done = await h.call("POST", `/api/admin/safety/appeals/${filed.body.id}/decide`, { token: author.token, body: { outcome: "reversed", note: "راجعنا المحادثة وتبيّن أن الحادثة سوء فهم." } });
    expect(done.body).toEqual({ restored: true });
    expect((await h.call("POST", `/api/admin/safety/appeals/${filed.body.id}/decide`, { token: author.token, body: { outcome: "upheld", note: "محاولة ثانية على نفس التظلّم" } })).body.error).toBe("already_decided");

    expect((await h.call("GET", "/api/auth/me", { token: s.token })).body.status).toBe("active");
    expect((await h.db.query<{ status: string; payouts_frozen: boolean }>("SELECT status, payouts_frozen FROM teacher_profiles WHERE user_id = $1", [t.id])).rows[0]).toEqual({ status: "approved", payouts_frozen: false });
    expect((await h.call("GET", `/api/teachers/${t.id}`, { token: l.token })).status).toBe(200);
    expect((await h.call("GET", "/api/account/strikes", { token: s.token })).body.strikes[0]).toMatchObject({ voided: true, appealStatus: "reversed" });
    const notes = (await h.call("GET", "/api/notifications", { token: s.token })).body.items as { kind: string }[];
    expect(notes.some((n) => n.kind === "appeal_decided")).toBe(true);

    // the voided strike no longer counts: the next one is a warning again, not a ban
    const next = await strike(author.token, t.id);
    expect(next.body).toMatchObject({ level: 1, action: "warn" });
  });

  it("keeps the ban when the appeal is upheld, and keeps a suspension if another strike still requires it", async () => {
    const { t } = await bannedTeacher();
    const s = await signIn(t.phone);
    const id = (await h.call("GET", "/api/account/strikes", { token: s.token })).body.strikes[0].id as string;
    const a = await h.call("POST", "/api/appeals", { token: s.token, body: { strikeId: id, reason: APPEAL } });
    const other = await h.staff("safety_officer");
    const r = await h.call("POST", `/api/admin/safety/appeals/${a.body.id}/decide`, { token: other.token, body: { outcome: "upheld", note: "المخالفة موثّقة ولا مجال لإلغائها." } });
    expect(r.body.restored).toBe(false);
    expect((await h.call("GET", "/api/auth/me", { token: s.token })).body.status).toBe("banned");

    // two strikes: warn then suspension. Voiding the warning must not lift the suspension.
    const u = await m.verified("learner");
    const w = await strike(other.token, u.id);
    const sus = await strike(other.token, u.id);
    expect(sus.body.action).toBe("suspend_14d");
    const us = await h.call("GET", "/api/account/strikes", { token: u.token });
    const warnId = (us.body.strikes as { id: string; action: string }[]).find((x) => x.action === "warn")!.id;
    const ap = await h.call("POST", "/api/appeals", { token: u.token, body: { strikeId: warnId, reason: APPEAL } });
    expect(ap.status).toBe(201);
    const third = await h.staff("safety_officer");
    expect((await h.call("POST", `/api/admin/safety/appeals/${ap.body.id}/decide`, { token: third.token, body: { outcome: "reversed", note: "التحذير لم يكن في محلّه، لكن الإيقاف قائم." } })).body.restored).toBe(false);
    expect((await h.call("GET", "/api/auth/me", { token: u.token })).body.status).toBe("suspended");
    expect(w.status).toBe(200);
  });

  it("only safety officers can read or decide appeals", async () => {
    const f = await h.staff("finance_officer");
    expect((await h.call("GET", "/api/admin/safety/appeals", { token: f.token })).status).toBe(403);
    expect((await h.call("GET", "/api/admin/safety/appeals")).status).toBe(401);
  });
});
