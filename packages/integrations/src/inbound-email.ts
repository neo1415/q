import { randomBytes } from "node:crypto";

import { z } from "zod";

import type { CapitalQEvent, CorrelationId } from "@capital-q/contracts";
import type {
  DatabaseExecutor,
  TransactionContext,
  TransactionManager,
} from "@capital-q/database";

import { inboundEmailReceivedEvent } from "./events.js";

/**
 * Inbound email (Postmark Inbound): Q receives email on a person's behalf.
 *
 * A person's Q address is the deployment's Postmark inbound address with
 * their own opaque token as its plus part; Postmark hands the token back
 * as MailboxHash. The token is random, one ACTIVE per person, and revoked
 * when they ask for a new address.
 *
 * Everything in a delivery is untrusted data written by a stranger:
 *
 *   - it is stored append-only and never interpreted here;
 *   - attachments are kept as metadata only (name, type, size) -- no bytes,
 *     since nothing scans them;
 *   - nothing in it is ever logged;
 *   - Q reads it only through the quarantined reader (q-api), and nothing
 *     in it can grant authority or start an action without a card.
 *
 * PostgreSQL over the privileged server connection: business authorization
 * is this service's (every read and write is bound to the actor's own
 * user and tenant), RLS is the second layer for any client read.
 */

/** Characters of text body kept; the rest is cut and marked truncated. */
export const INBOUND_TEXT_MAX_CHARS = 20_000;
const MAX_ATTACHMENTS = 50;
const TOKEN_PATTERN = /^[a-z2-7]{26}$/;
const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";

// --- Postmark's inbound JSON ---------------------------------------------

const Text = (max: number) =>
  z
    .string()
    .max(max * 4)
    .optional()
    .transform((value) => value ?? "");

const Recipient = z.looseObject({
  Email: z.string().max(400).optional(),
  Name: z.string().max(400).optional(),
  MailboxHash: z.string().max(200).optional(),
});

/**
 * The fields Capital Q keeps from Postmark's inbound webhook body. Unknown
 * fields are ignored; attachment Content (base64 bytes) is never read.
 */
export const PostmarkInboundSchema = z.looseObject({
  MessageID: z.string().regex(/^[A-Za-z0-9-]{1,100}$/),
  From: z.string().max(1000).optional(),
  FromName: z.string().max(1000).optional(),
  FromFull: Recipient.optional(),
  ToFull: z.array(Recipient).max(200).optional(),
  CcFull: z.array(Recipient).max(200).optional(),
  BccFull: z.array(Recipient).max(200).optional(),
  OriginalRecipient: z.string().max(1000).optional(),
  MailboxHash: z.string().max(200).optional(),
  Subject: Text(998),
  TextBody: z.string().optional(),
  HtmlBody: z.string().optional(),
  Attachments: z
    .array(
      z.looseObject({
        Name: z.string().max(1000).optional(),
        ContentType: z.string().max(1000).optional(),
        ContentLength: z.number().int().min(0).optional(),
      }),
    )
    .max(1000)
    .optional(),
});
export type PostmarkInbound = z.infer<typeof PostmarkInboundSchema>;

export type InboundAttachment = {
  readonly name: string;
  readonly contentType: string;
  readonly size: number;
};

/** A delivery reduced to what is stored: bounded, single-line headers. */
export type NormalisedInboundEmail = {
  readonly providerMessageId: string;
  readonly mailboxHash: string | null;
  readonly fromAddress: string;
  readonly fromName: string | null;
  readonly toAddresses: string;
  readonly ccAddresses: string;
  readonly subject: string;
  readonly textBody: string;
  readonly textTruncated: boolean;
  readonly attachments: readonly InboundAttachment[];
};

// Control characters (C0, DEL, C1) out of every single-line field.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;
// eslint-disable-next-line no-control-regex
const NUL = /\u0000/g;

