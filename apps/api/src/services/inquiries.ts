import type { Db } from "../db/db.js";
import { filterMessage, flagCheatingRequest } from "../domain/chat-filter.js";
import { INQUIRY_MAX_NEW_PER_DAY, INQUIRY_MAX_UNANSWERED } from "../domain/inquiry.js";
import { HttpError } from "../http/errors.js";
import { MAX_MESSAGES_PER_MINUTE, REPEAT_BLOCKS } from "./chat.js";
import { notify } from "./notifications.js";

const DAY = 86_400_000;

interface Thread {
  id: string;
  payer_id: string;
  teacher_id: string;
}

async function threadFor(db: Db, userId: string, inquiryId: string): Promise<Thread> {
  const t = (await db.query<Thread>("SELECT id, payer_id, teacher_id FROM inquiries WHERE id = $1", [inquiryId])).rows[0];
  if (!t || (t.payer_id !== userId && t.teacher_id !== userId)) throw new HttpError(404, "not_found");
  return t;
}

/**
 * Stores a question or an answer, or blocks it, with the same filter and flags as lesson chat. Only the asking side
 * can open a thread, only with a teacher who is live, and cannot send more than a few messages before an answer.
 */
async function post(db: Db, now: Date, t: Thread, senderId: string, body: string) {
  const asker = senderId === t.payer_id;
  const recent = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM messages WHERE sender_id = $1 AND created_at > $2", [senderId, new Date(now.getTime() - 60_000)]);
  if ((recent.rows[0]?.n ?? 0) >= MAX_MESSAGES_PER_MINUTE) throw new HttpError(429, "slow_down");
  if (asker) {
    const lastTeacher = (await db.query<{ at: Date | null }>("SELECT max(created_at) AS at FROM messages WHERE inquiry_id = $1 AND sender_id = $2 AND NOT blocked", [t.id, t.teacher_id])).rows[0]?.at ?? null;
    const unanswered = (await db.query<{ n: number }>("SELECT count(*)::int AS n FROM messages WHERE inquiry_id = $1 AND sender_id = $2 AND NOT blocked AND ($3::timestamptz IS NULL OR created_at > $3)", [t.id, senderId, lastTeacher])).rows[0]?.n ?? 0;
    if (unanswered >= INQUIRY_MAX_UNANSWERED) throw new HttpError(429, "wait_for_answer");
  }
  const verdict = filterMessage(body);
  const result = await db.tx(async (tx) => {
    const m = (await tx.query<{ id: string; created_at: Date }>(
      "INSERT INTO messages (inquiry_id, sender_id, body, blocked, block_reason, created_at) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, created_at",
      [t.id, senderId, body, verdict.blocked, verdict.blocked ? verdict.reasons.join(",") : null, now],
    )).rows[0]!;
    if (verdict.blocked) {
      const blocks = (await tx.query<{ n: number }>("SELECT count(*)::int AS n FROM messages WHERE sender_id = $1 AND blocked AND created_at > $2", [senderId, new Date(now.getTime() - DAY)])).rows[0]?.n ?? 0;
      await tx.query("INSERT INTO flags (source, target_type, target_id, category, severity, created_at) VALUES ('rule','message',$1,'leakage',$2,$3)", [m.id, blocks >= REPEAT_BLOCKS ? 4 : 2, now]);
    } else {
      if (flagCheatingRequest(body)) await tx.query("INSERT INTO flags (source, target_type, target_id, category, severity, created_at) VALUES ('rule','message',$1,'cheating',2,$2)", [m.id, now]);
      await tx.query("UPDATE inquiries SET last_message_at = $2 WHERE id = $1", [t.id, now]);
      const to = asker ? t.teacher_id : t.payer_id;
      const link = `/portal/inquiry?id=${t.id}`;
      const pending = await tx.query("SELECT 1 FROM notifications WHERE user_id = $1 AND kind = 'inquiry_message' AND link = $2 AND read_at IS NULL", [to, link]);
      if (!pending.rowCount) {
        const who = (await tx.query<{ display_name: string }>("SELECT display_name FROM users WHERE id = $1", [senderId])).rows[0]!.display_name;
        await notify(tx, { userId: to, kind: "inquiry_message", vars: { who, by: asker ? "learner" : "teacher" }, link }, now);
      }
    }
    return { id: m.id, createdAt: m.created_at };
  });
  if (verdict.blocked) throw new HttpError(422, "message_blocked", { reasons: verdict.reasons });
  return result;
}

