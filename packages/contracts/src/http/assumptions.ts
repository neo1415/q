import { z } from "zod";

import { UuidSchema } from "../common/ids.js";
import { UtcTimestampSchema } from "../common/time.js";
import { DiligenceRequestAboutSchema } from "./relationships.js";
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

export const ASSUMPTION_STANDINGS = [
  "EVIDENCED",
  "CLAIMED",
  "UNKNOWN",
] as const;
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
    /**
     * The reader's own question about it, sent to the founder (2026-10-08):
     * waiting, or the founder's answer (their claim, never verified by
     * being said). Absent: they have not asked.
     */
    asked: z
      .object({
        questionId: UuidSchema,
        askedAt: UtcTimestampSchema,
        answer: z
          .object({
            text: z.string().min(1).max(2000),
            answeredAt: UtcTimestampSchema,
            evidenceStatus: z.enum(["SELF_REPORTED", "DOCUMENT_SUPPORTED"]),
            documents: z
              .array(
                z
                  .object({
                    documentId: UuidSchema,
                    title: z.string().max(300),
                  })
                  .strict(),
              )
              .max(5),
          })
          .strict()
          .nullable(),
      })
      .strict()
      .optional(),
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
      .array(z.string().trim().min(3).max(ASSUMPTION_QUESTION_MAX_LENGTH))
      .min(1)
      .max(ASSUMPTION_QUESTIONS_SEND_MAX),
    /**
     * For each question, in order, the "Assumptions to test" item it came
     * from (null: their own question). Absent: none. Lets the founder see
     * what it is about and the board show it answered.
     */
    about: z
      .array(
        z
          .object({
            assumptionId: AssumptionDtoSchema.shape.id,
            label: z.string().min(1).max(120),
          })
          .strict()
          .nullable(),
      )
      .max(ASSUMPTION_QUESTIONS_SEND_MAX)
      .optional(),
    /**
     * The uncertainty these questions resolve (addendum 14 Nov 2026,
     * slice 5), kept on the diligence request they go as. Absent: none.
     */
    resolves: DiligenceRequestAboutSchema.nullable().optional(),
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
export function diligenceQuestionsText(questions: readonly string[]): {
  readonly title: string;
  readonly body: string;
} {
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

/**
 * A question to a company, as it will receive it (live 17 Nov 2026,
 * conversation 9995dcca, run a3ea0ea5). Q offered to "put this question to
 * Ajopot" and the card read "1. The records do not establish exactly who
 * pays Ajopot's 1% payout fee.": Q's own finding about its records, sent
 * word for word to the founder. What goes to them is the open question
 * itself ("Who pays Ajopot's 1% payout fee?").
 *
 * Deterministic and model-free. A finding that names what is not known
 * ("…do not establish who pays X", "it is unclear whether X") becomes that
 * question; anything already put as a question or an ask is kept as
 * written. Null: the text is still Q's own account of its evidence ("the
 * records…", "not evidenced"), which no company is ever sent.
 */
const ASKED_WORD = "(who|whom|whose|what|which|whether|how|when|where|why)";
const NOT_ESTABLISHED =
  "(?:it\\s+is\\s+(?:not\\s+(?:yet\\s+)?(?:clear|known|established|evidenced|recorded|stated)|unclear|unknown)" +
  "|(?:(?:the|our|available|existing|current)\\s+)*(?:records?|evidence|documents?|materials?|data(?:\\s+room)?|deck|sources?|filings?|disclosures?)" +
  "\\s+(?:do(?:es)?\\s+not|don['’]t|doesn['’]t)\\s+(?:yet\\s+)?(?:establish|show|confirm|say|state|specify|indicate|evidence|explain|record|make\\s+clear))";
const FINDING_AS_QUESTION = new RegExp(
  `^(?:.*?[,;]\\s*(?:but|and|yet|though)\\s+)?${NOT_ESTABLISHED}\\s+(?:exactly\\s+|clearly\\s+|precisely\\s+)?${ASKED_WORD}\\b\\s*(.+?)[\\s.!]*$`,
  "iu",
);
/** Q describing its own evidence: never a question to anyone. */
const FINDING_VOICE =
  /\b(?:(?:the|our|available|capital q['’]s|q['’]s)\s+(?:records?|evidence|materials|sources)\b|not\s+(?:yet\s+)?(?:established|evidenced|verified)\b|(?:is|are|remains?)\s+(?:unverified|unclear|unknown)\b)/iu;

export function questionToCompany(text: string): string | null {
  const said = text
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/^\d{1,2}[.)]\s+/u, "")
    .replace(/^["“'‘]+|["”]+$/gu, "")
    .trim();
  if (said.length === 0) return null;
  const found = FINDING_AS_QUESTION.exec(said);
  const asked = found?.[1]?.toLowerCase();
  const rest = found?.[2]?.trim();
  if (asked !== undefined && rest !== undefined && rest.length > 0) {
    return asked === "whether"
      ? `Can you confirm whether ${rest}?`
      : `${asked.charAt(0).toUpperCase()}${asked.slice(1)} ${rest}?`;
  }
  if (said.endsWith("?")) return said;
  return FINDING_VOICE.test(said) ? null : said;
}
