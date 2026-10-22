import { z } from "zod";

/**
 * Q Story ending (2026-10-22): after the story Q asks "Do you have any
 * questions?". The browser answers what the Q&A bank's word matcher is sure
 * of at once (tier 1, no request). What it is not sure of comes here: the
 * Q API embeds the question through the reviewed embedding adapter and
 * compares it with the bank's precomputed vectors (tier 2). The provider key
 * never reaches the browser.
 *
 * Only entry ids travel back. The bank itself (answers, wordings) is public
 * product copy the browser already holds.
 */
export const Q_PITCH_QA_MATCH_PATH = "/v1/q-pitch/qa/match" as const;
export const Q_PITCH_QA_TEXT_MAX = 300;

const QaEntryIdSchema = z.string().regex(/^qa\.[a-z0-9][a-z0-9.-]{1,62}$/u);

export const QPitchQaMatchRequestSchema = z
  .object({
    text: z.string().trim().min(1).max(Q_PITCH_QA_TEXT_MAX),
    /** Which side's bank: the audience the story was told to. */
    side: z.enum(["INVESTOR", "FOUNDER"]),
  })
  .strict();
export type QPitchQaMatchRequest = z.infer<typeof QPitchQaMatchRequestSchema>;

const timing = {
  /** 1: the word matcher decided; 2: meaning by embedding decided. */
  tier: z.union([z.literal(1), z.literal(2)]),
  /** Server time spent, for the latency budget. */
  ms: z.number().int().min(0).max(60_000),
};

export const QPitchQaMatchResponseSchema = z.discriminatedUnion("kind", [
  z
    .object({ kind: z.literal("ANSWER"), entryId: QaEntryIdSchema, ...timing })
    .strict(),
  z
    .object({
      kind: z.literal("CLARIFY"),
      entryIds: z.array(QaEntryIdSchema).min(1).max(2),
      ...timing,
    })
    .strict(),
  z.object({ kind: z.literal("LEAVE_TO_Q"), ...timing }).strict(),
]);
export type QPitchQaMatchResponse = z.infer<typeof QPitchQaMatchResponseSchema>;
