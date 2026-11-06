import { beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/http/app.js";
import { makeHarness } from "./helpers/harness.js";
import { makeMarket } from "./helpers/market.js";

/** Object-level access: a signed-in stranger must not read or change someone else's records, and must not learn that they exist. */
let h: Awaited<ReturnType<typeof makeHarness>>;
let m: Awaited<ReturnType<typeof makeMarket>>;
beforeAll(async () => {
  h = await makeHarness();
  m = await makeMarket(h);
});

describe("strangers and other people's bookings", () => {
  it("get 404 on every booking route, and leak nothing", async () => {
    const t = await m.teacher();
    const owner = await m.verified("learner");
    const b = await m.completedLesson(owner, t);
    await h.call("POST", `/api/bookings/${b.id}/messages`, { token: owner.token, body: { body: "سلام عليكم" } });

    const strangerLearner = await m.verified("learner");
    const otherTeacher = await m.teacher();
    const otherGuardian = await m.verified("guardian");
    const calls: [string, string, object?][] = [
      ["GET", `/api/bookings/${b.id}`],
      ["POST", `/api/bookings/${b.id}/cancel`],
      ["POST", `/api/bookings/${b.id}/room`],
      ["GET", `/api/bookings/${b.id}/messages`],
      ["POST", `/api/bookings/${b.id}/messages`, { body: "مرحبا" }],
      ["GET", `/api/bookings/${b.id}/dispute`],
      ["POST", `/api/bookings/${b.id}/dispute`, { reason: "اعتراض ليس من حقي تقديمه أبداً" }],
      ["GET", `/api/bookings/${b.id}/guarantee`],
      ["POST", `/api/bookings/${b.id}/guarantee`, { why: "other" }],
      ["POST", `/api/bookings/${b.id}/review`, { rating: 1, comment: "سيئ جداً" }],
      ["POST", `/api/bookings/${b.id}/no-show`, { absent: "teacher" }],
      ["POST", `/api/reports`, { bookingId: b.id, category: "conduct", reason: "بلاغ من شخص غريب عن الحجز" }],
    ];
    for (const who of [strangerLearner, otherTeacher, otherGuardian]) {
      for (const [method, url, body] of calls) {
        const r = await h.call(method as "GET", url, { token: who.token, ...(body ? { body } : {}) });
        expect([403, 404], `${method} ${url} as stranger -> ${r.status}`).toContain(r.status);
        expect(JSON.stringify(r.body)).not.toContain(owner.id);
      }
    }
    // the teacher's actions are not for the learner, and the learner's are not for the teacher
    expect((await h.call("POST", `/api/bookings/${b.id}/complete`, { token: owner.token })).status).toBe(403);
    expect([403, 404]).toContain((await h.call("POST", `/api/bookings/${b.id}/complete`, { token: otherTeacher.token })).status);
    expect([403, 404]).toContain((await h.call("POST", `/api/bookings/${b.id}/accept`, { token: otherTeacher.token })).status);
    // nothing changed
    const row = (await h.db.query<{ status: string }>("SELECT status FROM bookings WHERE id = $1", [b.id])).rows[0]!;
    expect(row.status).toBe("completed");
    expect((await h.db.query("SELECT 1 FROM disputes WHERE booking_id = $1", [b.id])).rowCount).toBe(0);
    expect((await h.db.query("SELECT 1 FROM reviews WHERE booking_id = $1", [b.id])).rowCount).toBe(0);
  });

  it("does not let a guardian book or see a lesson for another guardian's child, or pay with someone else's hold", async () => {
    const t = await m.teacher();
    const g1 = await m.verified("guardian");
    const g2 = await m.verified("guardian");
    const kid = await h.call("POST", "/api/guardian/children", { token: g1.token, body: { displayName: "ريم", birthYear: 2016, gender: "female" } });
    await h.call("POST", "/api/guardian/approvals", { token: g1.token, body: { teacherId: t.id, crossGenderOk: true } });
    await m.openWindow(t, 2, 6, 18);
    const steal = await h.call("POST", "/api/bookings", { token: g2.token, body: { teacherId: t.id, categoryId: m.catId, startsAt: m.at(2, 9).toISOString(), learnerId: kid.body.id } });
    expect([403, 404]).toContain(steal.status);

    const l = await m.verified("learner");
    const mine = await h.call("POST", "/api/bookings", { token: l.token, body: { teacherId: t.id, categoryId: m.catId, startsAt: m.at(2, 10).toISOString() } });
    const other = await m.verified("learner");
    const theirs = await h.call("POST", "/api/bookings", { token: other.token, body: { teacherId: t.id, categoryId: m.catId, startsAt: m.at(2, 12).toISOString() } });
    const pay = h.payments.authorize(theirs.body.amountHalalas, { booking_id: theirs.body.bookingId });
    // a hold made for booking B cannot be attached to booking A, nor by someone who is not B's payer
    expect((await h.call("POST", `/api/bookings/${mine.body.bookingId}/payment`, { token: l.token, body: { paymentId: pay.id } })).status).not.toBe(200);
    expect((await h.call("POST", `/api/bookings/${theirs.body.bookingId}/payment`, { token: l.token, body: { paymentId: pay.id } })).status).toBe(404);
  });
});

describe("other people's notifications, strikes, appeals and teacher records", () => {
  it("cannot be read or changed by someone else", async () => {
    const a = await m.verified("learner");
    const b = await m.verified("learner");
    const t = await m.teacher();
    const lesson = await m.completedLesson(a, t, 8);
    const mine = (await h.call("GET", "/api/notifications", { token: a.token })).body.items as { id: string }[];
    expect(mine.length).toBeGreaterThan(0);
    const theirs = (await h.call("GET", "/api/notifications", { token: b.token })).body.items as { id: string }[];
    expect(theirs.map((n) => n.id)).not.toEqual(expect.arrayContaining([mine[0]!.id]));
    await h.call("POST", "/api/notifications/read", { token: b.token, body: { ids: mine.map((n) => n.id) } });
    const stillUnread = (await h.call("GET", "/api/notifications/unread-count", { token: a.token })).body;
    expect(stillUnread.count ?? stillUnread.unread).toBeGreaterThan(0);

    // appeal against someone else's strike
    const officer = await h.staff("safety_officer");
    await h.call("POST", `/api/admin/safety/users/${a.id}/strike`, { token: officer.token, body: { reason: "مخالفة تحتاج تنبيهاً رسمياً للمتعلّم" } });
    const strikeId = (await h.call("GET", "/api/account/strikes", { token: a.token })).body.strikes[0].id as string;
    const steal = await h.call("POST", "/api/appeals", { token: b.token, body: { strikeId, reason: "أعترض نيابة عن شخص آخر وهذا لا يجوز أبداً" } });
    expect([403, 404]).toContain(steal.status);

    // a teacher cannot see another teacher's earnings or profile data, only their own
    const other = await m.teacher();
    expect((await h.call("GET", "/api/teacher/me", { token: other.token })).body.iban ?? "").not.toContain("0167519x");
    const view = JSON.stringify((await h.call("GET", `/api/teachers/${t.id}`, { token: a.token })).body);
    expect(view).not.toContain("SA03800000");
    expect(view).not.toContain(t.phone);
    void lesson;
  });
});

describe("test-only routes do not exist outside mock mode", () => {
  it("answers 404 for the mock payment pages when no mock provider is wired", async () => {
    const app = buildApp({ ...h.ctx, mockPayments: undefined } as never);
    for (const url of ["/api/dev/pay", "/api/mock-pay/authorize", "/api/mock-pay/capture", "/api/mock-pay/refund", "/api/mock-pay/void", "/api/mock-pay/confirm"]) {
      const r = await app.inject({ method: "POST", url, payload: {} });
      expect(r.statusCode, url).toBe(404);
    }
  });
});
