import { loadConfig } from "../config.js";
import { pgDb } from "../db/db.js";
import { migrate } from "../db/migrate.js";
import { STAFF_ROLES } from "../http/guard.js";
import { PHONE_RE } from "../services/otp.js";
import { audit } from "../services/audit.js";
import { encrypt } from "../security/crypto.js";
import { base32Encode, newTotpSecret, otpauthUri } from "../security/totp.js";

/**
 * Staff accounts cannot be created through the public API. Someone with server access runs:
 *   node dist/cli/create-staff.js --phone +9665XXXXXXXX --name "Full Name" --role vetting_officer
 * It prints the authenticator setup once. The secret is stored encrypted and is not shown again.
 */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

const phone = arg("phone");
const name = arg("name");
const role = arg("role");
if (!phone || !PHONE_RE.test(phone) || !name || name.trim().length < 2 || !role || !(STAFF_ROLES as readonly string[]).includes(role)) {
  console.error(`usage: create-staff --phone +9665XXXXXXXX --name "Full Name" --role ${STAFF_ROLES.join("|")}`);
  process.exit(2);
}

const config = loadConfig();
const db = pgDb(config.databaseUrl);
try {
  await migrate(db);
  const secret = newTotpSecret();
  const id = await db.tx(async (tx) => {
    const exists = await tx.query("SELECT 1 FROM users WHERE mobile = $1", [phone]);
    if (exists.rowCount) throw new Error("a user with this phone already exists");
    const u = await tx.query<{ id: string }>(
      "INSERT INTO users (role, status, mobile, display_name) VALUES ($1,'active',$2,$3) RETURNING id",
      [role, phone, name.trim()],
    );
    const uid = u.rows[0]!.id;
    await tx.query("INSERT INTO staff_mfa (user_id, secret_enc) VALUES ($1,$2)", [uid, encrypt(config.mfaEncKey, secret.toString("hex"))]);
    await audit(tx, { actorId: null, action: "staff.created", targetType: "user", targetId: uid, detail: { role } });
    return uid;
  });
  console.log(`created ${role} ${id}`);
  console.log(`authenticator secret: ${base32Encode(secret)}`);
  console.log(`or scan: ${otpauthUri(secret, phone)}`);
} finally {
  await db.end();
}
