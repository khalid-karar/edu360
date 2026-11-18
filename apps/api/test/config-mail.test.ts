import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const base = { DATABASE_URL: "postgres://x", ID_HASH_KEY: "a".repeat(64), MFA_ENC_KEY: "b".repeat(64) };

describe("mail settings", () => {
  it("defaults to mock mail, which echoes the code", () => {
    const c = loadConfig(base);
    expect(c.echoOtp).toBe(true);
    expect(c.mail).toBeUndefined();
  });

  it("refuses smtp without the full set of values", () => {
    expect(() => loadConfig({ ...base, MAIL_MODE: "smtp", SMTP_HOST: "smtp.example.com" })).toThrow(/MAIL_MODE=smtp needs/);
  });

  it("real mail never echoes the code", () => {
    const c = loadConfig({ ...base, MAIL_MODE: "smtp", SMTP_HOST: "smtp.example.com", SMTP_USER: "u", SMTP_PASS: "p", MAIL_FROM: "Ilmak <no-reply@example.com>" });
    expect(c.echoOtp).toBe(false);
    expect(c.mail).toEqual({ host: "smtp.example.com", port: 587, user: "u", pass: "p", from: "Ilmak <no-reply@example.com>" });
  });
});
