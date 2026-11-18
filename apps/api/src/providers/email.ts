import nodemailer from "nodemailer";

export interface EmailProvider {
  send(to: string, subject: string, text: string): Promise<void>;
}

/** Test mailer: nothing leaves the server. Messages are kept in memory for inspection. */
export class MockEmailProvider implements EmailProvider {
  readonly outbox: { to: string; subject: string; text: string; at: Date }[] = [];
  async send(to: string, subject: string, text: string) {
    this.outbox.push({ to, subject, text, at: new Date() });
    if (this.outbox.length > 200) this.outbox.shift();
  }
}

export interface SmtpSettings {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
}

/** Real email over SMTP (Oracle Email Delivery or any other relay). Port 587 upgrades with STARTTLS, 465 is TLS from the start. */
export class SmtpEmailProvider implements EmailProvider {
  private readonly transport;
  constructor(private readonly s: SmtpSettings) {
    this.transport = nodemailer.createTransport({
      host: s.host,
      port: s.port,
      secure: s.port === 465,
      requireTLS: s.port !== 465,
      auth: { user: s.user, pass: s.pass },
      connectionTimeout: 10_000,
      socketTimeout: 15_000,
    });
  }
  async send(to: string, subject: string, text: string) {
    await this.transport.sendMail({ from: this.s.from, to, subject, text });
  }
}
