import { z } from "zod";

import { UuidSchema } from "../common/ids.js";
import { UtcTimestampSchema } from "../common/time.js";
import {
  EvidenceStatusSchema,
  TruthClassSchema,
} from "../evidence/vocabulary.js";

/**
 * Q.07 "Investors interview the opportunity" (2026-10-07): the founder's
 * key claims as an investor may see them, each with what it rests on and a
 * question to ask, plus the same claims as an evidence board (evidenced /
 * claimed / not known yet).
 *
 * Built in code from what this investor may already see (the founder's
 * CONFIRMED deck reading, where the deck is shared with them), never from
 * founder-private records and never by a model. The three axes stay apart:
 * `standing` is the board column, `truthClass` and `evidenceStatus` are
 * shown as separate labels, and a Q inference is never EVIDENCED. Unknown
 * is a standing of its own and never a negative.
 */

export const ASSUMPTION_STANDINGS = ["EVIDENCED", "CLAIMED", "UNKNOWN"] as const;
export const AssumptionStandingSchema = z.enum(ASSUMPTION_STANDINGS);
export type AssumptionStanding = z.infer<typeof AssumptionStandingSchema>;

export const ASSUMPTION_STANDING_LABELS: Readonly<
  Record<AssumptionStanding, string>
> = {
  EVIDENCED: "Evidenced",
  CLAIMED: "Claimed",
  UNKNOWN: "Not known yet",
};

/** Why a claim is not known; never shown as zero. */
export const AssumptionUnknownReasonSchema = z.enum([
  "NOT_IN_DECK",
  "UNCLEAR",
  "CONTRADICTORY",
  /** Nothing this investor may see covers it (no confirmed reading shared). */
  "NOT_SHARED",
]);
export type AssumptionUnknownReason = z.infer<
  typeof AssumptionUnknownReasonSchema
>;

export const ASSUMPTION_QUESTION_MAX_LENGTH = 180;
export const ASSUMPTION_QUESTIONS_SEND_MAX = 5;

export const AssumptionDtoSchema = z
  .object({
    /** Stable within one board: `SECTION:n` or `SECTION:unknown`. */
    id: z
      .string()
      .regex(/^[A-Z_]{3,24}:(\d{1,2}|unknown)$/)
      .max(40),
    sectionLabel: z.string().min(1).max(40),
    label: z.string().min(1).max(120),
    /** The stated value; null when not known. */
    value: z.string().min(1).max(300).nullable(),
    standing: AssumptionStandingSchema,
    /** Null only when nothing was stated (UNKNOWN). */
    truthClass: TruthClassSchema.nullable(),
    evidenceStatus: EvidenceStatusSchema.nullable(),
    unknownReason: AssumptionUnknownReasonSchema.nullable(),
    /** "Pitch deck, slide 9"; null when not from a page. */
    source: z.string().max(80).nullable(),
    /** What the claim rests on: standard diligence framing, not a finding. */
    restsOn: z.array(z.string().min(1).max(120)).max(3),
    /** A question to ask the founder, in plain words. */
    question: z.string().min(1).max(ASSUMPTION_QUESTION_MAX_LENGTH),
  })
  .strict();
export type AssumptionDto = z.infer<typeof AssumptionDtoSchema>;

export const AssumptionBoardDtoSchema = z
  .object({
    companyId: UuidSchema,
    /** What the board was built from, for this reader. */
    basis: z.enum(["CONFIRMED_DECK_READING", "NOTHING_SHARED"]),
    /** When Q read the deck the board came from; null with NOTHING_SHARED. */
    readAt: UtcTimestampSchema.nullable(),
    assumptions: z.array(AssumptionDtoSchema).max(40),
    counts: z
      .object({
        evidenced: z.number().int().min(0),
        claimed: z.number().int().min(0),
        unknown: z.number().int().min(0),
      })
      .strict(),
  })
  .strict();
export type AssumptionBoardDto = z.infer<typeof AssumptionBoardDtoSchema>;

/** `GET /v1/companies/:companyId/assumptions` — an investor reader only. */
export const COMPANY_ASSUMPTIONS_SEGMENT = "/assumptions" as const;

/**
 * `POST /v1/relationships/:relationshipId/diligence/questions` — the
 * investor sends the questions they picked (their exact wording, approved
 * on screen or on Q's card) to the company: a diligence request while the
 * relationship is in diligence, else one chat message on a connected
 * relationship. Idempotent by the `Idempotency-Key` header.
 */
export const DILIGENCE_QUESTIONS_PATH =
  "/v1/relationships/:relationshipId/diligence/questions" as const;

export const SendDiligenceQuestionsRequestSchema = z
  .object({
    questions: z
      .array(
        z.string().trim().min(3).max(ASSUMPTION_QUESTION_MAX_LENGTH),
      )
      .min(1)
      .max(ASSUMPTION_QUESTIONS_SEND_MAX),
  })
  .strict();
export type SendDiligenceQuestionsRequest = z.infer<
  typeof SendDiligenceQuestionsRequestSchema
>;

export const SendDiligenceQuestionsResultSchema = z
  .object({
    via: z.enum(["DILIGENCE_REQUEST", "CHAT_MESSAGE"]),
    /** The diligence request or chat message created. */
    id: UuidSchema,
  })
  .strict();
export type SendDiligenceQuestionsResult = z.infer<
  typeof SendDiligenceQuestionsResultSchema
>;

/** The exact text the founder receives; one rendering, screen and Q alike. */
export function diligenceQuestionsText(
  questions: readonly string[],
): { readonly title: string; readonly body: string } {
  // A diligence checklist item: what the company is asked to provide.
  const title =
    questions.length === 1
      ? "An answer to one question"
      : `Answers to ${String(questions.length)} questions`;
  return {
    title,
    body: questions
      .map((question, index) => `${String(index + 1)}. ${question.trim()}`)
      .join("\n"),
  };
}
