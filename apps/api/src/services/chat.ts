import type { Db } from "../db/db.js";
import { filterMessage, flagCheatingRequest } from "../domain/chat-filter.js";
import { HttpError } from "../http/errors.js";

const DAY = 86_400_000;
export const CHAT_AFTER_LESSON_DAYS = 7;
export const MAX_MESSAGES_PER_MINUTE = 30;
export const REPEAT_BLOCKS = 3; // this many blocked messages in a day marks a sender for review

interface Chat {
  id: string;
  teacher_id: string;
  payer_id: string;
  learner_id: string;
  status: string;
  starts_at: Date;
  duration_min: number;
  learner_is_minor: boolean;
}

async function chatFor(db: Db, userId: string, bookingId: string): Promise<Chat> {
  const r = await db.query<Chat>(
    `SELECT b.id, b.teacher_id, b.payer_id, b.learner_id, b.status, b.starts_at, b.duration_min, (l.role = 'minor') AS learner_is_minor
       FROM bookings b JOIN users l ON l.id = b.learner_id WHERE b.id = $1`,
    [bookingId],
  );
  const b = r.rows[0];
  // Only the teacher and whoever pays (the learner, or the guardian for a child) are in the conversation.
  if (!b || (b.teacher_id !== userId && b.payer_id !== userId)) throw new HttpError(404, "not_found");
  return b;
}

/** Open from payment until 7 days after the lesson; closed for unpaid, declined, cancelled and no-show bookings. */
function isOpen(b: Chat, now: Date): boolean {
  if (b.status === "requested" || b.status === "confirmed") return true;
  if (b.status === "completed") return now.getTime() < b.starts_at.getTime() + b.duration_min * 60_000 + CHAT_AFTER_LESSON_DAYS * DAY;
  return false;
}

export interface Posted {
  id: string;
  createdAt: Date;
}

/**
 * Stores a message, or blocks it. A blocked message is kept for Trust & Safety, never shown to the other side,
 * and raises a flag. Child bookings and repeat attempts raise it higher.
 */
export async function postMessage(db: Db, now: Date, userId: string, bookingId: string, body: string): Promise<Posted> {
  const b = await chatFor(db, userId, bookingId);
  if (!isOpen(b, now)) throw new HttpError(409, "chat_closed");
  if (b.learner_is_minor) {
    // Guardian approval can be withdrawn at any time; the chat closes with it.
    const ok = await db.query("SELECT 1 FROM guardian_teacher_approvals WHERE guardian_id = $1 AND teacher_id = $2", [b.payer_id, b.teacher_id]);
    if (!ok.rowCount) throw new HttpError(403, "teacher_not_approved");
  }
  const recent = await db.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM messages WHERE sender_id = $1 AND created_at > $2",
    [userId, new Date(now.getTime() - 60_000)],
  );
  if ((recent.rows[0]?.n ?? 0) >= MAX_MESSAGES_PER_MINUTE) throw new HttpError(429, "slow_down");

  const verdict = filterMessage(body);
  const result = await db.tx(async (tx) => {
    const m = await tx.query<{ id: string; created_at: Date }>(
      "INSERT INTO messages (booking_id, sender_id, body, blocked, block_reason, created_at) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, created_at",
      [bookingId, userId, body, verdict.blocked, verdict.blocked ? verdict.reasons.join(",") : null, now],
    );
    const msg = m.rows[0]!;
    if (verdict.blocked) {
      const blocks = await tx.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM messages WHERE sender_id = $1 AND blocked AND created_at > $2",
        [userId, new Date(now.getTime() - DAY)],
      );
      const teacherToChild = b.learner_is_minor && userId === b.teacher_id;
      const severity = teacherToChild || (blocks.rows[0]?.n ?? 0) >= REPEAT_BLOCKS ? 4 : 2;
      await tx.query("INSERT INTO flags (source, target_type, target_id, category, severity, created_at) VALUES ('rule','message',$1,'leakage',$2,$3)", [msg.id, severity, now]);
    } else if (flagCheatingRequest(body)) {
      // Delivered, but a person looks at it: cheating services are against the terms.
      await tx.query("INSERT INTO flags (source, target_type, target_id, category, severity, created_at) VALUES ('rule','message',$1,'cheating',2,$2)", [msg.id, now]);
    }
    return { id: msg.id, createdAt: msg.created_at };
  });
  if (verdict.blocked) throw new HttpError(422, "message_blocked", { reasons: verdict.reasons });
  return result;
}

export interface MessageView {
  id: string;
  mine: boolean;
  body: string;
  createdAt: Date;
}

export async function listMessages(db: Db, userId: string, bookingId: string, after?: Date): Promise<MessageView[]> {
  await chatFor(db, userId, bookingId);
  const r = await db.query<{ id: string; sender_id: string; body: string; created_at: Date }>(
    `SELECT id, sender_id, body, created_at FROM messages
      WHERE booking_id = $1 AND NOT blocked AND ($2::timestamptz IS NULL OR created_at > $2)
      ORDER BY created_at ASC, id ASC LIMIT 200`,
    [bookingId, after ?? null],
  );
  return r.rows.map((m) => ({ id: m.id, mine: m.sender_id === userId, body: m.body, createdAt: m.created_at }));
}
