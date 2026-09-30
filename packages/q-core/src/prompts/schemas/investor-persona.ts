import { z } from "zod";

import { TaskFrameSchema } from "./common.js";

/**
 * INVESTOR_PERSONA -- who an investor is in a meeting, so Q can play them
 * for a founder's rehearsal (founder direction 2026-09-30, the Investor
 * Twin).
 *
 * Built only from what this founder may see: the investor's declared,
 * network-visible profile, what the investor wrote to this founder, and
 * what the investor said in calls this founder was on. Never the
 * investor's mandate, never their private conversations with Q. The
 * persona is Q's reading of those words, not a fact about the person.
 */

export const INVESTOR_PERSONA_SCHEMA_NAME = "InvestorPersonaResult";
export const INVESTOR_PERSONA_SCHEMA_VERSION = 1;

export const InvestorPersonaVariablesSchema = z
  .object({
    ...TaskFrameSchema,
    /** The founder's company name. Trusted (their own record). */
    companyName: z.string().max(200),
    /** The investor's name and declared profile. UNTRUSTED. */
    investorProfile: z.string().max(4_000),
    /** What the investor wrote to this founder, oldest first. UNTRUSTED. */
    theirMessages: z.string().max(12_000),
    /** What the investor said in calls with this founder. UNTRUSTED. */
    theirWordsInCalls: z.string().max(20_000),
  })
  .strict();
export type InvestorPersonaVariables = z.infer<
  typeof InvestorPersonaVariablesSchema
>;

export const INVESTOR_PERSONA_UNTRUSTED = [
  "investorProfile",
  "theirMessages",
  "theirWordsInCalls",
] as const;

export const InvestorPersonaResultSchema = z
  .object({
    /** Two or three sentences: who they are in a meeting. */
    summary: z.string().trim().min(1).max(600),
    /** How they speak: tone, pace, how hard they push. */
    style: z.string().trim().min(1).max(300),
    /** What they care about most, most important first. */
    priorities: z.array(z.string().trim().min(3).max(200)).max(6),
    /** Questions they are likely to ask this founder, hardest first. */
    likelyQuestions: z
      .array(
        z
          .object({
            question: z.string().trim().min(5).max(300),
            why: z.string().trim().min(3).max(200),
          })
          .strict(),
      )
      .min(3)
      .max(12),
    /** How they push back when an answer is weak. */
    pushbacks: z.array(z.string().trim().min(3).max(200)).max(6),
    /** What would win them over, from their own words where possible. */
    howToWin: z.array(z.string().trim().min(3).max(200)).max(6),
    /** How much of this rests on their own words: THIN, SOME or RICH. */
    grounding: z.enum(["THIN", "SOME", "RICH"]),
  })
  .strict();
export type InvestorPersonaResult = z.infer<typeof InvestorPersonaResultSchema>;
