import type { Halalas } from "../domain/money.js";

export type ProviderStatus =
  | "initiated"
  | "paid"
  | "authorized"
  | "captured"
  | "voided"
  | "refunded"
  | "failed"
  | "verified";

export interface ProviderPayment {
  id: string;
  status: ProviderStatus;
  amount: Halalas;
  currency: string;
  metadata: Record<string, string>;
  capturedAmount?: Halalas;
  refundedAmount?: Halalas;
}

/** Everything the platform needs from a payment provider. Swap providers by writing another adapter. */
export interface PaymentProvider {
  getPayment(id: string): Promise<ProviderPayment>;
  /** Charge an authorized payment. Omit amount to capture it all. */
  capture(id: string, amount?: Halalas): Promise<ProviderPayment>;
  /** Release an authorization without charging. */
  void(id: string): Promise<ProviderPayment>;
  refund(id: string, amount?: Halalas): Promise<ProviderPayment>;
}

export class ProviderError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export type AuthorizationCheck =
  | { ok: true }
  | { ok: false; reason: "not_authorized" | "amount_mismatch" | "currency_mismatch" | "booking_mismatch" };

/**
 * Never trust a webhook payload or a client claim. Fetch the payment from the provider and
 * confirm it is a real hold for exactly this booking and amount.
 */
export async function confirmAuthorization(
  provider: PaymentProvider,
  paymentId: string,
  expected: { bookingId: string; amount: Halalas },
): Promise<AuthorizationCheck> {
  const p = await provider.getPayment(paymentId);
  if (p.status !== "authorized") return { ok: false, reason: "not_authorized" };
  if (p.currency.toUpperCase() !== "SAR") return { ok: false, reason: "currency_mismatch" };
  if (p.amount !== expected.amount) return { ok: false, reason: "amount_mismatch" };
  if (p.metadata["booking_id"] !== expected.bookingId) return { ok: false, reason: "booking_mismatch" };
  return { ok: true };
}
