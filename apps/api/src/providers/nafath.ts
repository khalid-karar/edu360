import { randomInt, randomUUID } from "node:crypto";

export interface NafathIdentity {
  nationalId: string;
  fullName: string;
  gender: "female" | "male";
  /** YYYY-MM-DD */
  dateOfBirth: string;
}

export type NafathResult =
  | { status: "waiting" | "rejected" | "expired" }
  | { status: "approved"; identity: NafathIdentity };

export interface NafathProvider {
  /** Starts an identity request; the user then picks the shown number inside the Nafath app. */
  start(nationalId: string): Promise<{ requestId: string; number: string }>;
  /** On approval the identity comes from the government record, never from what the user typed. */
  status(requestId: string): Promise<NafathResult>;
}

/**
 * Test double for Nafath. Approves 4 seconds after start.
 * ID ending in 0: rejected. Ending in 9: approved but the person is a minor. Otherwise an adult.
 * Gender follows the parity of the second digit. Real Nafath needs an integrator contract.
 */
export class MockNafathProvider implements NafathProvider {
  private readonly reqs = new Map<string, { at: number; nationalId: string }>();
  constructor(private readonly now: () => number = Date.now, private readonly approveAfterMs = 4000) {}

  async start(nationalId: string) {
    if (!/^[12]\d{9}$/.test(nationalId)) throw new Error("invalid_national_id");
    const requestId = randomUUID();
    this.reqs.set(requestId, { at: this.now(), nationalId });
    return { requestId, number: String(randomInt(10, 100)) };
  }

  async status(requestId: string): Promise<NafathResult> {
    const r = this.reqs.get(requestId);
    if (!r) return { status: "expired" };
    const age = this.now() - r.at;
    if (age > 5 * 60_000) return { status: "expired" };
    if (age < this.approveAfterMs) return { status: "waiting" };
    if (r.nationalId.endsWith("0")) return { status: "rejected" };
    return {
      status: "approved",
      identity: {
        nationalId: r.nationalId,
        fullName: "محمد عبدالله سعد القحطاني",
        gender: Number(r.nationalId[1]) % 2 === 0 ? "female" : "male",
        dateOfBirth: r.nationalId.endsWith("9") ? "2014-03-02" : "1990-05-17",
      },
    };
  }
}
