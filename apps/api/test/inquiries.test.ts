import { beforeAll, describe, expect, it } from "vitest";
import { BADGES, badgesFor, type TeacherStats } from "../src/domain/badges.js";
import { INQUIRY_MAX_NEW_PER_DAY, INQUIRY_MAX_UNANSWERED } from "../src/domain/inquiry.js";
import { makeHarness } from "./helpers/harness.js";
import { makeMarket } from "./helpers/market.js";

let h: Awaited<ReturnType<typeof makeHarness>>;
let m: Awaited<ReturnType<typeof makeMarket>>;
beforeAll(async () => {
  h = await makeHarness();
  m = await makeMarket(h);
});
const ask = (token: string, teacherId: string, body = "هل تدرّس الأطفال في سن السابعة؟") => h.call("POST", `/api/teachers/${teacherId}/inquiry`, { token, body: { body } });
const say = (token: string, id: string, body: string) => h.call("POST", `/api/inquiries/${id}/messages`, { token, body: { body } });

describe("questions before booking", () => {
  it("lets a learner ask, the teacher answer, and both see only their own thread", async () => {
    const t = await m.teacher();
    const l = await m.verified("learner");
    const q = await ask(l.token, t.id);
    expect(q.status).toBe(201);
    const id = q.body.inquiryId as string;

    const tInbox = (await h.call("GET", "/api/inquiries", { token: t.token })).body.items;
    expect(tInbox).toHaveLength(1);
    expect(tInbox[0]).toMatchObject({ id, viewerRole: "teacher", unread: true, other: { displayName: expect.any(String) } });
    expect(JSON.stringify(tInbox)).not.toContain(l.phone);
    expect((await h.call("GET", "/api/notifications", { token: t.token })).body.items.some((n: { kind: string }) => n.kind === "inquiry_message")).toBe(true);

    expect((await h.call("GET", `/api/inquiries/${id}/messages`, { token: t.token })).body.items).toHaveLength(1);
    expect((await h.call("GET", "/api/inquiries", { token: t.token })).body.items[0].unread).toBe(false);
    expect((await say(t.token, id, "نعم، أدرّس من سن السادسة بأسلوب مبسّط.")).status).toBe(201);
    const thread = (await h.call("GET", `/api/inquiries/${id}/messages`, { token: l.token })).body;
    expect(thread.items.map((x: { mine: boolean }) => x.mine)).toEqual([true, false]);
    expect(thread.viewerRole).toBe("payer");

    const stranger = await m.verified("learner");
    const otherTeacher = await m.teacher();
    for (const who of [stranger, otherTeacher]) {
      expect((await h.call("GET", `/api/inquiries/${id}/messages`, { token: who.token })).status).toBe(404);
      expect((await say(who.token, id, "مرحبا")).status).toBe(404);
    }
    expect((await h.call("GET", "/api/inquiries", { token: stranger.token })).body.items).toEqual([]);
  });

  it("caps unanswered messages and lets the teacher's answer reopen the thread", async () => {
    const t = await m.teacher();
    const l = await m.verified("learner");
    const id = (await ask(l.token, t.id)).body.inquiryId as string;
    for (let i = 1; i < INQUIRY_MAX_UNANSWERED; i++) expect((await say(l.token, id, `سؤال إضافي رقم ${i}`)).status).toBe(201);
    expect((await say(l.token, id, "هل من رد؟")).body.error).toBe("wait_for_answer");
    expect((await say(t.token, id, "أهلاً، تفضّل بأسئلتك.")).status).toBe(201);
    expect((await say(l.token, id, "شكراً، كم مدة الدرس؟")).status).toBe(201);
  });

  it("does not let a teacher start a thread, and limits new threads per day", async () => {
    const t = await m.teacher();
    const l = await m.verified("learner");
    expect((await h.call("POST", `/api/teachers/${l.id}/inquiry`, { token: t.token, body: { body: "مرحبا" } })).status).toBe(403);
    // a thread whose only message was blocked cannot be answered by the teacher
    const blocked = await ask(l.token, t.id, "كلمني على 0555555555");
    expect(blocked.status).toBe(422);
    const id = (await h.db.query<{ id: string }>("SELECT id FROM inquiries WHERE payer_id = $1", [l.id])).rows[0]!.id;
    expect((await say(t.token, id, "أهلاً")).body.error).toBe("not_asked");

    const l2 = await m.verified("learner");
    for (let i = 0; i < INQUIRY_MAX_NEW_PER_DAY; i++) expect((await ask(l2.token, (await m.teacher()).id)).status).toBe(201);
    expect((await ask(l2.token, (await m.teacher()).id)).body.error).toBe("too_many_inquiries");
  });

  it("filters contact details like lesson chat: blocked, never shown, flagged for safety", async () => {
    const t = await m.teacher();
    const l = await m.verified("learner");
    const r = await ask(l.token, t.id, "ممكن رقمك على واتساب؟ رقمي 0555555555");
    expect(r.status).toBe(422);
    expect(r.body.error).toBe("message_blocked");
    const id = (await h.db.query<{ id: string }>("SELECT id FROM inquiries WHERE payer_id = $1", [l.id])).rows[0]!.id;
    expect((await h.call("GET", `/api/inquiries/${id}/messages`, { token: t.token })).body.items).toEqual([]);
    expect((await h.call("GET", "/api/inquiries", { token: t.token })).body.items.find((x: { id: string }) => x.id === id)).toBeUndefined();

    const officer = await h.staff("safety_officer");
    const queue = (await h.call("GET", "/api/admin/safety/queue", { token: officer.token })).body.flags as { id: string }[];
    const flagId = (await h.db.query<{ id: string }>("SELECT f.id FROM flags f JOIN messages m ON m.id = f.target_id WHERE m.inquiry_id = $1", [id])).rows[0]!.id;
    expect(queue.some((f) => f.id === flagId)).toBe(true);
    const detail = (await h.call("GET", `/api/admin/safety/flags/${flagId}`, { token: officer.token })).body;
    expect(detail.message).toMatchObject({ inquiryId: id, bookingId: null, blocked: true });
  });

  it("is part of the data export and is erased with the account", async () => {
    const t = await m.teacher();
    const l = await m.verified("learner");
    await ask(l.token, t.id, "سؤال عن المنهج المتبع في الدروس");
    const exp = await h.call("GET", "/api/account/export", { token: l.token });
    expect(exp.body.messages.some((x: { body: string; inquiry_id: string }) => x.body.includes("المنهج") && x.inquiry_id)).toBe(true);
    const { eraseUser } = await import("../src/services/dataRights.js");
    await eraseUser(h.db, h.clock.now(), l.id);
    expect((await h.db.query<{ body: string }>("SELECT body FROM messages WHERE sender_id = $1", [l.id])).rows.every((x) => x.body === "[محذوفة]")).toBe(true);
  });
});

