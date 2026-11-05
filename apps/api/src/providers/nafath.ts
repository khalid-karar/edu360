import { randomInt, randomUUID } from "node:crypto";

export type NafathStatus = "waiting" | "approved" | "rejected" | "expired";

export interface NafathProvider {
  /** Starts an identity request; the user then picks the shown number inside the Nafath app. */
  start(nationalId: string): Promise<{ requestId: string; number: string }>;
  status(requestId: string): Promise<NafathStatus>;
}

/**
 * Test double for Nafath. Approves 4 seconds after start. An ID ending in 0 is rejected so the
 * failure path can be exercised. The national ID is never stored, only whether it ends in 0.
 */
export class MockNafathProvider implements NafathProvider {
  private readonly reqs = new Map<string, { at: number; reject: boolean }>();
  constructor(private readonly now: () => number = Date.now, private readonly approveAfterMs = 4000) {}

  async start(nationalId: string) {
    if (!/^[12]\d{9}$/.test(nationalId)) throw new Error("invalid_national_id");
    const requestId = randomUUID();
    this.reqs.set(requestId, { at: this.now(), reject: nationalId.endsWith("0") });
    return { requestId, number: String(randomInt(10, 100)) };
  }

  async status(requestId: string): Promise<NafathStatus> {
    const r = this.reqs.get(requestId);
    if (!r) return "expired";
    const age = this.now() - r.at;
    if (age > 5 * 60_000) return "expired";
    if (age < this.approveAfterMs) return "waiting";
    return r.reject ? "rejected" : "approved";
  }
}
