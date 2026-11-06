/**
 * Local sandbox: the whole API on an in-memory PostgreSQL (PGlite) with every provider faked and some
 * demo data, so the web app can be developed and clicked through with nothing installed.
 *   npm run build && node dist/dev/local.js
 * Nothing is saved. Never run this on a public server.
 */
import { randomBytes } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import type { Config } from "../config.js";
import { migrate } from "../db/migrate.js";
import { pgliteDb } from "../db/pglite.js";
import { buildApp } from "../http/app.js";
import { MockPaymentProvider } from "../payments/mock.js";
import { MockNafathProvider } from "../providers/nafath.js";
import { MockVideo } from "../video/provider.js";
import { MockSmsProvider } from "../providers/sms.js";
import { expireStale } from "../services/bookings.js";
import { encrypt } from "../security/crypto.js";
import { base32Encode, newTotpSecret, totpAt } from "../security/totp.js";

const port = Number(process.env["PORT"] ?? 3000);
const config: Config = {
  port,
  databaseUrl: "memory",
  providers: "mock",
  payments: "mock",
  webhookSecret: "local-webhook-secret",
  waitlistFile: "/tmp/ilmak-local-waitlist.jsonl",
  idHashKey: randomBytes(32),
  mfaEncKey: randomBytes(32),
  otpKey: randomBytes(32),
  sessionHours: 24 * 30,
  staffSessionHours: 8,
  uploadsPrefix: "uploads/",
  echoOtp: true,
};

const db = pgliteDb(new PGlite());
await migrate(db);

const payments = new MockPaymentProvider();
const ctx = { db, config, sms: new MockSmsProvider(), nafath: new MockNafathProvider(), payments, video: new MockVideo(), mockPayments: payments, now: () => new Date(), limits: { global: 100_000, auth: 100_000 } };

// ── demo data ──
const cats = [
  ["quran", "القرآن الكريم وتجويده", "Quran", 5000, 20000, true],
  ["math", "الرياضيات", "Math", 4000, 15000, true],
  ["english", "اللغة الإنجليزية", "English", 4000, 15000, true],
  ["calligraphy", "الخط العربي", "Calligraphy", 4000, 15000, true],
  ["coding", "البرمجة", "Coding", 6000, 25000, false],
] as const;
const catIds: Record<string, number> = {};
for (const [slug, ar, en, min, max, minors] of cats) {
  const r = await db.query<{ id: number }>("INSERT INTO categories (slug, name_ar, name_en, min_price_halalas, max_price_halalas, allows_minors) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id", [slug, ar, en, min, max, minors]);
  catIds[slug] = r.rows[0]!.id;
}

const teachers = [
  { name: "محمد القحطاني", gender: "male", phone: "+966500000101", cats: [["quran", 10000]], bio: "معلم قرآن كريم بإجازة متصلة السند برواية حفص، خبرة عشر سنوات في تعليم الأطفال والكبار." },
  { name: "نورة العتيبي", gender: "female", phone: "+966500000102", cats: [["quran", 9000], ["calligraphy", 8000]], bio: "معلمة قرآن وخط عربي، أدرّس الصغار بأسلوب مبسّط وممتع، خبرة سبع سنوات." },
  { name: "خالد الشهري", gender: "male", phone: "+966500000103", cats: [["math", 7000], ["coding", 12000]], bio: "مهندس برمجيات ومدرّس رياضيات للمرحلتين المتوسطة والثانوية، وتأسيس البرمجة للمبتدئين." },
  { name: "ريم الدوسري", gender: "female", phone: "+966500000104", cats: [["english", 8000]], bio: "معلمة لغة إنجليزية حاصلة على IELTS 8.0، أدرّس المحادثة والقواعد لجميع المستويات." },
] as const;
const day = 86_400_000;
for (const t of teachers) {
  const u = await db.query<{ id: string }>("INSERT INTO users (role, status, mobile, display_name) VALUES ('teacher','active',$1,$2) RETURNING id", [t.phone, t.name]);
  const id = u.rows[0]!.id;
  await db.query("INSERT INTO identity_verifications (user_id, national_id_hash, full_name, gender, date_of_birth) VALUES ($1,$2,$3,$4,'1988-04-12')", [id, randomBytes(16).toString("hex"), t.name, t.gender]);
  await db.query(
    `INSERT INTO teacher_profiles (user_id, status, bio, languages, iban, iban_holder_name, approved_at, freelance_document_no, completed_sessions)
     VALUES ($1,'approved',$2,$3,'SA0380000000608010167519',$4,now() - interval '60 days','FL-100200',$5)`,
    [id, t.bio, t.name === "ريم الدوسري" ? ["ar", "en"] : ["ar"], t.name, 20 + Math.floor(Math.random() * 80)],
  );
  for (const [slug, price] of t.cats) await db.query("INSERT INTO teacher_categories (teacher_id, category_id, price_halalas, approved) VALUES ($1,$2,$3,true)", [id, catIds[slug]!, price]);
  for (let d = 1; d <= 6; d++) {
    const start = new Date(Date.now() + d * day);
    start.setUTCHours(13, 0, 0, 0); // 16:00 Riyadh
    await db.query("INSERT INTO availability (teacher_id, starts_at, ends_at) VALUES ($1,$2,$3)", [id, start, new Date(start.getTime() + 6 * 3_600_000)]);
  }
}

