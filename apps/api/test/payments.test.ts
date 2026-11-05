import { describe, expect, it, vi } from "vitest";
import { MoyasarProvider } from "../src/payments/moyasar.js";
import { ProviderError, confirmAuthorization, type PaymentProvider, type ProviderPayment } from "../src/payments/provider.js";
import { WebhookRejected, parseWebhook } from "../src/payments/webhook.js";

const payment = (over: Partial<ProviderPayment> = {}): ProviderPayment => ({
  id: "pay_1",
  status: "authorized",
  amount: 15_000,
  currency: "SAR",
  metadata: { booking_id: "b1" },
  ...over,
});

const providerReturning = (p: ProviderPayment): PaymentProvider => ({
  getPayment: async () => p,
  capture: async () => p,
  void: async () => p,
  refund: async () => p,
});

describe("confirmAuthorization", () => {
  const expected = { bookingId: "b1", amount: 15_000 };

  it("accepts a real hold for this booking and amount", async () => {
    expect(await confirmAuthorization(providerReturning(payment()), "pay_1", expected)).toEqual({ ok: true });
  });

  it("rejects anything that is not a matching hold", async () => {
    const check = (p: ProviderPayment) => confirmAuthorization(providerReturning(p), "pay_1", expected);
    expect(await check(payment({ status: "failed" }))).toEqual({ ok: false, reason: "not_authorized" });
    expect(await check(payment({ status: "captured" }))).toEqual({ ok: false, reason: "not_authorized" });
    expect(await check(payment({ amount: 100 }))).toEqual({ ok: false, reason: "amount_mismatch" });
    expect(await check(payment({ currency: "USD" }))).toEqual({ ok: false, reason: "currency_mismatch" });
    expect(await check(payment({ metadata: { booking_id: "other" } }))).toEqual({ ok: false, reason: "booking_mismatch" });
    expect(await check(payment({ metadata: {} }))).toEqual({ ok: false, reason: "booking_mismatch" });
  });
});

describe("webhook parsing", () => {
  const body = { id: "evt_1", type: "payment_authorized", secret_token: "s3cret", live: true, data: { id: "pay_1" } };

  it("accepts a valid event", () => {
    expect(parseWebhook(body, "s3cret")).toEqual({ id: "evt_1", type: "payment_authorized", live: true, paymentId: "pay_1" });
  });

  it("rejects a wrong or missing secret, unknown types and malformed bodies", () => {
    expect(() => parseWebhook({ ...body, secret_token: "nope" }, "s3cret")).toThrow(WebhookRejected);
    expect(() => parseWebhook({ ...body, secret_token: undefined }, "s3cret")).toThrow(WebhookRejected);
    expect(() => parseWebhook({ ...body, type: "payment_something" }, "s3cret")).toThrow(WebhookRejected);
    expect(() => parseWebhook({ ...body, data: {} }, "s3cret")).toThrow(WebhookRejected);
    expect(() => parseWebhook(null, "s3cret")).toThrow(WebhookRejected);
    expect(() => parseWebhook(body, "")).toThrow(WebhookRejected);
  });
});

describe("MoyasarProvider", () => {
  const ok = (json: unknown) => new Response(JSON.stringify(json), { status: 200 });
  const raw = { id: "pay_1", status: "captured", amount: 15_000, currency: "SAR", captured: 15_000, metadata: { booking_id: "b1" } };

  it("authenticates with the secret key as the Basic username", async () => {
    const fetchFn = vi.fn(async () => ok(raw));
    await new MoyasarProvider("sk_test_abc", fetchFn).getPayment("pay_1");
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.moyasar.com/v1/payments/pay_1");
    expect((init.headers as Record<string, string>)["authorization"]).toBe(
      "Basic " + Buffer.from("sk_test_abc:").toString("base64"),
    );
  });

  it("captures fully with no body and partially with an amount", async () => {
    const fetchFn = vi.fn(async () => ok(raw));
    const p = new MoyasarProvider("sk", fetchFn);
    await p.capture("pay_1");
    await p.capture("pay_1", 7500);
    const calls = fetchFn.mock.calls as unknown as [string, RequestInit][];
    expect(calls[0]![1].body).toBeUndefined();
    expect(calls[1]![1].body).toBe(JSON.stringify({ amount: 7500 }));
    expect(calls[1]![0]).toBe("https://api.moyasar.com/v1/payments/pay_1/capture");
  });

  it("voids and refunds on the right endpoints", async () => {
    const fetchFn = vi.fn(async () => ok({ ...raw, status: "voided" }));
    const p = new MoyasarProvider("sk", fetchFn);
    expect((await p.void("pay_1")).status).toBe("voided");
    await p.refund("pay_1", 1000);
    const calls = fetchFn.mock.calls as unknown as [string, RequestInit][];
    expect(calls[0]![0]).toMatch(/\/payments\/pay_1\/void$/);
    expect(calls[1]![0]).toMatch(/\/payments\/pay_1\/refund$/);
  });

  it("maps payments and turns provider errors into ProviderError", async () => {
    const good = await new MoyasarProvider("sk", async () => ok(raw)).getPayment("pay_1");
    expect(good).toMatchObject({ id: "pay_1", status: "captured", amount: 15_000, capturedAmount: 15_000 });
    expect(good.metadata).toEqual({ booking_id: "b1" });

    const failing = new MoyasarProvider("sk", async () => new Response(JSON.stringify({ message: "Invalid key" }), { status: 401 }));
    await expect(failing.getPayment("pay_1")).rejects.toThrow(ProviderError);
    await expect(failing.getPayment("pay_1")).rejects.toThrow(/Invalid key/);

    const weird = new MoyasarProvider("sk", async () => ok({ id: "x", status: "mystery", amount: 1, currency: "SAR" }));
    await expect(weird.getPayment("x")).rejects.toThrow(/unexpected payment/);
  });

  it("refuses fractional amounts and a missing key", async () => {
    const p = new MoyasarProvider("sk", async () => ok(raw));
    expect(() => p.capture("pay_1", 10.5)).toThrow(RangeError);
    expect(() => new MoyasarProvider("")).toThrow();
  });
});
