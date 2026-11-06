import { beforeAll, describe, expect, it } from "vitest";
import { makeHarness } from "./helpers/harness.js";
import { HOUR, makeMarket } from "./helpers/market.js";
import { DELETION_COOLING_DAYS, processDeletions } from "../src/services/dataRights.js";

let h: Awaited<ReturnType<typeof makeHarness>>;
let m: Awaited<ReturnType<typeof makeMarket>>;
beforeAll(async () => {
  h = await makeHarness();
  m = await makeMarket(h);
});

const del = (token: string, body: object = { confirm: true }) => h.call("POST", "/api/account/deletion", { token, body });
const afterCooling = () => h.clock.advance((DELETION_COOLING_DAYS + 1) * 24 * HOUR);

describe("export", () => {
  it("gives a user their own data, without the other side's contact details, and is rate-limited", async () => {
    const t = await m.teacher();
    const l = await m.verified("learner");
    await m.completedLesson(l, t);
    const r = await h.call("GET", "/api/account/export", { token: l.token });
    expect(r.status).toBe(200);
    expect(r.body.account.id).toBe(l.id);
    expect(r.body.identity.full_name).toBeTruthy();
    expect(r.body.bookings).toHaveLength(1);
    expect(r.body.payments).toHaveLength(1);
    const text = JSON.stringify(r.body);
    expect(text).not.toContain(t.phone);
    expect(text).not.toContain("national_id_hash");

    const tr = await h.call("GET", "/api/account/export", { token: t.token });
    expect(tr.body.teacherProfile.iban).toBe("SA0380000000608010167519");

    await h.call("GET", "/api/account/export", { token: l.token });
    await h.call("GET", "/api/account/export", { token: l.token });
    expect((await h.call("GET", "/api/account/export", { token: l.token })).status).toBe(429);
    const n = (await h.db.query<{ n: number }>("SELECT count(*)::int AS n FROM audit_log WHERE action = 'account.exported' AND actor_id = $1", [l.id])).rows[0]!.n;
    expect(n).toBe(3);
  });

  it("includes a guardian's children", async () => {
    const g = await m.verified("guardian");
    await h.call("POST", "/api/guardian/children", { token: g.token, body: { displayName: "ريم", birthYear: 2016, gender: "female" } });
    const r = await h.call("GET", "/api/account/export", { token: g.token });
    expect(r.body.children).toHaveLength(1);
  });
});

