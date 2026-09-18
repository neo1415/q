import { z } from "zod";

import { UtcTimestampSchema } from "../common/time.js";
import { QConversationIdSchema } from "./ids.js";
import { QMessageSchema } from "./message.js";
import { QRunHandleSchema } from "./run.js";
import { QSubjectRefsSchema } from "./subject.js";

/**
 * A person's Q conversations at the HTTP boundary (ADR 0012; doc 17).
 *
 * A conversation is the thing a person comes back to: a title, when it
 * has one, its recent turns, and the run it is in. Everything here is the
 * owner's projection; a conversation that is not theirs is not found,
 * never forbidden, so nothing about anyone else's is learnable.
 *
 * What is deliberately absent: the summary. It is Q's working memory,
 * model-written and untrusted; it is rendered into prompts, not shown as
 * a record of what was said. The messages are that record.
 */

export const Q_CONVERSATIONS_PATH = "/v1/q/conversations" as const;
export const Q_CONVERSATION_ARCHIVE_SUFFIX = "/archive" as const;

/** How many turns reopening a conversation brings back. Older ones exist; the prompt sees a summary of them. */
export const Q_CONVERSATION_MESSAGES_MAX = 120;
export const Q_CONVERSATIONS_PAGE_MAX = 50;

export const QConversationTitleSchema = z.string().trim().min(1).max(120);

export const QConversationSummarySchema = z
  .object({
    conversationId: QConversationIdSchema,
    /** The extractor's title, else the first words of the opening turn. Always something to show. */
    title: QConversationTitleSchema,
    subjects: QSubjectRefsSchema,
    createdAt: UtcTimestampSchema,
    lastMessageAt: UtcTimestampSchema,
  })
  .strict();
export type QConversationSummary = z.infer<typeof QConversationSummarySchema>;

export const ListQConversationsResponseSchema = z
  .object({
    items: z.array(QConversationSummarySchema).max(Q_CONVERSATIONS_PAGE_MAX),
    /** The `before` cursor for the next page, absent on the last. */
    nextBefore: UtcTimestampSchema.optional(),
  })
  .strict();
export type ListQConversationsResponse = z.infer<
  typeof ListQConversationsResponseSchema
>;

export const QConversationDetailSchema = z
  .object({
    conversation: QConversationSummarySchema,
    /** The most recent turns, oldest first. */
    messages: z.array(QMessageSchema).max(Q_CONVERSATION_MESSAGES_MAX),
    /** The conversation's latest run, so a client can follow one still in flight. */
    latestRun: QRunHandleSchema.nullable(),
  })
  .strict();
export type QConversationDetail = z.infer<typeof QConversationDetailSchema>;

/** `GET /v1/q/conversations?limit=&before=` */
export const ListQConversationsQuerySchema = z
  .object({
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(Q_CONVERSATIONS_PAGE_MAX)
      .optional(),
    before: UtcTimestampSchema.optional(),
  })
  .strict();
export type ListQConversationsQuery = z.infer<
  typeof ListQConversationsQuerySchema
>;
