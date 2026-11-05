import { assertHalalas, type Halalas } from "../domain/money.js";
import {
  ProviderError,
  type PaymentProvider,
  type ProviderPayment,
  type ProviderStatus,
} from "./provider.js";

const STATUSES: readonly ProviderStatus[] = [
  "initiated",
  "paid",
  "authorized",
  "captured",
  "voided",
  "refunded",
  "failed",
  "verified",
];

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/**
 * Moyasar REST adapter. Auth is HTTP Basic with the secret key as username and an empty password.
 * Amounts are in the smallest unit (halalas). Capture with no body captures everything; with an
 * amount it is a partial capture. Field names follow Moyasar's payment object: verify against the
 * sandbox before go-live.
 */
export class MoyasarProvider implements PaymentProvider {
  constructor(
    private readonly secretKey: string,
    private readonly fetchFn: FetchLike = fetch,
    private readonly baseUrl = "https://api.moyasar.com/v1",
  ) {
    if (!secretKey) throw new Error("Moyasar secret key is required");
  }

  getPayment(id: string) {
    return this.call("GET", `/payments/${encodeURIComponent(id)}`);
  }

  capture(id: string, amount?: Halalas) {
    if (amount !== undefined) assertHalalas(amount, "capture amount");
    return this.call("POST", `/payments/${encodeURIComponent(id)}/capture`, amount === undefined ? undefined : { amount });
  }

  void(id: string) {
    return this.call("POST", `/payments/${encodeURIComponent(id)}/void`);
  }

  refund(id: string, amount?: Halalas) {
    if (amount !== undefined) assertHalalas(amount, "refund amount");
    return this.call("POST", `/payments/${encodeURIComponent(id)}/refund`, amount === undefined ? undefined : { amount });
  }

  private async call(method: "GET" | "POST", path: string, body?: unknown): Promise<ProviderPayment> {
    const headers: Record<string, string> = {
      authorization: "Basic " + Buffer.from(`${this.secretKey}:`).toString("base64"),
    };
    if (body !== undefined) headers["content-type"] = "application/json";

    const res = await this.fetchFn(this.baseUrl + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const message =
        json && typeof json === "object" && "message" in json ? String((json as { message: unknown }).message) : res.statusText;
      throw new ProviderError(res.status, `Moyasar ${method} ${path} failed: ${message}`);
    }
    return toPayment(json);
  }
}

function toPayment(raw: unknown): ProviderPayment {
  if (!raw || typeof raw !== "object") throw new ProviderError(502, "Moyasar returned an unreadable payment");
  const r = raw as Record<string, unknown>;
  const status = r["status"];
  if (typeof r["id"] !== "string" || typeof status !== "string" || !STATUSES.includes(status as ProviderStatus)) {
    throw new ProviderError(502, `Moyasar returned an unexpected payment (status: ${String(status)})`);
  }
  if (typeof r["amount"] !== "number" || typeof r["currency"] !== "string") {
    throw new ProviderError(502, "Moyasar payment is missing amount or currency");
  }
  const metadata: Record<string, string> = {};
  if (r["metadata"] && typeof r["metadata"] === "object") {
    for (const [k, v] of Object.entries(r["metadata"] as Record<string, unknown>)) metadata[k] = String(v);
  }
  const payment: ProviderPayment = {
    id: r["id"],
    status: status as ProviderStatus,
    amount: r["amount"],
    currency: r["currency"],
    metadata,
  };
  if (typeof r["captured"] === "number") payment.capturedAmount = r["captured"];
  if (typeof r["refunded"] === "number") payment.refundedAmount = r["refunded"];
  return payment;
}
