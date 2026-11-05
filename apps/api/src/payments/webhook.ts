import { createHash, timingSafeEqual } from "node:crypto";

/** Event names as documented by Moyasar (note the provider's own spelling of "faild"). */
export const MOYASAR_EVENTS = [
  "payment_paid",
  "payment_faild",
  "payment_refunded",
  "payment_voided",
  "payment_authorized",
  "payment_captured",
  "payment_verified",
] as const;

export type MoyasarEventType = (typeof MOYASAR_EVENTS)[number];

export interface WebhookEvent {
  id: string;
  type: MoyasarEventType;
  live: boolean;
  paymentId: string;
}

export class WebhookRejected extends Error {}

/**
 * Moyasar documents a shared `secret_token` in the payload and no signature header, so the token
 * is only a first filter. Callers MUST re-fetch the payment from the provider before acting.
 * Unknown event types are rejected rather than silently ignored.
 */
export function parseWebhook(body: unknown, expectedSecret: string): WebhookEvent {
  if (!expectedSecret) throw new WebhookRejected("webhook secret is not configured");
  if (!body || typeof body !== "object") throw new WebhookRejected("malformed body");
  const b = body as Record<string, unknown>;

  if (typeof b["secret_token"] !== "string" || !safeEqual(b["secret_token"], expectedSecret)) {
    throw new WebhookRejected("bad secret token");
  }
  const type = b["type"];
  if (typeof b["id"] !== "string" || typeof type !== "string" || !MOYASAR_EVENTS.includes(type as MoyasarEventType)) {
    throw new WebhookRejected("unknown or malformed event");
  }
  const data = b["data"];
  const paymentId = data && typeof data === "object" ? (data as Record<string, unknown>)["id"] : undefined;
  if (typeof paymentId !== "string") throw new WebhookRejected("event has no payment id");

  return { id: b["id"], type: type as MoyasarEventType, live: b["live"] === true, paymentId };
}

function safeEqual(a: string, b: string): boolean {
  // Hash first so both buffers have equal length and comparison time does not leak length.
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}
