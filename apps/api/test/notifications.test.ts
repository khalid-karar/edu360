import { beforeAll, describe, expect, it } from "vitest";
import { render } from "../src/domain/notifications.js";
import { deliverSms, sendReminders } from "../src/services/notifications.js";
import { makeHarness } from "./helpers/harness.js";
import { HOUR, makeMarket } from "./helpers/market.js";

let h: Awaited<ReturnType<typeof makeHarness>>;
let m: Awaited<ReturnType<typeof makeMarket>>;
beforeAll(async () => {
  h = await makeHarness();
  m = await makeMarket(h);
});

const mine = async (who: { token: string }) => (await h.call("GET", "/api/notifications", { token: who.token })).body as { unread: number; items: { id: string; kind: string; title: string; body: string; link: string | null; read: boolean }[] };

describe("templates", () => {
  it("never leave a placeholder behind, and text only what people would hate to miss", () => {
    const kinds = ["booking_requested", "booking_accepted", "booking_declined", "booking_cancelled", "booking_expired_unpaid", "booking_unanswered", "lesson_completed", "no_show", "lesson_reminder", "new_message", "vetting_decision", "strike", "dispute_opened", "dispute_decided", "payout_update", "report_update"] as const;
    for (const k of kinds) {
      const n = render(k, { who: "نورة", when: "الأحد 9:00 ص" });
      expect(n.title.length).toBeGreaterThan(2);
      expect(n.body).not.toMatch(/undefined|\{|\}/);
    }
    expect(render("new_message").sms).toBe(false);
    expect(render("booking_requested").sms).toBe(true);
    expect(render("booking_cancelled", { by: "system" }).body).toContain("لم يُخصم");
  });
});

describe("booking events", () => {
  it("tells the teacher about a paid request, and the payer when it is accepted or cancelled", async () => {
    const t = await m.teacher();
    const l = await m.verified("learner");
    await m.openWindow(t, 2);
    const b = await m.bookAndPay(l, t, m.at(2, 9));
    expect((await mine(t)).items.map((n) => n.kind)).toContain("booking_requested");
    expect((await mine(l)).items.map((n) => n.kind)).not.toContain("booking_requested");

    await h.call("POST", `/api/bookings/${b.id}/accept`, { token: t.token });
    const lf = await mine(l);
    expect(lf.items.find((n) => n.kind === "booking_accepted")?.link).toBe(`/portal/booking?id=${b.id}`);

    await h.call("POST", `/api/bookings/${b.id}/cancel`, { token: l.token });
    expect((await mine(t)).items.map((n) => n.kind)).toContain("booking_cancelled");
  });

  it("announces nothing when the event rolls back, and never to an unpaid booking's teacher", async () => {
    const t = await m.teacher();
    const l = await m.verified("learner");
    await m.openWindow(t, 2);
    const before = (await mine(t)).items.length;
    await h.call("POST", "/api/bookings", { token: l.token, body: { teacherId: t.id, categoryId: m.catId, startsAt: m.at(2, 9).toISOString() } }); // awaiting payment
    expect((await mine(t)).items.length).toBe(before);
  });

  it("tells the payer when an unpaid hold expires and when the teacher never answers", async () => {
    const t = await m.teacher();
    const l = await m.verified("learner");
    await m.openWindow(t, 2);
    const unpaid = await h.call("POST", "/api/bookings", { token: l.token, body: { teacherId: t.id, categoryId: m.catId, startsAt: m.at(2, 9).toISOString() } });
    expect(unpaid.status).toBe(201);
    await m.bookAndPay(l, t, m.at(2, 11));
    h.clock.advance(30 * HOUR);
    const { expireStale } = await import("../src/services/bookings.js");
    await expireStale({ db: h.db, payments: h.payments, now: h.clock.now });
    const kinds = (await mine(l)).items.map((n) => n.kind);
    expect(kinds).toContain("booking_expired_unpaid");
    expect(kinds).toContain("booking_unanswered");
  });
});