// Finished, paid lessons for the finance and guarantee demos.
async function seedLesson(learnerId: string, teacherMobile: string, quranCat: number, hoursAgo: number) {
  const teacherId = (await db.query<{ id: string }>("SELECT id FROM users WHERE mobile = $1", [teacherMobile])).rows[0]!.id;
  const startsAt = new Date(Date.now() - hoursAgo * 3_600_000);
  const b = await db.query<{ id: string }>(
    "INSERT INTO bookings (learner_id, payer_id, teacher_id, category_id, status, starts_at, duration_min, price_halalas) VALUES ($1,$1,$2,$3,'completed',$4,60,10000) RETURNING id",
    [learnerId, teacherId, quranCat, startsAt],
  );
  const pay = payments.authorize(10000, { booking_id: b.rows[0]!.id });
  await payments.capture(pay.id);
  const capturedAt = new Date(startsAt.getTime() + 3_600_000);
  await db.query(
    `INSERT INTO payments (booking_id, psp_reference, amount_halalas, captured_halalas, commission_halalas, status, authorized_at, captured_at, payout_eligible_at, created_at)
     VALUES ($1,$2,10000,10000,2000,'captured',$3,$4,$5,$3)`,
    [b.rows[0]!.id, pay.id, startsAt, capturedAt, new Date(capturedAt.getTime() + 48 * 3_600_000)],
  );
}
{
  // Waleed: one old lesson (ready to pay out) and one inside the dispute window, both with Mohammed.
  const l = await db.query<{ id: string }>("INSERT INTO users (role, status, mobile, display_name) VALUES ('learner','active','+966500000301','وليد المطيري') RETURNING id");
  await db.query("INSERT INTO identity_verifications (user_id, national_id_hash, full_name, gender, date_of_birth) VALUES ($1,$2,'وليد المطيري','male','1999-01-20')", [l.rows[0]!.id, randomBytes(16).toString("hex")]);
  await seedLesson(l.rows[0]!.id, "+966500000101", catIds["quran"]!, 5 * 24);
  await seedLesson(l.rows[0]!.id, "+966500000101", catIds["quran"]!, 4);
  // Hind: her first lesson with Noura finished 3 hours ago, so the first-lesson guarantee applies.
  const h = await db.query<{ id: string }>("INSERT INTO users (role, status, mobile, display_name) VALUES ('learner','active','+966500000302','هند الزهراني') RETURNING id");
  await db.query("INSERT INTO identity_verifications (user_id, national_id_hash, full_name, gender, date_of_birth) VALUES ($1,$2,'هند الزهراني','female','2001-05-11')", [h.rows[0]!.id, randomBytes(16).toString("hex")]);
  await seedLesson(h.rows[0]!.id, "+966500000102", catIds["quran"]!, 3);
}

// A teacher application waiting for the vetting officer.
{
  const u = await db.query<{ id: string }>("INSERT INTO users (role, status, mobile, display_name) VALUES ('teacher','active','+966500000105','سارة الحربي') RETURNING id");
  const id = u.rows[0]!.id;
  await db.query("INSERT INTO identity_verifications (user_id, national_id_hash, full_name, gender, date_of_birth) VALUES ($1,$2,'سارة الحربي','female','1993-09-02')", [id, randomBytes(16).toString("hex")]);
  await db.query(
    `INSERT INTO teacher_profiles (user_id, status, bio, languages, iban, iban_holder_name, freelance_document_no, code_of_conduct_version, submitted_at)
     VALUES ($1,'submitted','معلمة رياضيات للمرحلة المتوسطة، خبرة خمس سنوات في التدريس الخصوصي.',$2,'SA0380000000608010167520','سارة الحربي','FL-300400','1.0',now() - interval '2 days')`,
    [id, ["ar"]],
  );
  await db.query("INSERT INTO teacher_categories (teacher_id, category_id, price_halalas, approved) VALUES ($1,$2,6000,false)", [id, catIds["math"]!]);
  await db.query("INSERT INTO credentials (teacher_id, category_id, kind, file_url) VALUES ($1,$2,'degree','uploads/demo-degree.pdf')", [id, catIds["math"]!]);
}

const staff = [
  ["vetting_officer", "+966500000201", "موظف التدقيق"],
  ["safety_officer", "+966500000202", "موظف الأمان"],
  ["safety_officer", "+966500000206", "موظف الأمان الثاني"],
  ["finance_officer", "+966500000203", "موظف المالية"],
  ["finance_officer", "+966500000205", "موظف المالية الثاني"],
  ["super_admin", "+966500000204", "مدير النظام"],
] as const;
const secrets = new Map<string, Buffer>();
for (const [role, phone, name] of staff) {
  const u = await db.query<{ id: string }>("INSERT INTO users (role, status, mobile, display_name) VALUES ($1,'active',$2,$3) RETURNING id", [role, phone, name]);
  const secret = newTotpSecret();
  secrets.set(phone, secret);
  await db.query("INSERT INTO staff_mfa (user_id, secret_enc) VALUES ($1,$2)", [u.rows[0]!.id, encrypt(config.mfaEncKey, secret.toString("hex"))]);
}

const app = buildApp(ctx);
const sweep = setInterval(() => void expireStale(ctx).catch(() => {}), 60_000);
sweep.unref();
await app.listen({ port, host: "127.0.0.1" });

console.log(`ilmak local sandbox on http://127.0.0.1:${port}  (in-memory, resets on restart)`);
console.log("\nTeachers (log in with the phone; the code is shown on screen):");
for (const t of teachers) console.log(`  ${t.phone}  ${t.name}`);
console.log("\nStaff (phone + current authenticator code):");
for (const [role, phone] of staff) console.log(`  ${phone}  ${role}  secret ${base32Encode(secrets.get(phone)!)}  code now ${totpAt(secrets.get(phone)!, Math.floor(Date.now() / 30_000))}`);
console.log("\nNew learners and guardians sign up with any phone +9665XXXXXXXX. Nafath ID: any 10 digits starting 1 not ending in 0 or 9.");
