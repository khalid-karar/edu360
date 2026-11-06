import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, type Browser, type Page } from "@playwright/test";
import { SECRETS_FILE } from "../playwright.config";

const API = "http://127.0.0.1:3000/api";

/** Direct API calls, for setting up a scenario without clicking through it. */
export async function api(method: string, path: string, body?: unknown, token?: string) {
  const r = await fetch(API + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`${method} ${path} ${r.status} ${JSON.stringify(json)}`);
  return json;
}

export async function apiLogin(phone: string): Promise<string> {
  const r = await api("POST", "/auth/otp/request", { phone });
  return (await api("POST", "/auth/otp/verify", { phone, code: r.mock_code })).token;
}

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function unbase32(s: string): Buffer {
  let bits = "";
  for (const c of s) bits += B32.indexOf(c).toString(2).padStart(5, "0");
  const out: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(out);
}
/** Current authenticator code. `step` shifts by 30-second windows: a code cannot be used twice in one window. */
export function totp(phone: string, step = 0): string {
  const secrets = JSON.parse(readFileSync(SECRETS_FILE, "utf8")) as Record<string, string>;
  const n = Math.floor(Date.now() / 30_000) + step;
  const b = Buffer.alloc(8);
  b.writeBigUInt64BE(BigInt(n));
  const h = createHmac("sha1", unbase32(secrets[phone]!)).update(b).digest();
  const o = h[19]! & 15;
  const code = (((h[o]! & 127) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!) % 1_000_000;
  return String(code).padStart(6, "0");
}

/** Signs in through the page. The sandbox shows the one-time code on screen with a "fill" button. */
export async function signIn(page: Page, phone: string) {
  page.on("dialog", (d) => void d.accept()); // the app asks "are you sure?" with confirm(); Playwright would dismiss it
  await page.goto("/portal/login");
  await page.fill("input.ltr", phone.replace("+966", "0"));
  await page.click("text=إرسال الرمز");
  await page.click("text=تعبئة");
  await page.click("button:has-text('تأكيد')");
}

export async function signInStaff(browser: Browser, phone: string, step = 0) {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 }, locale: "ar-SA" });
  const page = await ctx.newPage();
  await signIn(page, phone);
  await page.fill("input.otp", totp(phone, step));
  await page.click("button:has-text('تأكيد')");
  await page.waitForURL("**/portal/staff**");
  return page;
}

export const expectNoPageErrors = (page: Page) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return () => expect(errors).toEqual([]);
};
