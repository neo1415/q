import { z } from "zod";

import { UuidSchema } from "../common/ids.js";
import { UtcTimestampSchema } from "../common/time.js";

/**
 * Relationship chat HTTP contracts (R34, CQ-COMM-001; ADR 0019).
 *
 * One 1:1 thread per canonical relationship, open once the relationship is
 * CONNECTED. Nothing here names a tenant, an organisation or a storage
 * location: the relationship id is input, and the server decides whether
 * the caller is a party. Attachments are documents the sender's own
 * organisation uploaded through the document pipeline; the wire carries a
 * snapshot of their title, type and size, never a key or a URL.
 */

/** `GET` the thread (cursor), `POST` a message (Idempotency-Key). */
export const RELATIONSHIP_MESSAGES_PATH =
  "/v1/relationships/:relationshipId/messages" as const;
/** `POST` the read cursor. */
export const RELATIONSHIP_MESSAGES_READ_PATH =
  "/v1/relationships/:relationshipId/messages/read" as const;
/** `POST` unsend one of the caller's own messages (a tombstone). */
export const RELATIONSHIP_MESSAGE_UNSEND_PATH =
  "/v1/relationships/:relationshipId/messages/:messageId/unsend" as const;
/** `GET` a short-lived read of one shared file or voice note. */
export const RELATIONSHIP_MESSAGE_ATTACHMENT_PATH =
  "/v1/relationships/:relationshipId/messages/:messageId/attachment" as const;
/** `GET` unread counts across the caller's threads. */
export const CHAT_UNREAD_PATH = "/v1/chat/unread" as const;

export const CHAT_MESSAGE_BODY_MAX_LENGTH = 4000;
export const CHAT_PAGE_MAX = 100;

export const ChatMessageBodySchema = z
  .string()
  .trim()
  .min(1)
  .max(CHAT_MESSAGE_BODY_MAX_LENGTH);

export const SendChatMessageRequestSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("TEXT"), body: ChatMessageBodySchema }).strict(),
  z
    .object({
      kind: z.literal("ATTACHMENT"),
      documentId: UuidSchema,
      body: ChatMessageBodySchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("VOICE_NOTE"),
      documentId: UuidSchema,
      durationMs: z.number().int().min(1).max(600_000),
    })
    .strict(),
]);
export type SendChatMessageRequest = z.infer<
  typeof SendChatMessageRequestSchema
>;

export const MarkChatReadRequestSchema = z
  .object({ lastReadMessageId: UuidSchema })
  .strict();
export type MarkChatReadRequest = z.infer<typeof MarkChatReadRequestSchema>;

export const ChatListQuerySchema = z
  .object({
    /** Changes after this message (polling). */
    after: UuidSchema.optional(),
    limit: z.coerce.number().int().min(1).max(CHAT_PAGE_MAX).optional(),
  })
  .strict();
export type ChatListQuery = z.infer<typeof ChatListQuerySchema>;

export const ChatSideSchema = z.enum(["COMPANY", "INVESTOR"]);
export type ChatSide = z.infer<typeof ChatSideSchema>;

export const ChatAttachmentDtoSchema = z
  .object({
    documentId: UuidSchema,
    title: z.string().min(1).max(300),
    mimeType: z.string().min(3).max(129),
    sizeBytes: z.number().int().min(0).nullable(),
  })
  .strict();
export type ChatAttachmentDto = z.infer<typeof ChatAttachmentDtoSchema>;

/** One message as it stands now: edits folded in, an unsend is a tombstone. */
export const ChatMessageDtoSchema = z
  .object({
    messageId: UuidSchema,
    side: ChatSideSchema,
    /** The caller wrote it. */
    mine: z.boolean(),
    senderName: z.string().min(1).max(200),
    kind: z.enum(["TEXT", "ATTACHMENT", "VOICE_NOTE"]),
    /** Null once unsent, and for a voice note. */
    body: z.string().max(CHAT_MESSAGE_BODY_MAX_LENGTH).nullable(),
    /** Null once unsent. */
    attachment: ChatAttachmentDtoSchema.nullable(),
    voiceDurationMs: z.number().int().min(1).nullable(),
    edited: z.boolean(),
    unsent: z.boolean(),
    /** Sent as a message the person approved from Q. */
    viaQ: z.boolean(),
    sentAt: UtcTimestampSchema,
  })
  .strict();
export type ChatMessageDto = z.infer<typeof ChatMessageDtoSchema>;

export const ChatThreadStatusSchema = z.enum([
  /** CONNECTED: both sides can write. */
  "OPEN",
  /** A party, but the relationship has not been mutually connected yet. */
  "NOT_CONNECTED",
]);
export type ChatThreadStatus = z.infer<typeof ChatThreadStatusSchema>;

export const ChatThreadDtoSchema = z
  .object({
    relationshipId: UuidSchema,
    status: ChatThreadStatusSchema,
    /** Oldest first; with `after`, only messages new or changed since. */
    messages: z.array(ChatMessageDtoSchema).max(CHAT_PAGE_MAX * 2),
    /** Pass as `after` to poll for what changed next; null when empty. */
    cursor: UuidSchema.nullable(),
    /** How far the other side has read (for "Seen"). */
    counterpartLastReadMessageId: UuidSchema.nullable(),
    unread: z.number().int().min(0),
  })
  .strict();
export type ChatThreadDto = z.infer<typeof ChatThreadDtoSchema>;

export const SendChatMessageResultDtoSchema = z
  .object({
    message: ChatMessageDtoSchema,
    deduplicated: z.boolean(),
  })
  .strict();
export type SendChatMessageResultDto = z.infer<
  typeof SendChatMessageResultDtoSchema
>;

export const ChatUnreadDtoSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            relationshipId: UuidSchema,
            unread: z.number().int().min(1),
          })
          .strict(),
      )
      .max(500),
  })
  .strict();
export type ChatUnreadDto = z.infer<typeof ChatUnreadDtoSchema>;

/**
 * A signed, single-object read that expires in about a minute. The browser
 * fetches the bytes straight from private storage; nothing is proxied and
 * the URL is never stored.
 */
export const ChatAttachmentAccessDtoSchema = z
  .object({
    url: z.url(),
    expiresAt: UtcTimestampSchema,
    mimeType: z.string().min(3).max(129),
  })
  .strict();
export type ChatAttachmentAccessDto = z.infer<
  typeof ChatAttachmentAccessDtoSchema
>;
