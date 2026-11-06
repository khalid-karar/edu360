import { describe, expect, it } from "vitest";
import { MockNafathProvider, MockPaymentProvider, confirmAuthorization } from "../src/index.js";

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

describe("mock nafath", () => {
  it("waits then approves; ids ending 0 are rejected", async () => {
    let t = 0;
    const n = new MockNafathProvider(() => t);
    const ok = await n.start("1234567891");
    expect(await n.status(ok.requestId)).toEqual({ status: "waiting" });
    t += 5000;
    const done = await n.status(ok.requestId);
    expect(done.status).toBe("approved");
    if (done.status === "approved") expect(done.identity.nationalId).toBe("1234567891");
    const bad = await n.start("1234567890");
    t += 5000;
    expect(await n.status(bad.requestId)).toEqual({ status: "rejected" });
  });
});
