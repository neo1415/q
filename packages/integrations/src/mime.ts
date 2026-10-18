import { randomUUID } from "node:crypto";

/**
 * An RFC 5322 text/plain message for Gmail `messages.send` (raw, base64url).
 *
 * We set our own Message-ID so a reply can be matched by In-Reply-To /
 * References as well as by Gmail's thread. Every header value is refused
 * if it carries CR or LF (header injection), and non-ASCII words are RFC
 * 2047 encoded. The body is UTF-8, base64, wrapped at 76.
 */

export class MimeHeaderError extends Error {
  constructor() {
    super("a header value contains a line break");
    this.name = "MimeHeaderError";
  }
}

export type OutboundMime = {
  readonly from: string;
  readonly to: string;
  readonly toName?: string | undefined;
  readonly subject: string;
  readonly body: string;
  readonly messageId: string;
  readonly date: Date;
};

const MESSAGE_ID_DOMAIN = "mail.capitalq.app";

export function newMessageId(): string {
  return `<cq-${randomUUID()}@${MESSAGE_ID_DOMAIN}>`;
}

function headerValue(value: string): string {
  if (/[\r\n]/.test(value)) {
    throw new MimeHeaderError();
  }
  return value;
}

function encodeWord(value: string): string {
  // Printable ASCII travels as is; anything else is one encoded word.
  return /^[\x20-\x7e]*$/.test(value)
    ? value
    : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function mailbox(address: string, name: string | undefined): string {
  const addr = headerValue(address);
  if (!/^[^\s<>@",;]+@[^\s<>@",;]+$/.test(addr)) {
    throw new MimeHeaderError();
  }
  if (name === undefined || name.trim() === "") return `<${addr}>`;
  const display = headerValue(name.trim());
  const quoted = /^[\x20-\x7e]*$/.test(display)
    ? `"${display.replace(/["\\]/g, "")}"`
    : encodeWord(display);
  return `${quoted} <${addr}>`;
}

export function buildRfc822(message: OutboundMime): string {
  const body = Buffer.from(message.body.replace(/\r?\n/g, "\r\n"), "utf8")
    .toString("base64")
    .replace(/.{76}/g, "$&\r\n");
  const lines = [
    `From: ${mailbox(message.from, undefined)}`,
    `To: ${mailbox(message.to, message.toName)}`,
    `Subject: ${encodeWord(headerValue(message.subject))}`,
    `Message-ID: ${headerValue(message.messageId)}`,
    `Date: ${message.date.toUTCString()}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    body,
  ];
  return lines.join("\r\n");
}

export function toBase64Url(raw: string): string {
  return Buffer.from(raw, "utf8").toString("base64url");
}

/** Message-IDs named in In-Reply-To / References, normalised with brackets. */
export function referencedMessageIds(
  inReplyTo: string | undefined,
  references: string | undefined,
): readonly string[] {
  const text = `${inReplyTo ?? ""} ${references ?? ""}`;
  return [...new Set(text.match(/<[^<>\s]{1,900}>/g) ?? [])];
}

/** The address inside `Name <addr>` or a bare address, lowercased. */
export function addressOf(header: string | undefined): string | undefined {
  if (header === undefined) return undefined;
  const bracketed = /<([^<>\s]+@[^<>\s]+)>/.exec(header);
  const bare = /([^\s<>",;]+@[^\s<>",;]+)/.exec(header);
  return (bracketed?.[1] ?? bare?.[1])?.toLowerCase();
}
