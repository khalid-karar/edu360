import type { Db } from "../db/db.js";
import { HttpError } from "../http/errors.js";
import type { VideoProvider } from "../video/provider.js";

/** The room opens shortly before the lesson so people can test camera and sound, and stays open a little after the end. */
export const ROOM_OPENS_BEFORE_MIN = 10;
export const ROOM_CLOSES_AFTER_MIN = 15;
const MIN = 60_000;

export const roomWindow = (startsAt: Date, durationMin: number) => ({
  opensAt: new Date(startsAt.getTime() - ROOM_OPENS_BEFORE_MIN * MIN),
  closesAt: new Date(startsAt.getTime() + (durationMin + ROOM_CLOSES_AFTER_MIN) * MIN),
});

interface Row {
  status: string;
  starts_at: Date;
  duration_min: number;
  teacher_id: string;
  payer_id: string;
  learner_role: string;
  room_name: string | null;
}

/**
 * Lets the teacher or the paying side into a confirmed lesson's room. First entry of each side is recorded: it is the
 * evidence for no-show and dispute decisions. When the learner is a child, the guardian enters for them.
 */
export async function joinRoom(d: { db: Db; video: VideoProvider; now: () => Date }, user: { id: string; displayName: string }, bookingId: string) {
  const now = d.now();
  const r = (
    await d.db.query<Row>(
      `SELECT b.status, b.starts_at, b.duration_min, b.teacher_id, b.payer_id, lu.role AS learner_role, s.room_name
         FROM bookings b JOIN users lu ON lu.id = b.learner_id LEFT JOIN sessions s ON s.booking_id = b.id WHERE b.id = $1`,
      [bookingId],
    )
  ).rows[0];
  if (!r || (r.teacher_id !== user.id && r.payer_id !== user.id)) throw new HttpError(404, "not_found");
  if (r.status !== "confirmed" || !r.room_name) throw new HttpError(409, "room_unavailable");
  const w = roomWindow(r.starts_at, r.duration_min);
  if (now < w.opensAt) throw new HttpError(409, "room_not_open_yet", { opensAt: w.opensAt });
  if (now > w.closesAt) throw new HttpError(409, "room_closed");

  const asTeacher = r.teacher_id === user.id;
  const col = asTeacher ? "teacher_joined_at" : "learner_joined_at";
  await d.db.query(`UPDATE sessions SET ${col} = COALESCE(${col}, $2), started_at = COALESCE(started_at, $2) WHERE booking_id = $1`, [bookingId, now]);
  const ticket = await d.video.ticket({
    room: r.room_name,
    identity: `${asTeacher ? "teacher" : "payer"}:${user.id}`,
    name: user.displayName,
    ttlSec: Math.max(60, Math.ceil((w.closesAt.getTime() - now.getTime()) / 1000)),
    now,
  });
  return { ...ticket, room: r.room_name, as: asTeacher ? "teacher" : "learner", forChild: !asTeacher && r.learner_role === "minor", closesAt: w.closesAt };
}
