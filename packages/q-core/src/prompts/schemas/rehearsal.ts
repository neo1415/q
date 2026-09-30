import { z } from "zod";

import { TaskFrameSchema } from "./common.js";

/**
 * The Investor Twin rehearsal (founder direction 2026-09-30, C12): Q plays
 * an investor so a founder can practise the meeting, then scores how the
 * founder did.
 *
 * The persona Q plays comes only from INVESTOR_PERSONA, which reads what
 * this founder may already see of the investor. The founder's answers are
 * practice, never evidence: nothing said in a rehearsal becomes a fact,
 * a claim or a memory about the company.
 */

export const INVESTOR_TWIN_TURN_SCHEMA_NAME = "InvestorTwinTurnResult";
export const INVESTOR_TWIN_TURN_SCHEMA_VERSION = 1;

export const InvestorTwinTurnVariablesSchema = z
  .object({
    ...TaskFrameSchema,
    /** The founder's company name. Trusted (their own record). */
    companyName: z.string().max(200),
    /** The investor's name. UNTRUSTED (their own record). */
    investorName: z.string().max(200),
    /** The persona to play, as Q read it. UNTRUSTED (built from their words). */
    persona: z.string().max(8_000),
    /** The rehearsal so far, oldest first. UNTRUSTED (the founder's practice). */
    rehearsal: z.string().max(24_000),
    /** How many questions the investor has asked so far. Trusted. */
    asked: z.number().int().min(0).max(40),
    /** How many questions the rehearsal should run to. Trusted. */
    length: z.number().int().min(3).max(20),
  })
  .strict();
export type InvestorTwinTurnVariables = z.infer<
  typeof InvestorTwinTurnVariablesSchema
>;

export const INVESTOR_TWIN_TURN_UNTRUSTED = [
  "investorName",
  "persona",
  "rehearsal",
] as const;

export const InvestorTwinTurnResultSchema = z
  .object({
    /** What the investor says next, in their voice: one question or pushback. */
    line: z.string().trim().min(1).max(700),
    /** QUESTION: a new question. FOLLOW_UP: pressing on the last answer. CLOSE: the meeting ends. */
    move: z.enum(["QUESTION", "FOLLOW_UP", "CLOSE"]),
  })
  .strict();
export type InvestorTwinTurnResult = z.infer<
  typeof InvestorTwinTurnResultSchema
>;

export const REHEARSAL_SCORE_SCHEMA_NAME = "RehearsalScoreResult";
export const REHEARSAL_SCORE_SCHEMA_VERSION = 1;

export const RehearsalScoreVariablesSchema = z
  .object({
    ...TaskFrameSchema,
    companyName: z.string().max(200),
    investorName: z.string().max(200),
    persona: z.string().max(8_000),
    rehearsal: z.string().max(24_000),
  })
  .strict();
export type RehearsalScoreVariables = z.infer<
  typeof RehearsalScoreVariablesSchema
>;

export const REHEARSAL_SCORE_UNTRUSTED = [
  "investorName",
  "persona",
  "rehearsal",
] as const;

/** Each dimension is rated in words, never a made-up percentage. */
export const REHEARSAL_RATINGS = ["STRONG", "SOLID", "NEEDS_WORK"] as const;

export const RehearsalScoreResultSchema = z
  .object({
    /** Two or three sentences: how the meeting would likely have gone. */
    overall: z.string().trim().min(1).max(600),
    dimensions: z
      .array(
        z
          .object({
            name: z.enum([
              "CLARITY",
              "EVIDENCE",
              "HANDLING_PUSHBACK",
              "FIT_TO_THIS_INVESTOR",
              "THE_ASK",
            ]),
            rating: z.enum(REHEARSAL_RATINGS),
            note: z.string().trim().min(3).max(300),
          })
          .strict(),
      )
      .min(1)
      .max(5),
    /** Their strongest moments, quoting them where possible. */
    strengths: z.array(z.string().trim().min(3).max(300)).max(5),
    /** What to fix before the real meeting, most important first. */
    fixes: z
      .array(
        z
          .object({
            question: z.string().trim().min(3).max(300),
            better: z.string().trim().min(3).max(500),
          })
          .strict(),
      )
      .max(6),
  })
  .strict();
export type RehearsalScoreResult = z.infer<typeof RehearsalScoreResultSchema>;
