import { z } from "zod";

import { UuidSchema } from "../common/ids.js";
import { NamedPictureSchema } from "../common/named-picture.js";
import { UtcTimestampSchema } from "../common/time.js";

/**
 * Q's work page (WORK-58, founder decision 2026-10-04): what Q suggests
 * from the person's own account signals, pausing and resuming their own
 * standing instruction, and what Q finished, a page at a time.
 *
 * Suggestions are read by code, never a model: each one comes from a row
 * the person can already see on their own side (a relationship, their
 * saved list, a call they were on, their documents, their mandate), so a
 * suggestion never carries the other side's private facts. Tapping one
 * asks Q to prepare it through the normal propose path; the result is the
 * usual approval card, and nothing happens before the person approves.
 */

export const Q_WORK_SUGGESTIONS_PATH = "/v1/q/work/suggestions" as const;
export const Q_WORK_SUGGESTION_DISMISSALS_PATH =
  "/v1/q/work/suggestions/dismissals" as const;
export const Q_WORK_PAUSE_PATH = "/v1/q/work/:delegationId/pause" as const;
export const Q_WORK_RESUME_PATH = "/v1/q/work/:delegationId/resume" as const;
export const Q_WORK_DONE_PATH = "/v1/q/work/done" as const;

/**
 * Scoped delegation (founder 2026-10-07): the person switches routine
 * relationship moves on or off for one of their own instructions.
 */
export const Q_WORK_DELEGATION_PATH =
  "/v1/q/work/:delegationId/delegation" as const;
export const qWorkDelegationPath = (delegationId: string) =>
  Q_WORK_DELEGATION_PATH.replace(
    ":delegationId",
    encodeURIComponent(delegationId),
  );

export const qWorkPausePath = (delegationId: string) =>
  Q_WORK_PAUSE_PATH.replace(":delegationId", encodeURIComponent(delegationId));
export const qWorkResumePath = (delegationId: string) =>
  Q_WORK_RESUME_PATH.replace(":delegationId", encodeURIComponent(delegationId));

/** At most this many suggestions are shown; the page never becomes a feed. */
export const Q_WORK_SUGGESTIONS_MAX = 5;

/**
 * The signal behind a suggestion, in rank order: what waits on someone
 * first, then new opportunities, then setup.
 */
export const Q_WORK_SUGGESTION_KINDS = [
  /** They asked to connect and wait for this person's answer. */
  "CONNECT_WAITING",
  /** This person's side waits for the other side's answer past the nudge age. */
  "STALLED_REPLY",
  /** A call this person was on ended without a follow-up sent. */
  "CALL_RECAP",
  /** New companies on an investor's slate since they last looked. */
  "NEW_MATCHES",
  /** Saved by an investor, interest never expressed. */
  "SAVED_NO_INTEREST",
  /** A founder's deck exists but is not shared with investors. */
  "DECK_UNSHARED",
  /** Declared mandate fields an investor left empty. */
  "MANDATE_GAPS",
] as const;
export type QWorkSuggestionKind = (typeof Q_WORK_SUGGESTION_KINDS)[number];

/** Opaque and stable per signal and subject; never free text. */
export const QWorkSuggestionKeySchema = z
  .string()
  .regex(/^[a-z_]{2,40}:[A-Za-z0-9:_-]{1,160}$/u);

export const QWorkSuggestionDtoSchema = z
  .object({
    key: QWorkSuggestionKeySchema,
    kind: z.enum(Q_WORK_SUGGESTION_KINDS),
    /** The number the card leads with ("6" days, "3" new); a count or an age. */
    lead: z.number().int().min(0).max(9_999),
    /** Its unit, one short word ("days", "new", "call"). */
    unit: z.string().min(1).max(12),
    /** Who or what it is about, in a few words. */
    subject: z.string().min(1).max(120),
    /** The question the card asks ("Follow up?"). */
    question: z.string().min(1).max(80),
    /**
     * What tapping asks Q to prepare, in the person's own voice. Q answers
     * it through the normal propose path; it is a request, never authority.
     */
    prompt: z.string().min(1).max(400),
    /** The page it is about, when there is one (never a broken link). */
    linkPath: z
      .string()
      .regex(/^\/[A-Za-z0-9/_?=&-]{0,200}$/u)
      .nullable(),
    /**
     * Who the row's link names (their side of the person's own
     * relationship), with their logo under the name's scope. Absent: none.
     */
    named: NamedPictureSchema.nullable().optional(),
  })
  .strict();
export type QWorkSuggestionDto = z.infer<typeof QWorkSuggestionDtoSchema>;

export const QWorkSuggestionListDtoSchema = z
  .object({
    items: z.array(QWorkSuggestionDtoSchema).max(Q_WORK_SUGGESTIONS_MAX),
  })
  .strict();
export type QWorkSuggestionListDto = z.infer<
  typeof QWorkSuggestionListDtoSchema
>;

/** `POST` "Not now": additive and idempotent per person and key. */
export const QWorkSuggestionDismissRequestSchema = z
  .object({ key: QWorkSuggestionKeySchema })
  .strict();
export type QWorkSuggestionDismissRequest = z.infer<
  typeof QWorkSuggestionDismissRequestSchema
>;

/** One thing Q finished: a short line and, where it exists, what it changed. */
export const QWorkDoneItemDtoSchema = z
  .object({
    id: UuidSchema,
    words: z.string().min(1).max(500),
    at: UtcTimestampSchema,
    linkPath: z
      .string()
      .regex(/^\/[A-Za-z0-9/_?=&-]{0,200}$/u)
      .nullable(),
    /**
     * Who the row's link names (their side of the person's own
     * relationship), with their logo under the name's scope. Absent: none.
     */
    named: NamedPictureSchema.nullable().optional(),
  })
  .strict();
export type QWorkDoneItemDto = z.infer<typeof QWorkDoneItemDtoSchema>;

export const Q_WORK_DONE_PAGE_MAX = 20;

export const QWorkDoneQuerySchema = z
  .object({
    cursor: z.string().min(1).max(200).optional(),
    limit: z.coerce.number().int().min(1).max(Q_WORK_DONE_PAGE_MAX).optional(),
  })
  .strict();

export const QWorkDonePageDtoSchema = z
  .object({
    items: z.array(QWorkDoneItemDtoSchema).max(Q_WORK_DONE_PAGE_MAX),
    /** Done this week, for the collapsed row. */
    thisWeek: z.number().int().min(0),
    nextCursor: z.string().min(1).max(200).nullable(),
  })
  .strict();
export type QWorkDonePageDto = z.infer<typeof QWorkDonePageDtoSchema>;
