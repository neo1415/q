import { createTransport } from "nodemailer";

/**
 * App email (BIZ-008): Capital Q's own notices -- a due reminder, a
 * meeting's T-15 reminder -- to the person they belong to, over the SMTP
 * relay in the setup contract (Brevo). Not the person's Gmail: that is
 * `email.send`, approved per message. This sender only ever writes to the
 * owner of the notice, from Capital Q's own address.
 *
 * nodemailer stays behind this port; tests pass a fake and nothing in a
 * test run can reach a relay.
 */

export type AppEmail = {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
};

export type AppEmailSender = {
  readonly available: boolean;
  /** Throws on failure; the caller decides whether to retry. */
  readonly send: (message: AppEmail) => Promise<void>;
};

export const unavailableAppEmailSender: AppEmailSender = {
  available: false,
  send: () => Promise.reject(new Error("app email is not configured")),
};

const LINE_BREAK = /[\r\n]/;

export function createSmtpAppEmailSender(config: {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly pass: { readonly reveal: () => string };
  readonly sender: string;
}): AppEmailSender {
  const transport = createTransport({
    host: config.host,
    port: config.port,
    // 465 is implicit TLS; 587 upgrades with STARTTLS, which is required.
    secure: config.port === 465,
    requireTLS: config.port !== 465,
    auth: { user: config.user, pass: config.pass.reveal() },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });
  return {
    available: true,
    send: async (message) => {
      if (LINE_BREAK.test(message.subject) || LINE_BREAK.test(message.to)) {
        throw new Error("header injection refused");
      }
      await transport.sendMail({
        from: config.sender,
        to: message.to,
        subject: message.subject,
        text: message.text,
      });
    },
  };
}
