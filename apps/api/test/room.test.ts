import { createHmac } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { makeHarness } from "./helpers/harness.js";
import { HOUR, makeMarket } from "./helpers/market.js";
import { LiveKitVideo } from "../src/video/provider.js";
import { ROOM_CLOSES_AFTER_MIN, ROOM_OPENS_BEFORE_MIN } from "../src/services/room.js";

let h: Awaited<ReturnType<typeof makeHarness>>;
let m: Awaited<ReturnType<typeof makeMarket>>;
beforeAll(async () => {
  h = await makeHarness();
  m = await makeMarket(h);
});
const MIN = 60_000;

async function confirmed(hour = 9) {
  const t = await m.teacher();
  const l = await m.verified("learner");
  await m.openWindow(t, 2, 6, 18);
  const start = m.at(2, hour);
  const b = await m.bookAndPay(l, t, start);
  await h.call("POST", `/api/bookings/${b.id}/accept`, { token: t.token });
  return { t, l, b, start };
}
const room = (token: string, id: string) => h.call("POST", `/api/bookings/${id}/room`, { token });

describe("lesson room", () => {
  it("opens 10 minutes early, closes 15 minutes after the end, and only for the two sides", async () => {
    const { t, l, b, start } = await confirmed();
    const view = await h.call("GET", `/api/bookings/${b.id}`, { token: l.token });
    expect(new Date(view.body.room.opensAt).getTime()).toBe(start.getTime() - ROOM_OPENS_BEFORE_MIN * MIN);

    expect((await room(l.token, b.id)).body.error).toBe("room_not_open_yet");
    h.clock.advance(start.getTime() - ROOM_OPENS_BEFORE_MIN * MIN - h.clock.now().getTime() + MIN);
    const stranger = await m.verified("learner");
    expect((await room(stranger.token, b.id)).status).toBe(404);

    const a = await room(l.token, b.id);
    expect(a.status).toBe(200);
    expect(a.body).toMatchObject({ as: "learner", forChild: false, url: "mock://video" });
    const tt = await room(t.token, b.id);
    expect(tt.body.as).toBe("teacher");
    expect(tt.body.room).toBe(a.body.room);
    const ids = h.video.issued.map((x) => x.identity);
    expect(ids).toContain(`teacher:${t.id}`);
    expect(ids).toContain(`payer:${l.id}`);

    h.clock.advance(HOUR + (ROOM_CLOSES_AFTER_MIN + 1) * MIN);
    expect((await room(l.token, b.id)).body.error).toBe("room_closed");
  });

  it("records the first entry of each side and keeps it on re-entry", async () => {
    const { t, l, b, start } = await confirmed(11);
    h.clock.advance(start.getTime() - h.clock.now().getTime() + 2 * MIN);
    await room(t.token, b.id);
    const first = (await h.db.query<any>("SELECT teacher_joined_at, learner_joined_at, started_at FROM sessions WHERE booking_id = $1", [b.id])).rows[0];
    expect(first.teacher_joined_at).not.toBeNull();
    expect(first.learner_joined_at).toBeNull();
    h.clock.advance(5 * MIN);
    await room(t.token, b.id);
    await room(l.token, b.id);
    const again = (await h.db.query<any>("SELECT teacher_joined_at, learner_joined_at FROM sessions WHERE booking_id = $1", [b.id])).rows[0];
    expect(again.teacher_joined_at).toEqual(first.teacher_joined_at);
    expect(again.learner_joined_at).not.toBeNull();
  });

  it("refuses a no-show report against a side that entered the room, accepts it against one that did not", async () => {
    const { t, l, b, start } = await confirmed(13);
    h.clock.advance(start.getTime() - h.clock.now().getTime() + 5 * MIN);
    await room(l.token, b.id);
    h.clock.advance(15 * MIN);
    expect((await h.call("POST", `/api/bookings/${b.id}/no-show`, { token: t.token, body: { absent: "learner" } })).body.error).toBe("party_attended");
    expect((await h.call("POST", `/api/bookings/${b.id}/no-show`, { token: l.token, body: { absent: "teacher" } })).status).toBe(200);
  });

  it("refuses unconfirmed or cancelled lessons", async () => {
    const t = await m.teacher();
    const l = await m.verified("learner");
    await m.openWindow(t, 3);
    const b = await m.bookAndPay(l, t, m.at(3, 9));
    expect((await room(l.token, b.id)).body.error).toBe("room_unavailable");
  });

  it("shows attendance to finance on a dispute", async () => {
    const t = await m.teacher();
    const l = await m.verified("learner");
    const b = await m.completedLesson(l, t, 7);
    await h.db.query("UPDATE sessions SET learner_joined_at = $2 WHERE booking_id = $1", [b.id, h.clock.now()]);
    await h.call("POST", `/api/bookings/${b.id}/dispute`, { token: l.token, body: { reason: "الدرس لم يكن كما اتفقنا عليه إطلاقاً" } });
    const fin = await h.staff("finance_officer");
    const list = await h.call("GET", "/api/admin/finance/disputes", { token: fin.token });
    const id = (list.body.items as { id: string; bookingId: string }[]).find((x) => x.bookingId === b.id)!.id;
    const d = await h.call("GET", `/api/admin/finance/disputes/${id}`, { token: fin.token });
    expect(d.body.attendance.learnerJoinedAt).not.toBeNull();
    expect(d.body.attendance.teacherJoinedAt).toBeNull();
  });
});

describe("LiveKit ticket", () => {
  it("is an HS256 JWT limited to one room, with an expiry", async () => {
    const now = new Date("2026-11-06T10:00:00Z");
    const t = await new LiveKitVideo("wss://x.livekit.cloud", "APIkey", "s".repeat(32)).ticket({ room: "ilmak-r1", identity: "teacher:u1", name: "نورة", ttlSec: 3600, now });
    expect(t.url).toBe("wss://x.livekit.cloud");
    const [hd, bd, sig] = t.token.split(".") as [string, string, string];
    expect(createHmac("sha256", "s".repeat(32)).update(`${hd}.${bd}`).digest("base64url")).toBe(sig);
    const p = JSON.parse(Buffer.from(bd, "base64url").toString());
    expect(p).toMatchObject({ iss: "APIkey", sub: "teacher:u1", video: { room: "ilmak-r1", roomJoin: true, canPublishData: true } });
    expect(p.video.roomAdmin).toBeUndefined();
    expect(p.video.recorder).toBeUndefined();
    expect(p.exp - p.nbf).toBeLessThanOrEqual(3700);
    expect(p.exp * 1000).toBeGreaterThan(now.getTime());
  });
});
