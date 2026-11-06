import { PGlite } from "@electric-sql/pglite";
import type { Config } from "../../src/config.js";
import type { Db } from "../../src/db/db.js";
import { migrate } from "../../src/db/migrate.js";
import { buildApp } from "../../src/http/app.js";
import { MockNafathProvider } from "../../src/providers/nafath.js";
import { MockSmsProvider } from "../../src/providers/sms.js";
import { encrypt } from "../../src/security/crypto.js";
import { newTotpSecret, totpAt } from "../../src/security/totp.js";

/** A real PostgreSQL (PGlite, in-process) behind the same Db interface the app uses in production. */
function pgliteDb(pg: PGlite): Db {
  type Q = Pick<PGlite, "query" | "exec">;
  const wrap = (q: Q, inTx: boolean): Db => ({
    async query<T>(sql: string, params: readonly unknown[] = []) {
      const r = await q.query<T>(sql, params as unknown[]);
      return { rows: r.rows, rowCount: r.rows.length > 0 ? r.rows.length : (r.affectedRows ?? 0) };
    },
    async exec(sql) {
      await q.exec(sql);
    },
    async tx(fn) {
      if (inTx) return fn(this);
      return pg.transaction((t) => fn(wrap(t, true)));
    },
    end: () => pg.close(),
  });
  return wrap(pg, false);
}

export const config: Config = {
  port: 0,
  databaseUrl: "unused",
  providers: "mock",
  waitlistFile: "/tmp/ilmak-test-waitlist.jsonl",
  idHashKey: Buffer.alloc(32, 1),
  mfaEncKey: Buffer.alloc(32, 2),
  otpKey: Buffer.alloc(32, 3),
  sessionHours: 24 * 30,
  staffSessionHours: 8,
  uploadsPrefix: "uploads/",
  echoOtp: true,
};

export interface Res {
  status: number;
  body: any;
}

let phoneSeq = 0;
export const nextPhone = () => `+9665${String(10_000_000 + ++phoneSeq)}`;

export async function makeHarness() {
  const pg = new PGlite();
  const db = pgliteDb(pg);
  await migrate(db);

  let t = new Date("2026-11-06T09:00:00Z").getTime();
  const clock = {
    now: () => new Date(t),
    advance: (ms: number) => void (t += ms),
  };
  const sms = new MockSmsProvider();
  const nafath = new MockNafathProvider(() => t);
  const app = buildApp({ db, config, sms, nafath, now: clock.now, limits: { global: 100_000, auth: 100_000 } });
  await app.ready();

  async function call(method: "GET" | "POST" | "PUT" | "PATCH", url: string, o: { token?: string; body?: unknown } = {}): Promise<Res> {
    const res = await app.inject({
      method,
      url,
      headers: o.token ? { authorization: `Bearer ${o.token}` } : {},
      ...(o.body !== undefined ? { payload: o.body as object } : {}),
    });
    return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
  }

  /** Full self-registration through the real endpoints. */
  async function signup(role: "learner" | "guardian" | "teacher", name = "مستخدم تجريبي") {
    const phone = nextPhone();
    clock.advance(11 * 60_000); // stay clear of the per-phone code limit
    const rq = await call("POST", "/api/auth/otp/request", { body: { phone } });
    const v = await call("POST", "/api/auth/otp/verify", { body: { phone, code: rq.body.mock_code, role, displayName: name } });
    if (v.status !== 200) throw new Error(`signup failed: ${JSON.stringify(v.body)}`);
    return { phone, token: v.body.token as string, id: v.body.user.id as string };
  }

  /** Runs Nafath for a signed-in user. IDs ending in 0 are rejected and ending in 9 are minors in the mock. */
  async function verifyIdentity(token: string, nationalId = "1234567891") {
    const s = await call("POST", "/api/identity/nafath/start", { token, body: { nationalId } });
    if (s.status !== 200) return { start: s, status: undefined as Res | undefined };
    clock.advance(5000);
    const status = await call("GET", `/api/identity/nafath/status/${s.body.requestId}`, { token });
    return { start: s, status };
  }

  /** Creates a staff user directly (as the CLI does) and returns a signed-in, MFA-verified session. */
  async function staff(role: string) {
    const phone = nextPhone();
    const secret = newTotpSecret();
    const u = await db.query<{ id: string }>("INSERT INTO users (role, status, mobile, display_name) VALUES ($1,'active',$2,$3) RETURNING id", [role, phone, `staff ${role}`]);
    const id = u.rows[0]!.id;
    await db.query("INSERT INTO staff_mfa (user_id, secret_enc) VALUES ($1,$2)", [id, encrypt(config.mfaEncKey, secret.toString("hex"))]);
    const code = () => totpAt(secret, Math.floor(clock.now().getTime() / 30_000));
    async function login(verifyMfa = true, advance = true) {
      if (advance) clock.advance(11 * 60_000);
      const rq = await call("POST", "/api/auth/otp/request", { body: { phone } });
      const v = await call("POST", "/api/auth/otp/verify", { body: { phone, code: rq.body.mock_code } });
      if (verifyMfa) {
        clock.advance(30_000); // a fresh TOTP step each login
        const m = await call("POST", "/api/auth/mfa/verify", { token: v.body.token, body: { code: code() } });
        if (m.status !== 200) throw new Error(`mfa failed: ${JSON.stringify(m.body)}`);
      }
      return { token: v.body.token as string, res: v };
    }
    return { id, phone, secret, code, login, ...(await login()) };
  }

  async function category(slug = "quran", min = 5000, max = 20000) {
    const r = await db.query<{ id: number }>(
      "INSERT INTO categories (slug, name_ar, name_en, min_price_halalas, max_price_halalas) VALUES ($1,$2,$3,$4,$5) RETURNING id",
      [slug, "القرآن", slug, min, max],
    );
    return r.rows[0]!.id;
  }

  return { db, app, call, clock, sms, nafath, signup, verifyIdentity, staff, category };
}

/** A checksum-valid Saudi IBAN for tests. */
export function makeIban(bank = "80", account = "000000608010167519"): string {
  const bban = bank + account;
  const check = 98n - (BigInt(bban + "281000") % 97n); // S=28, A=10, then 00
  return `SA${String(check).padStart(2, "0")}${bban}`;
}