describe("badges", () => {
  const base: TeacherStats = { completedSessions: 0, reliability: 1, ratingAvg: null, ratingCount: 0, approvalRank: 500, replyMinutesAvg: null, replyThreads: 0 };
  it("are earned only at the published thresholds", () => {
    expect(badgesFor(base)).toEqual([]);
    expect(badgesFor({ ...base, approvalRank: 100 })).toEqual(["founding"]);
    expect(badgesFor({ ...base, approvalRank: 101 })).toEqual([]);
    expect(badgesFor({ ...base, completedSessions: 20 })).toEqual(["experienced", "reliable"]);
    expect(badgesFor({ ...base, completedSessions: 9 })).toEqual([]);
    expect(badgesFor({ ...base, ratingAvg: 4.7, ratingCount: 5 })).toEqual(["top_rated"]);
    expect(badgesFor({ ...base, ratingAvg: 4.9, ratingCount: 4 })).toEqual([]);
    expect(badgesFor({ ...base, completedSessions: 10, reliability: 0.94 })).toEqual([]);
    expect(badgesFor({ ...base, replyMinutesAvg: 180, replyThreads: 3 })).toEqual(["fast_replier"]);
    expect(badgesFor({ ...base, replyMinutesAvg: 181, replyThreads: 3 })).toEqual([]);
    expect(badgesFor({ ...base, replyMinutesAvg: 10, replyThreads: 2 })).toEqual([]);
    expect(BADGES).toHaveLength(5);
  });

  it("show up in search and drive the badge, rating and sort filters", async () => {
    const a = await m.teacher({ approvedAt: new Date("2025-01-01T00:00:00Z") });
    const b = await m.teacher({ approvedAt: new Date("2025-01-02T00:00:00Z") });
    const l = await m.verified("learner");
    await h.db.query("UPDATE teacher_profiles SET completed_sessions = 25 WHERE user_id = $1", [a.id]);
    // three quick answers earn "fast_replier" for teacher a
    for (let i = 0; i < 3; i++) {
      const asker = await m.verified("learner");
      const id = (await ask(asker.token, a.id)).body.inquiryId as string;
      h.clock.advance(10 * 60_000);
      await say(a.token, id, "أهلاً بك، تفضّل.");
    }
    const all = (await h.call("GET", "/api/teachers?limit=20", { token: l.token })).body.items as { teacherId: string; badges: string[] }[];
    const mine = all.find((x) => x.teacherId === a.id)!;
    expect(mine.badges).toEqual(expect.arrayContaining(["founding", "experienced", "fast_replier"]));
    expect(all.find((x) => x.teacherId === b.id)!.badges).toContain("founding");

    const fast = (await h.call("GET", "/api/teachers?badge=fast_replier", { token: l.token })).body.items as { teacherId: string }[];
    expect(fast.map((x) => x.teacherId)).toEqual([a.id]);
    const exp = (await h.call("GET", "/api/teachers?badge=experienced", { token: l.token })).body.items as { teacherId: string }[];
    expect(exp.map((x) => x.teacherId)).toContain(a.id);
    expect(exp.map((x) => x.teacherId)).not.toContain(b.id);

    // ratings: only teachers with 3+ reviews and a high enough average pass the rating filter
    expect((await h.call("GET", "/api/teachers?minRating=4", { token: l.token })).body.items).toEqual([]);
    for (const rating of [5, 5, 4]) {
      const rl = await m.verified("learner");
      const bk = (await h.db.query<{ id: string }>("INSERT INTO bookings (learner_id, payer_id, teacher_id, category_id, status, starts_at, duration_min, price_halalas) VALUES ($1,$1,$2,$3,'completed',now() - interval '3 days',60,10000) RETURNING id", [rl.id, b.id, m.catId])).rows[0]!.id;
      await h.db.query("INSERT INTO reviews (booking_id, rating) VALUES ($1,$2)", [bk, rating]);
    }
    const rated = (await h.call("GET", "/api/teachers?minRating=4.5", { token: l.token })).body.items as { teacherId: string; rating: { average: number } }[];
    expect(rated.map((x) => x.teacherId)).toEqual([b.id]);
    expect(rated[0]!.rating.average).toBeCloseTo(4.67, 1);
    expect((await h.call("GET", "/api/teachers?minRating=4.8", { token: l.token })).body.items).toEqual([]);
    const top = (await h.call("GET", "/api/teachers?sort=rating", { token: l.token })).body.items as { teacherId: string }[];
    expect(top[0]!.teacherId).toBe(b.id);
    const cheap = await m.teacher();
    await h.db.query("UPDATE teacher_categories SET price_halalas = 5000 WHERE teacher_id = $1", [cheap.id]);
    const low = (await h.call("GET", "/api/teachers?sort=price_low", { token: l.token })).body.items as { teacherId: string }[];
    expect(low[0]!.teacherId).toBe(cheap.id);
    const high = (await h.call("GET", "/api/teachers?sort=price_high", { token: l.token })).body.items as { teacherId: string }[];
    expect(high[high.length - 1]!.teacherId).toBe(cheap.id);
    expect((await h.call("GET", "/api/teachers?sort=nonsense", { token: l.token })).status).toBe(400);
  });
});
