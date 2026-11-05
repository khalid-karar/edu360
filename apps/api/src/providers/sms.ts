import { randomInt } from "node:crypto";

export interface SmsProvider {
  send(toE164: string, text: string): Promise<void>;
}

/** Test SMS gateway: nothing leaves the server. Messages are kept in memory for inspection. */
export class MockSmsProvider implements SmsProvider {
  readonly outbox: { to: string; text: string; at: Date }[] = [];
  async send(to: string, text: string) {
    this.outbox.push({ to, text, at: new Date() });
    if (this.outbox.length > 200) this.outbox.shift();
  }
}

const TTL_MS = 5 * 60_000;
const MAX_ATTEMPTS = 5;

/** One-time-code login. Codes are hashed-by-comparison only in memory and expire after 5 minutes. */
export class OtpService {
  private readonly pending = new Map<string, { code: string; expires: number; attempts: number }>();
  constructor(private readonly sms: SmsProvider, private readonly now: () => number = Date.now) {}

  async request(phone: string): Promise<string> {
    if (!/^\+9665\d{8}$/.test(phone)) throw new Error("invalid_phone");
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    this.pending.set(phone, { code, expires: this.now() + TTL_MS, attempts: 0 });
    await this.sms.send(phone, `رمز التحقق في عِلمك: ${code}`);
    return code;
  }

  verify(phone: string, code: string): boolean {
    const p = this.pending.get(phone);
    if (!p || p.expires < this.now() || p.attempts >= MAX_ATTEMPTS) return false;
    p.attempts++;
    if (p.code !== code) return false;
    this.pending.delete(phone);
    return true;
  }
}
