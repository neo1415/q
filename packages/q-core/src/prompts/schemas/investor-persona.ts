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

// ---------------------------------------------------------------------------
// v2 (REHEARSE, founder direction 2026-10-01): the counterpart of either
// side -- an investor for a founder, a founder for an investor -- read from
// what THIS viewer may see, and refreshed incrementally from the previous
// reading when new material arrives. Still Q's reading of style, never a
// fact about the person.
// ---------------------------------------------------------------------------

export const COUNTERPART_PERSONA_SCHEMA_NAME = "CounterpartPersonaResult";
export const COUNTERPART_PERSONA_SCHEMA_VERSION = 2;

/** How the person tends to be, and how they can turn, in a meeting. */
export const PERSONA_MOODS = [
  "WARM",
  "NEUTRAL",
  "SKEPTICAL",
  "IMPATIENT",
  "ANNOYED",
  "ENTHUSIASTIC",
  "COLD",
  "INDIFFERENT",
] as const;

export const CounterpartPersonaVariablesSchema = z
  .object({
    ...TaskFrameSchema,
    /** Who is rehearsing: FOUNDER or INVESTOR. Trusted. */
    viewerRole: z.enum(["FOUNDER", "INVESTOR"]),
    /** The rehearsing person's own company or fund. Trusted. */
    viewerOrganisation: z.string().max(200),
    /** Who Q will play: INVESTOR or FOUNDER. Trusted. */
    counterpartRole: z.enum(["INVESTOR", "FOUNDER"]),
    /** Their name and profile, as the viewer may see it. UNTRUSTED. */
    counterpartProfile: z.string().max(6_000),
    /** What they wrote to the viewer, oldest first. UNTRUSTED. */
    theirMessages: z.string().max(12_000),
    /** What they said in calls with the viewer. UNTRUSTED. */
    theirWordsInCalls: z.string().max(20_000),
    /** Public web snippets and public knowledge, with sources. UNTRUSTED. */
    publicPresence: z.string().max(6_000),
    /** Pitch transcripts and deck text the viewer may see. UNTRUSTED. */
    pitchMaterial: z.string().max(16_000),
    /** The previous reading, refreshed rather than rebuilt. UNTRUSTED. */
    previousProfile: z.string().max(8_000),
  })
  .strict();
export type CounterpartPersonaVariables = z.infer<
  typeof CounterpartPersonaVariablesSchema
>;

export const COUNTERPART_PERSONA_UNTRUSTED = [
  "counterpartProfile",
  "theirMessages",
  "theirWordsInCalls",
  "publicPresence",
  "pitchMaterial",
  "previousProfile",
] as const;

const Line = (max: number) => z.string().trim().min(3).max(max);

export const CounterpartPersonaResultSchema = z
  .object({
    /** Two or three sentences: who they are in a meeting. */
    summary: z.string().trim().min(1).max(600),
    /** How they speak: tone, pace, verbal habits, how hard they push. */
    style: z.string().trim().min(1).max(400),
    /** Their baseline mood, and what warms or cools them. */
    temperament: z
      .object({
        baseline: z.enum(PERSONA_MOODS),
        warmsTo: z.array(Line(200)).max(5),
        coolsOn: z.array(Line(200)).max(5),
      })
      .strict(),
    priorities: z.array(Line(200)).max(6),
    /** What they will ask, hardest first. */
    likelyQuestions: z
      .array(z.object({ question: Line(300), why: Line(200) }).strict())
      .min(3)
      .max(12),
    /** For a founder Q plays: how they answer the hard questions. */
    likelyAnswers: z
      .array(z.object({ topic: Line(120), answer: Line(400) }).strict())
      .max(10),
    pushbacks: z.array(Line(200)).max(6),
    howToWin: z.array(Line(200)).max(6),
    /** What would end it for them. */
    dealbreakers: z.array(Line(200)).max(5),
    grounding: z.enum(["THIN", "SOME", "RICH"]),
  })
  .strict();
export type CounterpartPersonaResult = z.infer<
  typeof CounterpartPersonaResultSchema
>;
