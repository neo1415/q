import { renderPlainTextEmail } from "@capital-q/email";
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
  /**
   * A document's own HTML (The Q Daily's newspaper, DAILY spec §2), sent
   * instead of the branded frame. The plain text is always sent beside it.
   */
  readonly html?: string | undefined;
  /** Small text files sent with it (a calendar invite, AUTO 2026-10-02). */
  readonly attachments?:
    | readonly {
        readonly filename: string;
        readonly content: string;
        readonly contentType: string;
      }[]
    | undefined;
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

/** Who Capital Q's own emails come from, by name, when none is configured. */
export const APP_EMAIL_SENDER_NAME = "Capital Q";

/**
 * The HTML for a message that brought only text (DOCS email packet): the
 * shared Capital Q layout (packages/email), its paragraphs and https URLs
 * as links. Every Capital Q template brings its own HTML from the same
 * layout; this is the fallback so nothing leaves unbranded.
 */
export function brandedEmailHtml(message: {
  readonly subject: string;
  readonly text: string;
}): string {
  return renderPlainTextEmail({
    subject: message.subject,
    text: message.text,
    origin: null,
  }).html;
}

function namedSender(sender: string): {
  readonly email: string;
  readonly name: string;
} {
  const match = /^(?:(.*?)\s*<)?([^<>\s]+@[^<>\s]+)>?$/.exec(sender.trim());
  const email = match?.[2] ?? sender.trim();
  const name = match?.[1]?.trim();
  return {
    email,
    name:
      name === undefined || name.length === 0 ? APP_EMAIL_SENDER_NAME : name,
  };
}

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
      const from = namedSender(config.sender);
      await transport.sendMail({
        from: { name: from.name, address: from.email },
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html ?? brandedEmailHtml(message),
        ...(message.attachments === undefined
          ? {}
          : {
              attachments: message.attachments.map((file) => ({
                filename: file.filename,
                content: file.content,
                contentType: file.contentType,
              })),
            }),
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
  const sender = namedSender(config.sender);
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
          sender: { email: sender.email, name: sender.name },
          to: [{ email: message.to }],
          subject: message.subject,
          textContent: message.text,
          htmlContent: message.html ?? brandedEmailHtml(message),
          ...(message.attachments === undefined
            ? {}
            : {
                attachment: message.attachments.map((file) => ({
                  name: file.filename,
                  content: Buffer.from(file.content, "utf8").toString("base64"),
                })),
              }),
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
