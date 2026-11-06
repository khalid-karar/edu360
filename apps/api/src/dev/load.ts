/**
 * Load and race test against a real PostgreSQL. Not part of the normal test run.
 *   createdb ilmak_load && DATABASE_URL=postgres://localhost/ilmak_load node dist/dev/load.js
 * Starts the API on :3100 with mock providers and no rate limits, seeds teachers and learners, then measures
 * throughput and latency and checks that concurrent requests cannot double-book a slot or refund twice.
 */
import { randomBytes } from "node:crypto";
import type { Config } from "../config.js";
import { migrate } from "../db/migrate.js";
import { pgDb } from "../db/db.js";
import { buildApp } from "../http/app.js";
import { MockPaymentProvider } from "../payments/mock.js";
import { MockNafathProvider } from "../providers/nafath.js";
import { MockSmsProvider } from "../providers/sms.js";
import { createSession } from "../services/sessions.js";
import { MockVideo } from "../video/provider.js";

const TEACHERS = Number(process.env["TEACHERS"] ?? 200);
const LEARNERS = Number(process.env["LEARNERS"] ?? 1000);
const READ_SECONDS = Number(process.env["READ_SECONDS"] ?? 15);
const CONCURRENCY = Number(process.env["CONCURRENCY"] ?? 50);
const PORT = 3100;
const BASE = `http://127.0.0.1:${PORT}/api`;
const HOUR = 3_600_000;

const config: Config = {
  port: PORT, databaseUrl: process.env["DATABASE_URL"]!, providers: "mock", payments: "mock", webhookSecret: "x",
  waitlistFile: "/tmp/ilmak-load-waitlist.jsonl", idHashKey: randomBytes(32), mfaEncKey: randomBytes(32), otpKey: randomBytes(32),
  sessionHours: 24, staffSessionHours: 8, uploadsPrefix: "uploads/", echoOtp: true,
};
const db = pgDb(config.databaseUrl);
await migrate(db);
const payments = new MockPaymentProvider();
const ctx = { db, config, sms: new MockSmsProvider(), nafath: new MockNafathProvider(), payments, video: new MockVideo(), mockPayments: payments, now: () => new Date(), limits: { global: 1e9, auth: 1e9 } };
const app = buildApp(ctx);
await app.listen({ port: PORT, host: "127.0.0.1" });