describe("deletion", () => {
  it("waits out the cooling-off period, can be cancelled, then erases personal data but keeps money records", async () => {
    const t = await m.teacher();
    const l = await m.verified("learner");
    const b = await m.completedLesson(l, t);
    await h.call("POST", `/api/bookings/${b.id}/messages`, { token: l.token, body: { body: "مرحباً أستاذ، جاهزون للدرس" } });
    expect((await del(l.token, {})).status).toBe(400);

    expect((await del(l.token)).status).toBe(201);
    expect((await del(l.token)).body.error).toBe("deletion_already_requested");
    expect((await h.call("GET", "/api/account/deletion", { token: l.token })).body.requested).toBe(true);
    expect(((await h.call("GET", "/api/notifications", { token: l.token })).body.items as { kind: string }[]).some((n) => n.kind === "deletion_requested")).toBe(true);

    expect(await processDeletions(h.db, h.clock.now())).toEqual({ erased: 0, postponed: 0 });
    expect((await h.call("DELETE", "/api/account/deletion", { token: l.token })).status).toBe(200);
    afterCooling();
    expect((await processDeletions(h.db, h.clock.now())).erased).toBe(0);

    await del(l.token);
    afterCooling();
    expect((await processDeletions(h.db, h.clock.now())).erased).toBeGreaterThanOrEqual(1);

    const u = (await h.db.query<any>("SELECT display_name, email, mobile, birth_year, deleted_at FROM users WHERE id = $1", [l.id])).rows[0];
    expect(u.display_name).toBe("حساب محذوف");
    expect(u.mobile).toBe(`deleted:${l.id}`);
    expect(u.deleted_at).not.toBeNull();
    expect((await h.db.query("SELECT 1 FROM identity_verifications WHERE user_id = $1", [l.id])).rowCount).toBe(0);
    expect((await h.db.query("SELECT body FROM messages WHERE sender_id = $1", [l.id])).rows.every((x: any) => x.body === "[محذوفة]")).toBe(true);
    // money records stay
    expect((await h.db.query("SELECT 1 FROM payments WHERE booking_id = $1", [b.id])).rowCount).toBe(1);
    expect((await h.db.query("SELECT 1 FROM audit_log WHERE action = 'account.erased' AND target_id = $1", [l.id])).rowCount).toBe(1);
    // the old session is dead and the number is free to register again
    expect((await h.call("GET", "/api/auth/me", { token: l.token })).status).toBe(401);
  });

  it("refuses while a lesson is booked, and postpones erasure if something opens during the cooling-off", async () => {
    const t = await m.teacher();
    const l = await m.verified("learner");
    await m.openWindow(t, 3);
    const b = await m.bookAndPay(l, t, m.at(3, 9));
    const r = await del(l.token);
    expect(r.status).toBe(409);
    expect(r.body.details.reasons).toContain("upcoming_bookings");
    await h.call("POST", `/api/bookings/${b.id}/cancel`, { token: l.token });

    const ok = await del(l.token);
    expect(ok.status).toBe(201);
    await h.db.query("INSERT INTO reports (reporter_id, booking_id, reported_user_id, reason) VALUES ($1,$2,$3,$4)", [t.id, b.id, l.id, "بلاغ مفتوح جديد ضد المتعلّم"]);
    afterCooling();
    await processDeletions(h.db, h.clock.now());
    expect((await h.db.query<any>("SELECT display_name FROM users WHERE id = $1", [l.id])).rows[0].display_name).not.toBe("حساب محذوف");
    expect((await h.call("GET", "/api/account/deletion", { token: l.token })).body.blockedReasons).toContain("open_safety_case");
  });

  it("blocks a teacher who is still owed money, then delists and strips bank details once paid", async () => {
    const t = await m.teacher();
    const l = await m.verified("learner");
    await m.completedLesson(l, t);
    expect((await del(t.token)).body.details.reasons).toContain("unsettled_money");
    await h.db.query("UPDATE payments SET payout_id = NULL, status = 'refunded', refunded_halalas = captured_halalas WHERE booking_id IN (SELECT id FROM bookings WHERE teacher_id = $1)", [t.id]);
    expect((await del(t.token)).status).toBe(201);
    afterCooling();
    await processDeletions(h.db, h.clock.now());
    const p = (await h.db.query<any>("SELECT status, iban, bio FROM teacher_profiles WHERE user_id = $1", [t.id])).rows[0];
    expect(p).toEqual({ status: "suspended", iban: null, bio: null });
    const search = await h.call("GET", "/api/teachers", { token: l.token });
    expect(JSON.stringify(search.body)).not.toContain(t.id);
  });

  it("erases a guardian's children too, keeps a banned person's strikes and ID hash, and refuses staff", async () => {
    const g = await m.verified("guardian");
    await h.call("POST", "/api/guardian/children", { token: g.token, body: { displayName: "ريم", birthYear: 2016, gender: "female" } });
    const officer = await h.staff("safety_officer");
    expect((await del(officer.token)).body.error).toBe("staff_cannot_self_delete");
    await h.call("POST", `/api/admin/safety/users/${g.id}/strike`, { token: officer.token, body: { reason: "سلوك غير لائق ومخالفة جسيمة للسياسة", zeroTolerance: true } });
    const s = await (async () => {
      h.clock.advance(11 * 60_000);
      const rq = await h.call("POST", "/api/auth/otp/request", { body: { phone: g.phone } });
      return (await h.call("POST", "/api/auth/otp/verify", { body: { phone: g.phone, code: rq.body.mock_code } })).body as { token: string };
    })();
    expect((await h.call("GET", "/api/account/export", { token: s.token })).status).toBe(200);
    expect((await del(s.token)).status).toBe(201);
    afterCooling();
    await processDeletions(h.db, h.clock.now());
    expect((await h.db.query<any>("SELECT display_name FROM users WHERE guardian_id = $1", [g.id])).rows[0].display_name).toBe("حساب محذوف");
    expect((await h.db.query("SELECT 1 FROM strikes WHERE user_id = $1", [g.id])).rowCount).toBe(1);
    const idv = (await h.db.query<any>("SELECT full_name, national_id_hash FROM identity_verifications WHERE user_id = $1", [g.id])).rows[0];
    expect(idv.full_name).toBe("حساب محذوف");
    expect(idv.national_id_hash).toBeTruthy();
  });
});
