import type { Db } from "../db/db.js";
import { render, type NoticeKind, type NoticeVars } from "../domain/notifications.js";
import type { SmsProvider } from "../providers/sms.js";

export interface NewNotice {
  userId: string;
  kind: NoticeKind;
  vars?: NoticeVars;
  link?: string;
  /** Same key twice is one notification. */
  dedupeKey?: string;
}

/** Call inside the transaction of the event it announces, so a rolled-back event announces nothing. */
export async function notify(db: Db, n: NewNotice, now: Date): Promise<void> {
  const r = render(n.kind, n.vars);
  await db.query(
    `INSERT INTO notifications (user_id, kind, title, body, link, dedupe_key, sms, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (dedupe_key) DO NOTHING`,
    [n.userId, n.kind, r.title, r.body, n.link ?? null, n.dedupeKey ?? null, r.sms, now],
  );
}

/** Riyadh is a fixed UTC+3 all year. */
export function riyadhWhen(d: Date): string {
  const f = new Intl.DateTimeFormat("ar-SA-u-nu-latn", { timeZone: "Asia/Riyadh", weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit" });
  return f.format(d);
}

const SMS_BATCH = 50;
const SMS_MAX_ATTEMPTS = 3;
const SMS_MAX_AGE_HOURS = 6; // a late "your lesson starts soon" is worse than none

/** Sends the texts that are due. A failure is retried on the next sweep, up to three times, then dropped. */
export async function deliverSms(db: Db, sms: SmsProvider, now: Date): Promise<{ sent: number; failed: number }> {
  const due = await db.query<{ id: string; mobile: string | null; title: string; body: string }>(
    `SELECT n.id, u.mobile, n.title, n.body FROM notifications n JOIN users u ON u.id = n.user_id
      WHERE n.sms AND n.sms_sent_at IS NULL AND n.sms_attempts < $1 AND n.created_at > $2
      ORDER BY n.created_at LIMIT ${SMS_BATCH}`,
    [SMS_MAX_ATTEMPTS, new Date(now.getTime() - SMS_MAX_AGE_HOURS * 3_600_000)],
  );
  const out = { sent: 0, failed: 0 };
  for (const n of due.rows) {
    if (!n.mobile) {
      await db.query("UPDATE notifications SET sms_attempts = $2 WHERE id = $1", [n.id, SMS_MAX_ATTEMPTS]); // a child has no phone: nothing to send
      continue;
    }
    try {
      await sms.send(n.mobile, `عِلمك: ${n.title}. ${n.body}`);
      await db.query("UPDATE notifications SET sms_sent_at = $2, sms_attempts = sms_attempts + 1 WHERE id = $1", [n.id, now]);
      out.sent++;
    } catch {
      await db.query("UPDATE notifications SET sms_attempts = sms_attempts + 1 WHERE id = $1", [n.id]);
      out.failed++;
    }
  }
  return out;
}

/** One reminder per person for each confirmed lesson starting within the next hour. */
export async function sendReminders(db: Db, now: Date): Promise<number> {
  const soon = new Date(now.getTime() + 60 * 60_000);
  const rows = await db.query<{ id: string; starts_at: Date; teacher_id: string; payer_id: string; teacher_name: string; learner_name: string }>(
    `SELECT b.id, b.starts_at, b.teacher_id, b.payer_id, tu.display_name AS teacher_name, lu.display_name AS learner_name
       FROM bookings b JOIN users tu ON tu.id = b.teacher_id JOIN users lu ON lu.id = b.learner_id
      WHERE b.status = 'confirmed' AND b.reminded_at IS NULL AND b.starts_at > $1 AND b.starts_at <= $2 LIMIT 200`,
    [now, soon],
  );
  for (const b of rows.rows) {
    await db.tx(async (tx) => {
      const when = riyadhWhen(b.starts_at);
      const link = `/portal/booking?id=${b.id}`;
      await notify(tx, { userId: b.teacher_id, kind: "lesson_reminder", vars: { who: b.learner_name, when }, link, dedupeKey: `reminder:${b.id}:t` }, now);
      await notify(tx, { userId: b.payer_id, kind: "lesson_reminder", vars: { who: b.teacher_name, when }, link, dedupeKey: `reminder:${b.id}:p` }, now);
      await tx.query("UPDATE bookings SET reminded_at = $2 WHERE id = $1", [b.id, now]);
    });
  }
  return rows.rows.length;
}
