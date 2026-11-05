import { assertHalalas, type Halalas } from "../domain/money.js";
import { ProviderError, type PaymentProvider, type ProviderPayment } from "./provider.js";

/**
 * In-memory stand-in for Moyasar, used for test deployments. Follows the same
 * authorize -> capture / void -> refund life cycle as the real adapter so flows can be exercised
 * end to end without a merchant account. Never use with real money.
 */
export class MockPaymentProvider implements PaymentProvider {
  private readonly payments = new Map<string, ProviderPayment>();
  private seq = 0;

  /** Simulates the learner's card being authorized (what the hosted payment form would do). */
  authorize(amount: Halalas, metadata: Record<string, string> = {}): ProviderPayment {
    assertHalalas(amount, "authorize amount");
    const id = `mock_pay_${++this.seq}_${Math.random().toString(36).slice(2, 8)}`;
    const p: ProviderPayment = { id, status: "authorized", amount, currency: "SAR", metadata };
    this.payments.set(id, p);
    return { ...p };
  }

  async getPayment(id: string) {
    return { ...this.find(id) };
  }

  async capture(id: string, amount?: Halalas) {
    const p = this.find(id);
    if (p.status !== "authorized") throw new ProviderError(400, `cannot capture a ${p.status} payment`);
    if (amount !== undefined) {
      assertHalalas(amount, "capture amount");
      if (amount > p.amount) throw new ProviderError(400, "capture exceeds authorized amount");
    }
    p.status = "captured";
    p.capturedAmount = amount ?? p.amount;
    return { ...p };
  }

  async void(id: string) {
    const p = this.find(id);
    if (p.status !== "authorized") throw new ProviderError(400, `cannot void a ${p.status} payment`);
    p.status = "voided";
    return { ...p };
  }

  async refund(id: string, amount?: Halalas) {
    const p = this.find(id);
    if (p.status !== "captured") throw new ProviderError(400, `cannot refund a ${p.status} payment`);
    const max = p.capturedAmount ?? p.amount;
    if (amount !== undefined) {
      assertHalalas(amount, "refund amount");
      if (amount > max) throw new ProviderError(400, "refund exceeds captured amount");
    }
    p.status = "refunded";
    p.refundedAmount = amount ?? max;
    return { ...p };
  }

  private find(id: string): ProviderPayment {
    const p = this.payments.get(id);
    if (!p) throw new ProviderError(404, "payment not found");
    return p;
  }
}