describe("the inbox", () => {
  it("is private, counts unread, and marks read only your own", async () => {
    const t = await m.teacher();
    const l = await m.verified("learner");
    await m.openWindow(t, 2);
    await m.bookAndPay(l, t, m.at(2, 9));
    const other = await m.verified("learner");

    const box = await mine(t);
    expect(box.unread).toBeGreaterThan(0);
    expect((await mine(other)).items).toHaveLength(0);

    // someone else's ids do nothing
    const theirs = await h.call("POST", "/api/notifications/read", { token: other.token, body: { ids: box.items.map((n) => n.id) } });
    expect(theirs.body.marked).toBe(0);
    expect((await mine(t)).unread).toBe(box.unread);

    const one = await h.call("POST", "/api/notifications/read", { token: t.token, body: { ids: [box.items[0]!.id] } });
    expect(one.body.marked).toBe(1);
    expect((await mine(t)).unread).toBe(box.unread - 1);
    await h.call("POST", "/api/notifications/read", { token: t.token, body: {} });
    expect((await mine(t)).unread).toBe(0);
    expect((await h.call("GET", "/api/notifications/unread-count", { token: t.token })).body.unread).toBe(0);
    expect((await h.call("GET", "/api/notifications")).status).toBe(401);
  });

  it("sends one 'new message' per booking until it is read, and nothing for blocked messages", async () => {
    const t = await m.teacher();
    const l = await m.verified("learner");
    await m.openWindow(t, 2);
    const b = await m.bookAndPay(l, t, m.at(2, 9));
    await h.call("POST", `/api/bookings/${b.id}/accept`, { token: t.token });
    const count = async () => (await mine(l)).items.filter((n) => n.kind === "new_message").length;
    await h.call("POST", `/api/bookings/${b.id}/messages`, { token: t.token, body: { body: "السلام عليكم، جهز الكتاب" } });
    await h.call("POST", `/api/bookings/${b.id}/messages`, { token: t.token, body: { body: "وجهز دفتراً أيضاً" } });
    expect(await count()).toBe(1);
    await h.call("POST", `/api/bookings/${b.id}/messages`, { token: t.token, body: { body: "كلمني 0555555555" } });
    expect(await count()).toBe(1);
    await h.call("POST", "/api/notifications/read", { token: l.token, body: {} });
    await h.call("POST", `/api/bookings/${b.id}/messages`, { token: t.token, body: { body: "رسالة بعد القراءة" } });
    expect(await count()).toBe(2);
  });
});

describe("reminders and texts", () => {
  it("reminds both sides once, an hour ahead, and texts them", async () => {
    const t = await m.teacher();
    const l = await m.verified("learner");
    await m.openWindow(t, 2);
    const start = m.at(2, 9);
    const b = await m.bookAndPay(l, t, start);
    await h.call("POST", `/api/bookings/${b.id}/accept`, { token: t.token });

    m.goTo(new Date(start.getTime() - 3 * HOUR));
    expect(await sendReminders(h.db, h.clock.now())).toBe(0);
    m.goTo(new Date(start.getTime() - 40 * 60_000));
    expect(await sendReminders(h.db, h.clock.now())).toBeGreaterThanOrEqual(1);
    expect(await sendReminders(h.db, h.clock.now())).toBe(0); // once
    expect((await mine(l)).items.filter((n) => n.kind === "lesson_reminder")).toHaveLength(1);
    expect((await mine(t)).items.filter((n) => n.kind === "lesson_reminder")).toHaveLength(1);

    const sent = await deliverSms(h.db, h.sms, h.clock.now());
    expect(sent.sent).toBeGreaterThan(0);
    expect(h.sms.outbox.some((x) => x.text.includes("درسك بعد قليل"))).toBe(true);
    expect((await deliverSms(h.db, h.sms, h.clock.now())).sent).toBe(0); // not twice
  });

  it("retries a failing gateway three times and then gives up", async () => {
    const t = await m.teacher();
    const l = await m.verified("learner");
    await m.openWindow(t, 2);
    await m.bookAndPay(l, t, m.at(2, 9));
    const failing = { send: async () => { throw new Error("gateway down"); } };
    const due = (id: string) => h.db.query<{ n: number }>("SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND sms AND sms_sent_at IS NULL AND sms_attempts < 3", [id]);
    expect((await due(t.id)).rows[0]!.n).toBe(1);
    for (let i = 0; i < 4; i++) await deliverSms(h.db, failing, h.clock.now());
    expect((await due(t.id)).rows[0]!.n).toBe(0);
    expect((await h.db.query<{ a: number }>("SELECT sms_attempts AS a FROM notifications WHERE user_id = $1 AND sms", [t.id])).rows[0]!.a).toBe(3);
  });
});
