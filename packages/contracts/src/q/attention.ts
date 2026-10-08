import { z } from "zod";

import { UuidSchema } from "../common/ids.js";

/**
 * RECOVERY-2026-10 (lead contract): one model of "what needs you" and
 * "what Q did", shared by the arrival briefing, the voice opener, Q's
 * answers ("find anything that needs my attention") and the Work page.
 * Live 2026-10-08: Q said "nothing is waiting" while an investor's
 * message had waited 21 hours, because each surface read a different
 * subset. A source that could not be read is reported as UNREAD, never
 * as empty.
 */
/**
 * `GET`: the person's own report (workstream B's reader, the same one Q's
 * `what_needs_me` uses). Query `since` (ISO time, within a month) dates
 * NEW_MATCHES and the activity summary; omitted, the last day.
 */
export const Q_ATTENTION_PATH = "/v1/q/attention" as const;

export const Q_ATTENTION_SOURCES = [
  /** A counterpart wrote last and is waiting for a reply. */
  "UNANSWERED_MESSAGE",
  /** A change waiting for the person's approval (incl. agent drafts). */
  "APPROVAL",
  /** A draft Q held back (below the bar, thread mismatch). */
  "HELD_DRAFT",
  /** An agent that stopped and needs a decision or a capability. */
  "AGENT_BLOCKED",
  /** A data-room / diligence / document request addressed to them. */
  "DOCUMENT_REQUEST",
  /** Interest or a connection request waiting for an answer. */
  "INTEREST_REQUEST",
  /** A meeting to confirm, times to pick, or a call soon. */
  "MEETING",
  /** A reminder due. */
  "REMINDER",
  /** Investor: new companies matching their mandate since last visit. */
  "NEW_MATCHES",
  /** Any other NEEDS_YOU notice. */
  "NOTICE",
] as const;
export const QAttentionSourceSchema = z.enum(Q_ATTENTION_SOURCES);
export type QAttentionSource = z.infer<typeof QAttentionSourceSchema>;

export const QAttentionEntitySchema = z
  .object({
    kind: z.enum([
      "COMPANY",
      "INVESTOR_ORGANISATION",
      "RELATIONSHIP",
      "DOCUMENT",
      "APPROVAL",
      "JOB",
      "MEETING",
    ]),
    id: UuidSchema,
  })
  .strict();

export const QAttentionItemSchema = z
  .object({
    /** Stable for this item, so a decision on it is remembered server-side. */
    key: z.string().min(1).max(160),
    source: QAttentionSourceSchema,
    /** Plain words: "Zino Aviation is waiting for your reply". */
    title: z.string().min(1).max(200),
    detail: z.string().max(600).optional(),
    entity: QAttentionEntitySchema.optional(),
    /** The counterpart's display name, when there is one. */
    counterpart: z.string().max(120).optional(),
    since: z.string().datetime({ offset: true }),
    /** Can it be decided right here (approve, send, dismiss)? */
    decidable: z.boolean(),
  })
  .strict();
export type QAttentionItem = z.infer<typeof QAttentionItemSchema>;

/** What Q and its agents did since a moment. Counts and names only. */
export const QActivitySummarySchema = z
  .object({
    since: z.string().datetime({ offset: true }),
    repliesSent: z.number().int().min(0),
    messagesSent: z.number().int().min(0),
    callsBooked: z.number().int().min(0),
    interestExpressed: z.number().int().min(0),
    draftsHeld: z.number().int().min(0),
    jobsCompleted: z.number().int().min(0),
    names: z.array(z.string().max(120)).max(8),
  })
  .strict();
export type QActivitySummary = z.infer<typeof QActivitySummarySchema>;

export const QAttentionReportSchema = z
  .object({
    items: z.array(QAttentionItemSchema).max(50),
    activity: QActivitySummarySchema.nullable(),
    /** Sources that could not be read this time: never reported as "nothing". */
    unread: z.array(QAttentionSourceSchema),
    readAt: z.string().datetime({ offset: true }),
  })
  .strict();
export type QAttentionReport = z.infer<typeof QAttentionReportSchema>;
