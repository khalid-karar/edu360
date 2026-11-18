import { loadConfig } from "../config.js";
import { pgDb } from "../db/db.js";
import { STAFF_ROLES } from "../http/guard.js";
import { EMAIL_RE, normalizeEmail } from "../services/otp.js";
import { audit } from "../services/audit.js";
import { encrypt } from "../security/crypto.js";
import { base32Encode, newTotpSecret, otpauthUri } from "../security/totp.js";

/**
 * Issues a new authenticator secret for an existing staff account (lost phone, or the setup screen was missed) and signs it out everywhere.
 *   node dist/cli/reset-staff-mfa.js --email name@example.com
 * Someone with server access runs it; there is no way to do this through the API.
 */
const i = process.argv.indexOf("--email");
const email = i > 0 && process.argv[i + 1] ? normalizeEmail(process.argv[i + 1]!) : "";
if (!EMAIL_RE.test(email)) {
  console.error("usage: reset-staff-mfa --email name@example.com");
  process.exit(2);
}

const config = loadConfig();
const db = pgDb(config.databaseUrl);
try {
  const secret = newTotpSecret();
  await db.tx(async (tx) => {
    const u = (await tx.query<{ id: string; role: string }>("SELECT id, role FROM users WHERE email = $1", [email])).rows[0];
    if (!u || !(STAFF_ROLES as readonly string[]).includes(u.role)) throw new Error("no staff account with this email");
    await tx.query(
      `INSERT INTO staff_mfa (user_id, secret_enc) VALUES ($1,$2)
       ON CONFLICT (user_id) DO UPDATE SET secret_enc = EXCLUDED.secret_enc, last_step = 0`,
      [u.id, encrypt(config.mfaEncKey, secret.toString("hex"))],
    );
    await tx.query("UPDATE auth_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [u.id]);
    await audit(tx, { actorId: null, action: "staff.mfa_reset", targetType: "user", targetId: u.id, detail: { role: u.role } });
  });
  console.log(`new authenticator secret: ${base32Encode(secret)}`);
  console.log(`or scan: ${otpauthUri(secret, email)}`);
} finally {
  await db.end();
}