// ── seed ──
const cat = (await db.query<{ id: number }>("INSERT INTO categories (slug, name_ar, name_en, min_price_halalas, max_price_halalas) VALUES ($1,'القرآن','quran',5000,20000) ON CONFLICT (slug) DO UPDATE SET slug = EXCLUDED.slug RETURNING id", [`quran-${Date.now()}`])).rows[0]!.id;
const t0 = Date.now();
const day = new Date(Date.now() + 2 * 24 * HOUR);
day.setUTCHours(6, 0, 0, 0);
interface Person { id: string; token: string }
async function person(role: "teacher" | "learner", i: number): Promise<Person> {
  const u = (await db.query<{ id: string }>("INSERT INTO users (role, status, mobile, display_name) VALUES ($1,'active',$2,$3) RETURNING id", [role, `+9665${role === "teacher" ? 1 : 2}${String(i).padStart(7, "0")}${Math.floor(Math.random() * 1e3)}`.slice(0, 13), `${role} ${i}`])).rows[0]!.id;
  await db.query("INSERT INTO identity_verifications (user_id, national_id_hash, full_name, gender, date_of_birth) VALUES ($1,$2,$3,'male','1990-01-01')", [u, randomBytes(16).toString("hex"), `${role} ${i}`]);
  if (role === "teacher") {
    await db.query("INSERT INTO teacher_profiles (user_id, status, bio, languages, iban, iban_holder_name, approved_at, freelance_document_no) VALUES ($1,'approved','نبذة',$2,'SA0380000000608010167519','x',now() - interval '60 days','FL-1')", [u, ["ar"]]);
    await db.query("INSERT INTO teacher_categories (teacher_id, category_id, price_halalas, approved) VALUES ($1,$2,10000,true)", [u, cat]);
    await db.query("INSERT INTO availability (teacher_id, starts_at, ends_at) VALUES ($1,$2,$3)", [u, day, new Date(day.getTime() + 12 * HOUR)]);
  }
  const s = await createSession(db, { userId: u, mfaVerified: false, hours: 24, ip: undefined, userAgent: undefined, now: new Date() });
  return { id: u, token: s.token };
}
const teachers: Person[] = [];
const learners: Person[] = [];
for (let i = 0; i < TEACHERS; i++) teachers.push(await person("teacher", i));
for (let i = 0; i < LEARNERS; i++) learners.push(await person("learner", i));
console.log(`seeded ${TEACHERS} teachers and ${LEARNERS} learners in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

// ── helpers ──
async function call(method: string, path: string, token: string, body?: unknown) {
  const t = performance.now();
  const r = await fetch(BASE + path, { method, headers: { ...(body ? { "content-type": "application/json" } : {}), authorization: `Bearer ${token}` }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const json = await r.json().catch(() => null);
  return { status: r.status, json, ms: performance.now() - t };
}
const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))] ?? 0;
function report(name: string, ms: number[], statuses: Map<number, number>, seconds: number) {
  const codes = [...statuses].map(([k, v]) => `${k}:${v}`).join(" ");
  console.log(`${name.padEnd(28)} ${(ms.length / seconds).toFixed(0).padStart(5)} req/s  p50 ${pct(ms, 0.5).toFixed(0)}ms  p95 ${pct(ms, 0.95).toFixed(0)}ms  p99 ${pct(ms, 0.99).toFixed(0)}ms  [${codes}]`);
}
async function pool<T>(n: number, until: () => boolean, work: (i: number) => Promise<T>) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (!until()) await work(i++); }));
}

// ── 1. read traffic ──
{
  const ms: number[] = [];
  const st = new Map<number, number>();
  const end = Date.now() + READ_SECONDS * 1000;
  await pool(CONCURRENCY, () => Date.now() > end, async (i) => {
    const l = learners[i % learners.length]!;
    const tch = teachers[i % teachers.length]!;
    const path = [`/teachers?categoryId=${cat}`, `/teachers/${tch.id}`, `/teachers/${tch.id}/slots`, "/bookings", "/notifications/unread-count"][i % 5]!;
    const r = await call("GET", path, l.token);
    ms.push(r.ms);
    st.set(r.status, (st.get(r.status) ?? 0) + 1);
  });
  report(`reads (${CONCURRENCY} parallel)`, ms, st, READ_SECONDS);
}

// ── 2. full booking flow, every learner with a different teacher/slot ──
{
  const ms: number[] = [];
  const st = new Map<number, number>();
  const bad: string[] = [];
  const start = performance.now();
  let n = 0;
  const jobs = learners.slice(0, Math.min(LEARNERS, TEACHERS * 10));
  await pool(Math.min(CONCURRENCY, 30), () => n >= jobs.length, async () => {
    const i = n++;
    if (i >= jobs.length) return;
    const l = jobs[i]!;
    const tch = teachers[i % TEACHERS]!;
    const slot = new Date(day.getTime() + (Math.floor(i / TEACHERS) % 12) * HOUR);
    const b = await call("POST", "/bookings", l.token, { teacherId: tch.id, categoryId: cat, startsAt: slot.toISOString() });
    ms.push(b.ms); st.set(b.status, (st.get(b.status) ?? 0) + 1);
    if (b.status !== 201) return void bad.push(`book ${b.status} ${JSON.stringify(b.json)}`);
    const pay = payments.authorize(b.json.amountHalalas, { booking_id: b.json.bookingId });
    const p = await call("POST", `/bookings/${b.json.bookingId}/payment`, l.token, { paymentId: pay.id });
    ms.push(p.ms); st.set(p.status, (st.get(p.status) ?? 0) + 1);
    if (p.status !== 200) return void bad.push(`pay ${p.status} ${JSON.stringify(p.json)}`);
    const a = await call("POST", `/bookings/${b.json.bookingId}/accept`, tch.token);
    ms.push(a.ms); st.set(a.status, (st.get(a.status) ?? 0) + 1);
    if (a.status !== 200) bad.push(`accept ${a.status} ${JSON.stringify(a.json)}`);
  });
  report("book + pay + accept", ms, st, (performance.now() - start) / 1000);
  if (bad.length) console.log("  unexpected:", bad.slice(0, 5));
}

// ── 3. races ──
let failures = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? "PASS" : "FAIL"}  ${what}`); if (!ok) failures++; };
{
  const tch = teachers[0]!;
  const slot = new Date(day.getTime() + 11 * HOUR + 0); // a slot the flow above did not use on teacher 0 only if jobs < 12*TEACHERS; use the last hour
  const rs = await Promise.all(learners.slice(-50).map((l) => call("POST", "/bookings", l.token, { teacherId: tch.id, categoryId: cat, startsAt: new Date(slot.getTime() + 0).toISOString() })));
  const won = rs.filter((r) => r.status === 201).length;
  const rows = (await db.query<{ n: number }>("SELECT count(*)::int AS n FROM bookings WHERE teacher_id = $1 AND starts_at = $2 AND status NOT IN ('cancelled','declined')", [tch.id, slot])).rows[0]!.n;
  check(won <= 1 && rows <= 1, `50 learners racing for one slot: ${won} accepted, ${rows} live booking rows (must be at most 1)`);
}
{
  // a finished first lesson, claimed by the payer 20 times at once
  const l = learners[LEARNERS - 1]!;
  const tch = teachers[TEACHERS - 1]!;
  const startsAt = new Date(Date.now() - 3 * HOUR);
  const bk = (await db.query<{ id: string }>("INSERT INTO bookings (learner_id, payer_id, teacher_id, category_id, status, starts_at, duration_min, price_halalas) VALUES ($1,$1,$2,$3,'completed',$4,60,10000) RETURNING id", [l.id, tch.id, cat, startsAt])).rows[0]!.id;
  const pay = payments.authorize(10000, { booking_id: bk });
  await payments.capture(pay.id);
  const cap = new Date(startsAt.getTime() + HOUR);
  await db.query("INSERT INTO payments (booking_id, psp_reference, amount_halalas, captured_halalas, commission_halalas, status, authorized_at, captured_at, payout_eligible_at, created_at) VALUES ($1,$2,10000,10000,2000,'captured',$3,$4,$5,$3)", [bk, pay.id, startsAt, cap, new Date(cap.getTime() + 48 * HOUR)]);
  const rs = await Promise.all(Array.from({ length: 20 }, () => call("POST", `/bookings/${bk}/guarantee`, l.token, { why: "other" })));
  const ok = rs.filter((r) => r.status === 200).length;
  const p = await payments.getPayment(pay.id);
  const claims = (await db.query<{ n: number }>("SELECT count(*)::int AS n FROM disputes WHERE booking_id = $1", [bk])).rows[0]!.n;
  check(ok === 1 && claims === 1 && (p.refundedAmount ?? 0) === 10000, `20 simultaneous guarantee claims: ${ok} succeeded, ${claims} claim rows, provider refunded ${p.refundedAmount ?? 0} (must be 1, 1, 10000)`);
}
{
  // accept and decline and cancel at once on one request
  const l = learners[5]!;
  const tch = teachers[7]!;
  const slot = new Date(day.getTime() + 11 * HOUR);
  const b = await call("POST", "/bookings", l.token, { teacherId: tch.id, categoryId: cat, startsAt: slot.toISOString() });
  if (b.status === 201) {
    const pay = payments.authorize(b.json.amountHalalas, { booking_id: b.json.bookingId });
    await call("POST", `/bookings/${b.json.bookingId}/payment`, l.token, { paymentId: pay.id });
    const rs = await Promise.all([
      call("POST", `/bookings/${b.json.bookingId}/accept`, tch.token),
      call("POST", `/bookings/${b.json.bookingId}/decline`, tch.token),
      call("POST", `/bookings/${b.json.bookingId}/cancel`, l.token),
      call("POST", `/bookings/${b.json.bookingId}/accept`, tch.token),
    ]);
    const final = (await db.query<{ status: string }>("SELECT status FROM bookings WHERE id = $1", [b.json.bookingId])).rows[0]!.status;
    const holds = (await payments.getPayment(pay.id)).status;
    const consistent = (final === "confirmed" && holds === "authorized") || (["declined", "cancelled"].includes(final) && holds === "voided");
    check(consistent, `accept/decline/cancel at once -> booking ${final}, card hold ${holds}, replies ${rs.map((r) => r.status).join("/")}`);
  } else console.log(`SKIP  accept/decline race (booking setup returned ${b.status})`);
}

