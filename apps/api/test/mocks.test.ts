import { describe, expect, it } from "vitest";
import { MockNafathProvider, MockPaymentProvider, MockSmsProvider, OtpService, confirmAuthorization } from "../src/index.js";

describe("mock payments", () => {
  it("authorize -> capture partial -> refund", async () => {
    const p = new MockPaymentProvider();
    const a = p.authorize(10_000, { booking_id: "b1" });
    expect(await confirmAuthorization(p, a.id, { bookingId: "b1", amount: 10_000 })).toEqual({ ok: true });
    expect((await p.capture(a.id, 5_000)).capturedAmount).toBe(5_000);
    await expect(p.capture(a.id)).rejects.toThrow();
    expect((await p.refund(a.id)).status).toBe("refunded");
  });
  it("void releases the hold", async () => {
    const p = new MockPaymentProvider();
    const a = p.authorize(100);
    expect((await p.void(a.id)).status).toBe("voided");
  });
});

describe("otp", () => {
  it("accepts the right code once, locks after attempts, expires", async () => {
    let t = 0;
    const sms = new MockSmsProvider();
    const otp = new OtpService(sms, () => t);
    const code = await otp.request("+966512345678");
    expect(sms.outbox).toHaveLength(1);
    expect(otp.verify("+966512345678", "000000" === code ? "111111" : "000000")).toBe(false);
    expect(otp.verify("+966512345678", code)).toBe(true);
    expect(otp.verify("+966512345678", code)).toBe(false);
    const c2 = await otp.request("+966512345678");
    t += 6 * 60_000;
    expect(otp.verify("+966512345678", c2)).toBe(false);
    await expect(otp.request("0512345678")).rejects.toThrow("invalid_phone");
  });
});

describe("mock nafath", () => {
  it("waits then approves; ids ending 0 are rejected", async () => {
    let t = 0;
    const n = new MockNafathProvider(() => t);
    const ok = await n.start("1234567891");
    expect(await n.status(ok.requestId)).toBe("waiting");
    t += 5000;
    expect(await n.status(ok.requestId)).toBe("approved");
    const bad = await n.start("1234567890");
    t += 5000;
    expect(await n.status(bad.requestId)).toBe("rejected");
  });
});
