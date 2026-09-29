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

/**
 * The same email over Brevo's transactional HTTPS API (founder live
 * 2026-09-29): the deployment's network blocks outbound SMTP, so a relay
 * reached over 587 or 2525 only ever timed out. Same contract as the SMTP
 * sender: plain text, one recipient, header injection refused, throws on
 * failure so the caller retries.
 */
export function createBrevoApiEmailSender(config: {
  readonly apiKey: { readonly reveal: () => string };
  readonly sender: string;
  readonly fetch?: typeof fetch | undefined;
}): AppEmailSender {
  const match = /^(?:(.*?)\s*<)?([^<>\s]+@[^<>\s]+)>?$/.exec(
    config.sender.trim(),
  );
  const senderEmail = match?.[2] ?? config.sender.trim();
  const senderName = match?.[1]?.trim();
  const doFetch = config.fetch ?? fetch;
  return {
    available: true,
    send: async (message) => {
      if (LINE_BREAK.test(message.subject) || LINE_BREAK.test(message.to)) {
        throw new Error("header injection refused");
      }
      const response = await doFetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: {
          "api-key": config.apiKey.reveal(),
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          sender:
            senderName === undefined || senderName.length === 0
              ? { email: senderEmail }
              : { email: senderEmail, name: senderName },
          to: [{ email: message.to }],
          subject: message.subject,
          textContent: message.text,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        const error = new Error("email API refused the message");
        Object.assign(error, {
          code: "EAPI",
          responseCode: response.status,
        });
        throw error;
      }
    },
  };
}