{
  // five finance runs at once over 60 payments that are ready: every payment must land in exactly one payout
  const fin = (await db.query<{ id: string }>("INSERT INTO users (role, status, mobile, display_name) VALUES ('finance_officer','active','+966500009999','fin') RETURNING id")).rows[0]!.id;
  const ft = (await createSession(db, { userId: fin, mfaVerified: true, hours: 1, ip: undefined, userAgent: undefined, now: new Date() })).token;
  const old = new Date(Date.now() - 10 * 24 * HOUR);
  for (let i = 0; i < 60; i++) {
    const tch = teachers[100 + (i % 20)]!;
    const l = learners[500 + i]!;
    const bk = (await db.query<{ id: string }>("INSERT INTO bookings (learner_id, payer_id, teacher_id, category_id, status, starts_at, duration_min, price_halalas) VALUES ($1,$1,$2,$3,'completed',$4,60,10000) RETURNING id", [l.id, tch.id, cat, old])).rows[0]!.id;
    await db.query("INSERT INTO payments (booking_id, psp_reference, amount_halalas, captured_halalas, commission_halalas, status, authorized_at, captured_at, payout_eligible_at, created_at) VALUES ($1,$2,10000,10000,2000,'captured',$3,$3,$3,$3)", [bk, `psp_load_${i}_${Date.now()}`, old]);
  }
  const rs = await Promise.all(Array.from({ length: 5 }, () => call("POST", "/admin/finance/payout-runs", ft, {})));
  const linked = (await db.query<{ n: number }>("SELECT count(*)::int AS n FROM payments WHERE payout_id IS NOT NULL AND psp_reference LIKE 'psp_load_%'")).rows[0]!.n;
  const paid = (await db.query<{ s: string | null }>("SELECT sum(amount_halalas)::text AS s FROM payouts WHERE teacher_id = ANY($1::uuid[])", [teachers.slice(100, 120).map((t) => t.id)])).rows[0]!.s;
  const dup = (await db.query<{ n: number }>("SELECT count(*)::int AS n FROM (SELECT teacher_id FROM payouts WHERE teacher_id = ANY($1::uuid[]) GROUP BY teacher_id HAVING count(*) > 1) x", [teachers.slice(100, 120).map((t) => t.id)])).rows[0]!.n;
  check(linked === 60 && Number(paid) === 60 * 8000 && dup === 0, `5 simultaneous payout runs (replies ${rs.map((r) => r.status).join("/")}): ${linked}/60 payments linked, ${paid} halalas paid out (expect 480000), ${dup} teachers with two payouts (expect 0)`);
}

console.log(failures ? `\n${failures} check(s) FAILED` : "\nall race checks passed");
await app.close();
await db.end();
process.exit(failures ? 1 : 0);
