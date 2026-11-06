export interface SmsProvider {
  send(toE164: string, text: string): Promise<void>;
}

/** Test SMS gateway: nothing leaves the server. Messages are kept in memory for inspection. */
export class MockSmsProvider implements SmsProvider {
  readonly outbox: { to: string; text: string; at: Date }[] = [];
  async send(to: string, text: string) {
    this.outbox.push({ to, text, at: new Date() });
    if (this.outbox.length > 200) this.outbox.shift();
  }
}