function oneLine(value: string | undefined, max: number): string {
  return (value ?? "")
    .replace(CONTROL, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function addressOnly(value: string | undefined): string | null {
  const line = oneLine(value, 400);
  const match =
    /<([^<>\s]+@[^<>\s]+)>/.exec(line) ?? /([^<>\s]+@[^<>\s]+)/.exec(line);
  const address = match?.[1]?.toLowerCase();
  return address !== undefined && address.length >= 3 && address.length <= 320
    ? address
    : null;
}

function plainFromHtml(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/p>|<\/div>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+/g, " ");
}

/**
 * The token Postmark parsed from the plus part: the top-level MailboxHash,
 * or the first recipient's. Anything that is not a well-formed token is no
 * token at all.
 */
function mailboxHashOf(payload: PostmarkInbound): string | null {
  const candidates = [
    payload.MailboxHash,
    ...[
      ...(payload.ToFull ?? []),
      ...(payload.CcFull ?? []),
      ...(payload.BccFull ?? []),
    ].map((recipient) => recipient.MailboxHash),
  ];
  for (const candidate of candidates) {
    const token = candidate?.trim().toLowerCase();
    if (token !== undefined && TOKEN_PATTERN.test(token)) return token;
  }
  return null;
}

/** Null when the body is not a Postmark inbound message at all. */
export function readPostmarkInbound(
  body: unknown,
): NormalisedInboundEmail | null {
  const parsed = PostmarkInboundSchema.safeParse(body);
  if (!parsed.success) return null;
  const payload = parsed.data;
  const fromAddress =
    addressOnly(payload.FromFull?.Email) ?? addressOnly(payload.From);
  if (fromAddress === null) return null;
  const fromName = oneLine(payload.FromFull?.Name ?? payload.FromName, 200);
  const list = (recipients: PostmarkInbound["ToFull"]) =>
    (recipients ?? [])
      .map((recipient) => addressOnly(recipient.Email))
      .filter((address): address is string => address !== null)
      .join(", ")
      .slice(0, 2000);
  const rawText =
    (payload.TextBody ?? "").trim().length > 0
      ? (payload.TextBody ?? "")
      : plainFromHtml(payload.HtmlBody ?? "");
  const text = rawText.replace(NUL, "").replace(/\r\n?/g, "\n").trim();
  return {
    providerMessageId: payload.MessageID,
    mailboxHash: mailboxHashOf(payload),
    fromAddress,
    fromName: fromName.length === 0 ? null : fromName,
    toAddresses: list(payload.ToFull),
    ccAddresses: list(payload.CcFull),
    subject: oneLine(payload.Subject, 998),
    textBody: text.slice(0, INBOUND_TEXT_MAX_CHARS),
    textTruncated: text.length > INBOUND_TEXT_MAX_CHARS,
    attachments: (payload.Attachments ?? [])
      .slice(0, MAX_ATTACHMENTS)
      .map((attachment) => ({
        name: oneLine(attachment.Name, 200) || "attachment",
        contentType:
          oneLine(attachment.ContentType, 200) || "application/octet-stream",
        size: attachment.ContentLength ?? 0,
      })),
  };
}

// --- the service -----------------------------------------------------------

export type InboundEmailActor = {
  readonly tenantId: string;
  readonly userId: string;
};

export type InboundEmailItem = {
  readonly id: string;
  readonly fromAddress: string;
  readonly fromName: string | null;
  readonly toAddresses: string;
  readonly subject: string;
  readonly receivedAt: Date;
  readonly attachments: readonly InboundAttachment[];
};

export type InboundEmailMessage = InboundEmailItem & {
  readonly ccAddresses: string;
  /** Untrusted. Only the quarantined reader hands it to a model. */
  readonly textBody: string;
  readonly textTruncated: boolean;
};

export type ReceiveInboundOutcome =
  | { readonly outcome: "STORED"; readonly inboundEmailId: string }
  | { readonly outcome: "DUPLICATE" }
  /** No token, or a token that is unknown or revoked: dropped. */
  | { readonly outcome: "UNKNOWN_RECIPIENT" };

/** The transactional outbox, structurally: the API's OutboxWriter. */
export type InboundEmailOutbox = {
  readonly enqueue: (
    tx: TransactionContext,
    event: CapitalQEvent<unknown>,
  ) => Promise<unknown>;
};

export type InboundEmailService = {
  /** False when the deployment has no inbound address configured. */
  readonly available: boolean;
  /** Their ACTIVE address, issued on first ask; null when unavailable. */
  readonly addressOf: (actor: InboundEmailActor) => Promise<string | null>;
  /** Their ACTIVE address without issuing one. */
  readonly currentAddress: (actor: InboundEmailActor) => Promise<string | null>;
  /**
   * Replaces `currentAddress` with a new one; the old token stops at once.
   * A retry naming an address already replaced changes nothing and answers
   * with the current one.
   */
  readonly rotate: (
    actor: InboundEmailActor,
    currentAddress: string,
  ) => Promise<string | null>;
  readonly receive: (
    email: NormalisedInboundEmail,
    correlationId: CorrelationId,
  ) => Promise<ReceiveInboundOutcome>;
  /** Their own email, newest first. */
  readonly list: (
    actor: InboundEmailActor,
    limit: number,
  ) => Promise<readonly InboundEmailItem[]>;
  /** One of their own emails, or null when not theirs or not there. */
  readonly read: (
    actor: InboundEmailActor,
    inboundEmailId: string,
  ) => Promise<InboundEmailMessage | null>;
};

export function newInboundToken(): string {
  const bytes = randomBytes(17);
  let bits = 0;
  let value = 0;
  let token = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5 && token.length < 26) {
      token += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return token;
}

type ItemRow = {
  id: string;
  from_address: string;
  from_name: string | null;
  to_addresses: string;
  subject: string;
  received_at: Date;
  attachments: unknown;
};

const AttachmentsSchema = z
  .array(
    z.object({
      name: z.string(),
      contentType: z.string(),
      size: z.number().int().min(0),
    }),
  )
  .catch([]);

function toItem(row: ItemRow): InboundEmailItem {
  return {
    id: row.id,
    fromAddress: row.from_address,
    fromName: row.from_name,
    toAddresses: row.to_addresses,
    subject: row.subject,
    receivedAt: row.received_at,
    attachments: AttachmentsSchema.parse(row.attachments),
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createInboundEmailService(dependencies: {
  readonly sql: DatabaseExecutor;
  readonly transactions: TransactionManager;
  /** The deployment's inbound address; absent: the feature is off. */
  readonly baseAddress:
    { readonly local: string; readonly domain: string } | undefined;
  /** Required to receive; reads and addresses work without it. */
  readonly outbox?: InboundEmailOutbox | undefined;
  readonly newToken?: (() => string) | undefined;
}): InboundEmailService {
  const { sql, transactions, baseAddress } = dependencies;
  const newToken = dependencies.newToken ?? newInboundToken;
  const format = (token: string): string | null =>
    baseAddress === undefined
      ? null
      : `${baseAddress.local}+${token}@${baseAddress.domain}`;

  const active = async (
    executor: DatabaseExecutor | TransactionContext["sql"],
    actor: InboundEmailActor,
  ): Promise<{ id: string; token: string; tenant_id: string } | null> => {
    const rows = await executor<
      { id: string; token: string; tenant_id: string }[]
    >`
      select id, token, tenant_id from integrations.inbound_addresses
       where user_id = ${actor.userId} and status = 'ACTIVE'`;
    return rows[0] ?? null;
  };

  const issue = async (
    executor: DatabaseExecutor | TransactionContext["sql"],
    actor: InboundEmailActor,
  ): Promise<string> => {
    const inserted = await executor<{ token: string }[]>`
      insert into integrations.inbound_addresses (tenant_id, user_id, token)
      values (${actor.tenantId}, ${actor.userId}, ${newToken()})
      on conflict (user_id) where status = 'ACTIVE' do nothing
      returning token`;
    const token = inserted[0]?.token ?? (await active(executor, actor))?.token;
    if (token === undefined) throw new Error("inbound address not issued");
    return token;
  };

  return {
    available: baseAddress !== undefined,

    addressOf: async (actor) => {
      if (baseAddress === undefined) return null;
      const existing = await active(sql, actor);
      return format(existing?.token ?? (await issue(sql, actor)));
    },

    currentAddress: async (actor) => {
      if (baseAddress === undefined) return null;
      const existing = await active(sql, actor);
      return existing === null ? null : format(existing.token);
    },

    rotate: async (actor, currentAddress) => {
      if (baseAddress === undefined) return null;
      const token = await transactions.run(async (tx) => {
        const rows = await tx.sql<{ id: string; token: string }[]>`
          select id, token from integrations.inbound_addresses
           where user_id = ${actor.userId} and status = 'ACTIVE'
           for update`;
        const existing = rows[0];
        if (
          existing !== undefined &&
          format(existing.token) !== currentAddress.trim().toLowerCase()
        ) {
          // Already replaced (a retry), or not the address they see.
          return existing.token;
        }
        if (existing !== undefined) {
          await tx.sql`
            update integrations.inbound_addresses
               set status = 'REVOKED', revoked_at = clock_timestamp()
             where id = ${existing.id}`;
        }
        return issue(tx.sql, actor);
      });
      return format(token);
    },

    receive: async (email, correlationId) => {
      const outbox = dependencies.outbox;
      if (outbox === undefined) throw new Error("inbound email outbox missing");
      if (email.mailboxHash === null) return { outcome: "UNKNOWN_RECIPIENT" };
      const token = email.mailboxHash;
      return transactions.run(async (tx): Promise<ReceiveInboundOutcome> => {
        const owners = await tx.sql<
          { id: string; tenant_id: string; user_id: string }[]
        >`
          select id, tenant_id, user_id from integrations.inbound_addresses
           where token = ${token} and status = 'ACTIVE'`;
        const owner = owners[0];
        if (owner === undefined) return { outcome: "UNKNOWN_RECIPIENT" };
        const inserted = await tx.sql<{ id: string }[]>`
          insert into integrations.inbound_emails
            (tenant_id, user_id, inbound_address_id, provider, provider_message_id,
             from_address, from_name, to_addresses, cc_addresses, subject,
             text_body, text_truncated, attachments)
          values (${owner.tenant_id}, ${owner.user_id}, ${owner.id}, 'POSTMARK',
                  ${email.providerMessageId}, ${email.fromAddress}, ${email.fromName},
                  ${email.toAddresses}, ${email.ccAddresses}, ${email.subject},
                  ${email.textBody}, ${email.textTruncated},
                  ${JSON.stringify(email.attachments)}::text::jsonb)
          on conflict (provider, provider_message_id) do nothing
          returning id`;
        const stored = inserted[0];
        if (stored === undefined) return { outcome: "DUPLICATE" };
        const who = email.fromName ?? email.fromAddress;
        const subject =
          email.subject.length === 0 ? "(no subject)" : email.subject;
        // The person's own notice: who and what, never a link out. The
        // body is a short excerpt for them; no model reads notice bodies of
        // this kind.
        await tx.sql`
          insert into communication.notifications
            (tenant_id, user_id, kind, title, body, link_path, dedupe_key, priority)
          values (${owner.tenant_id}, ${owner.user_id}, 'EMAIL_RECEIVED',
                  ${`New email from ${who}: ${subject}`.slice(0, 200)},
                  ${email.textBody.length === 0 ? null : email.textBody.slice(0, 600)},
                  '/', ${`email_received:${stored.id}`}, 'UPDATE')
          on conflict (user_id, dedupe_key) do nothing`;
        await outbox.enqueue(
          tx,
          inboundEmailReceivedEvent({
            tenantId: owner.tenant_id,
            correlationId,
            inboundEmailId: stored.id,
            recipientUserId: owner.user_id,
            attachmentCount: email.attachments.length,
          }),
        );
        return { outcome: "STORED", inboundEmailId: stored.id };
      });
    },

    list: async (actor, limit) => {
      const rows = await sql<ItemRow[]>`
        select id, from_address, from_name, to_addresses, subject, received_at, attachments
          from integrations.inbound_emails
         where user_id = ${actor.userId} and tenant_id = ${actor.tenantId}
         order by received_at desc
         limit ${Math.max(1, Math.min(limit, 50))}`;
      return rows.map(toItem);
    },

    read: async (actor, inboundEmailId) => {
      if (!UUID.test(inboundEmailId)) return null;
      const rows = await sql<
        (ItemRow & {
          cc_addresses: string;
          text_body: string;
          text_truncated: boolean;
        })[]
      >`
        select id, from_address, from_name, to_addresses, cc_addresses, subject,
               received_at, attachments, text_body, text_truncated
          from integrations.inbound_emails
         where id = ${inboundEmailId}
           and user_id = ${actor.userId} and tenant_id = ${actor.tenantId}`;
      const row = rows[0];
      return row === undefined
        ? null
        : {
            ...toItem(row),
            ccAddresses: row.cc_addresses,
            textBody: row.text_body,
            textTruncated: row.text_truncated,
          };
    },
  };
}