/** A payer's first or later question to a teacher. */
export async function askTeacher(db: Db, now: Date, payerId: string, teacherId: string, body: string) {
  const live = await db.query("SELECT 1 FROM teacher_profiles t JOIN users u ON u.id = t.user_id WHERE t.user_id = $1 AND t.status IN ('approved','conditional') AND u.status = 'active'", [teacherId]);
  if (!live.rowCount) throw new HttpError(404, "not_found");
  let t = (await db.query<Thread>("SELECT id, payer_id, teacher_id FROM inquiries WHERE payer_id = $1 AND teacher_id = $2", [payerId, teacherId])).rows[0];
  if (!t) {
    const today = (await db.query<{ n: number }>("SELECT count(*)::int AS n FROM inquiries WHERE payer_id = $1 AND created_at > $2", [payerId, new Date(now.getTime() - DAY)])).rows[0]?.n ?? 0;
    if (today >= INQUIRY_MAX_NEW_PER_DAY) throw new HttpError(429, "too_many_inquiries");
    t = (await db.query<Thread>(
      "INSERT INTO inquiries (payer_id, teacher_id, created_at, last_message_at) VALUES ($1,$2,$3,$3) ON CONFLICT (payer_id, teacher_id) DO UPDATE SET payer_id = EXCLUDED.payer_id RETURNING id, payer_id, teacher_id",
      [payerId, teacherId, now],
    )).rows[0]!;
  }
  // The thread exists even if the first message is blocked, so the filter's verdict and any flag have a home.
  const posted = await post(db, now, t, payerId, body);
  return { inquiryId: t.id, ...posted };
}

export async function replyInquiry(db: Db, now: Date, userId: string, inquiryId: string, body: string) {
  const t = await threadFor(db, userId, inquiryId);
  if (userId === t.teacher_id) {
    // A teacher may only answer a thread that someone else opened with a message that got through.
    const asked = await db.query("SELECT 1 FROM messages WHERE inquiry_id = $1 AND sender_id = $2 AND NOT blocked", [t.id, t.payer_id]);
    if (!asked.rowCount) throw new HttpError(403, "not_asked");
  }
  return post(db, now, t, userId, body);
}

export async function listInquiries(db: Db, userId: string) {
  const r = await db.query<{ id: string; payer_id: string; teacher_id: string; other_id: string; other_name: string; last_message_at: Date; seen: Date | null; last_body: string | null; last_sender: string | null }>(
    `SELECT i.id, i.payer_id, i.teacher_id, o.id AS other_id, o.display_name AS other_name, i.last_message_at,
            CASE WHEN i.payer_id = $1 THEN i.payer_seen_at ELSE i.teacher_seen_at END AS seen,
            lm.body AS last_body, lm.sender_id AS last_sender
       FROM inquiries i JOIN users o ON o.id = CASE WHEN i.payer_id = $1 THEN i.teacher_id ELSE i.payer_id END
       LEFT JOIN LATERAL (SELECT body, sender_id FROM messages WHERE inquiry_id = i.id AND NOT blocked ORDER BY created_at DESC, id DESC LIMIT 1) lm ON true
      WHERE (i.payer_id = $1 OR i.teacher_id = $1) AND lm.body IS NOT NULL
      ORDER BY i.last_message_at DESC LIMIT 100`,
    [userId],
  );
  return r.rows.map((x) => ({
    id: x.id,
    viewerRole: x.payer_id === userId ? "payer" : "teacher",
    other: { id: x.other_id, displayName: x.other_name },
    lastAt: x.last_message_at,
    lastPreview: (x.last_body ?? "").slice(0, 80),
    unread: x.last_sender !== userId && (!x.seen || x.seen < x.last_message_at),
  }));
}

export async function inquiryMessages(db: Db, now: Date, userId: string, inquiryId: string, after?: Date) {
  const t = await threadFor(db, userId, inquiryId);
  const r = await db.query<{ id: string; sender_id: string; body: string; created_at: Date }>(
    `SELECT id, sender_id, body, created_at FROM messages WHERE inquiry_id = $1 AND NOT blocked AND ($2::timestamptz IS NULL OR created_at > $2) ORDER BY created_at ASC, id ASC LIMIT 200`,
    [inquiryId, after ?? null],
  );
  await db.query(`UPDATE inquiries SET ${userId === t.payer_id ? "payer_seen_at" : "teacher_seen_at"} = $2 WHERE id = $1`, [inquiryId, now]);
  const other = (await db.query<{ id: string; display_name: string }>("SELECT id, display_name FROM users WHERE id = $1", [userId === t.payer_id ? t.teacher_id : t.payer_id])).rows[0]!;
  return {
    other: { id: other.id, displayName: other.display_name },
    viewerRole: userId === t.payer_id ? "payer" : "teacher",
    items: r.rows.map((m) => ({ id: m.id, mine: m.sender_id === userId, body: m.body, createdAt: m.created_at })),
  };
}
