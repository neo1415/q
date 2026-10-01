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

// ---------------------------------------------------------------------------
// v2 (REHEARSE, founder direction 2026-10-01): Q plays either side by voice,
// with a mood per line, yields to a raised hand, may see a shared screen,
// and runs to a natural conclusion. The review is role-aware; its score is
// computed by code from the ratings, never a number the model invents.
// ---------------------------------------------------------------------------

export const REHEARSAL_TURN_SCHEMA_NAME = "RehearsalTurnResult";
export const REHEARSAL_TURN_SCHEMA_VERSION = 2;

export const REHEARSAL_MOVES = [
  "QUESTION",
  "FOLLOW_UP",
  "ANSWER",
  "REMARK",
  "YIELD",
  "CLOSE",
] as const;
export const REHEARSAL_LINE_MOODS = [
  "WARM",
  "NEUTRAL",
  "SKEPTICAL",
  "IMPATIENT",
  "ANNOYED",
  "ENTHUSIASTIC",
  "COLD",
  "INDIFFERENT",
] as const;
/** How the meeting ended, in the person Q plays' judgement. */
export const REHEARSAL_CONCLUSIONS = [
  "INDECISIVE",
  "STRONG_LATER",
  "ADJOURNED",
  "DEAL_AGREED",
  "DECLINED",
] as const;
/** Code-composed cues for a turn; never the person's words. */
export const REHEARSAL_CUES = [
  "OPENING",
  "NONE",
  "HAND_RAISED",
  "WRAP_UP",
] as const;

export const RehearsalTurnVariablesSchema = z
  .object({
    ...TaskFrameSchema,
    viewerRole: z.enum(["FOUNDER", "INVESTOR"]),
    /** The rehearsing person's own company or fund. Trusted. */
    viewerOrganisation: z.string().max(200),
    /** Who Q plays. UNTRUSTED (their own record). */
    counterpartName: z.string().max(200),
    counterpartRole: z.enum(["INVESTOR", "FOUNDER"]),
    /** The persona, as Q read it. UNTRUSTED. */
    persona: z.string().max(10_000),
    /** Material to ask or answer from (pitch transcripts, deck, profile). UNTRUSTED. */
    meetingMaterial: z.string().max(16_000),
    /** The meeting so far. UNTRUSTED. */
    rehearsal: z.string().max(24_000),
    /** Trusted counts and cues composed by code. */
    turnsSoFar: z.number().int().min(0).max(400),
    minutesElapsed: z.number().int().min(0).max(600),
    cue: z.enum(REHEARSAL_CUES),
    /** A frame of the viewer's shared screen is attached to this turn. */
    screenShared: z.boolean(),
  })
  .strict();
export type RehearsalTurnVariables = z.infer<
  typeof RehearsalTurnVariablesSchema
>;

export const REHEARSAL_TURN_UNTRUSTED = [
  "counterpartName",
  "persona",
  "meetingMaterial",
  "rehearsal",
] as const;

export const RehearsalTurnResultSchema = z
  .object({
    /** What they say next, spoken: one to four short sentences. */
    line: z.string().trim().min(1).max(700),
    move: z.enum(REHEARSAL_MOVES),
    mood: z.enum(REHEARSAL_LINE_MOODS),
    /** Set only with move CLOSE. */
    conclusion: z.enum(REHEARSAL_CONCLUSIONS).nullable(),
  })
  .strict();
export type RehearsalTurnResult = z.infer<typeof RehearsalTurnResultSchema>;

export const REHEARSAL_REVIEW_SCHEMA_NAME = "RehearsalReviewResult";
export const REHEARSAL_REVIEW_SCHEMA_VERSION = 2;

export const REHEARSAL_DIMENSIONS = [
  "CLARITY",
  "EVIDENCE",
  "HANDLING_PUSHBACK",
  "FIT_TO_THIS_PERSON",
  "THE_ASK",
  "QUESTION_QUALITY",
  "RAPPORT",
  "NEXT_STEPS",
] as const;

export const RehearsalReviewVariablesSchema = z
  .object({
    ...TaskFrameSchema,
    viewerRole: z.enum(["FOUNDER", "INVESTOR"]),
    viewerOrganisation: z.string().max(200),
    counterpartName: z.string().max(200),
    persona: z.string().max(10_000),
    rehearsal: z.string().max(24_000),
    /** How it ended, as recorded: a conclusion, or LEFT_EARLY. Trusted. */
    ending: z.string().max(40),
  })
  .strict();
export type RehearsalReviewVariables = z.infer<
  typeof RehearsalReviewVariablesSchema
>;

export const REHEARSAL_REVIEW_UNTRUSTED = [
  "counterpartName",
  "persona",
  "rehearsal",
] as const;

export const RehearsalReviewResultSchema = z
  .object({
    /** Two or three sentences: how the real meeting would likely go. */
    overall: z.string().trim().min(1).max(600),
    dimensions: z
      .array(
        z
          .object({
            name: z.enum(REHEARSAL_DIMENSIONS),
            rating: z.enum(REHEARSAL_RATINGS),
            note: z.string().trim().min(3).max(300),
          })
          .strict(),
      )
      .min(1)
      .max(5),
    wentRight: z
      .array(
        z
          .object({
            moment: z.string().trim().min(3).max(300),
            why: z.string().trim().min(3).max(300),
          })
          .strict(),
      )
      .max(5),
    wentWrong: z
      .array(
        z
          .object({
            moment: z.string().trim().min(3).max(300),
            why: z.string().trim().min(3).max(300),
            better: z.string().trim().min(3).max(500),
          })
          .strict(),
      )
      .max(6),
    /** Tips for meeting THIS person, from the persona. */
    tips: z.array(z.string().trim().min(3).max(300)).max(6),
  })
  .strict();
export type RehearsalReviewResult = z.infer<typeof RehearsalReviewResultSchema>;

// ---------------------------------------------------------------------------
// v3 (REHEARSE audit, 2026-10-01): a chosen difficulty, a silence cue, a
// wider range of moods and a loudness and reaction per line, so the played
// person can sound angry, kind, flat, authoritative or meek in their voice.
// ---------------------------------------------------------------------------

export const REHEARSAL_TURN_V3_SCHEMA_VERSION = 3;

export const REHEARSAL_LINE_MOODS_V3 = [
  "WARM",
  "NEUTRAL",
  "SKEPTICAL",
  "IMPATIENT",
  "ANNOYED",
  "ANGRY",
  "ENTHUSIASTIC",
  "COLD",
  "INDIFFERENT",
  "SAD",
  "AUTHORITATIVE",
  "MEEK",
  "SARCASTIC",
  "AMUSED",
] as const;
export const REHEARSAL_DIFFICULTIES = ["GENTLE", "REALISTIC", "TOUGH"] as const;
export const REHEARSAL_CUES_V3 = [
  "OPENING",
  "NONE",
  "HAND_RAISED",
  "WRAP_UP",
  "SILENCE",
] as const;

export const RehearsalTurnV3VariablesSchema =
  RehearsalTurnVariablesSchema.extend({
    cue: z.enum(REHEARSAL_CUES_V3),
    /** How hard the person rehearsing asked them to be played. Trusted. */
    difficulty: z.enum(REHEARSAL_DIFFICULTIES),
  }).strict();
export type RehearsalTurnV3Variables = z.infer<
  typeof RehearsalTurnV3VariablesSchema
>;

export const RehearsalTurnV3ResultSchema = z
  .object({
    /** Lenient; the service keeps at most 700 characters of it. */
    line: z.string().trim().min(1).max(2_000),
    move: z.enum(REHEARSAL_MOVES),
    /** How this line sounds; it drives the voice's delivery. */
    mood: z.enum(REHEARSAL_LINE_MOODS_V3),
    /** SOFT: quiet, under the breath. RAISED: a raised voice. */
    intensity: z.enum(["SOFT", "NORMAL", "RAISED"]),
    /** A sound before the line, only when the person would make it. */
    reaction: z.enum(["LAUGH", "CHUCKLE", "SIGH"]).nullable(),
    conclusion: z.enum(REHEARSAL_CONCLUSIONS).nullable(),
  })
  .strict();
export type RehearsalTurnV3Result = z.infer<typeof RehearsalTurnV3ResultSchema>;

// v3 review (REHEARSE audit): lenient like the persona, trimmed by code.
export const REHEARSAL_REVIEW_V3_SCHEMA_VERSION = 3;
const LooseText = (max: number) => z.string().trim().min(1).max(max);
export const RehearsalReviewLenientSchema = z
  .object({
    overall: LooseText(2_000),
    dimensions: z
      .array(
        z
          .object({
            name: z.enum(REHEARSAL_DIMENSIONS),
            rating: z.enum(REHEARSAL_RATINGS),
            note: LooseText(1_000),
          })
          .strict(),
      )
      .min(1)
      .max(10),
    wentRight: z
      .array(
        z.object({ moment: LooseText(1_000), why: LooseText(1_000) }).strict(),
      )
      .max(15),
    wentWrong: z
      .array(
        z
          .object({
            moment: LooseText(1_000),
            why: LooseText(1_000),
            better: LooseText(1_500),
          })
          .strict(),
      )
      .max(15),
    tips: z.array(LooseText(1_000)).max(15),
  })
  .strict();
export type RehearsalReviewLenient = z.infer<
  typeof RehearsalReviewLenientSchema
>;

function cutText(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = text.slice(0, max - 1);
  const space = head.lastIndexOf(" ");
  return `${(space > max * 0.6 ? head.slice(0, space) : head).trimEnd()}…`;
}

/** The lenient review trimmed to the stored (v2) shape; one rating per dimension. */
export function normaliseRehearsalReview(
  loose: RehearsalReviewLenient,
): RehearsalReviewResult {
  const seen = new Set<string>();
  const dimensions = loose.dimensions
    .filter((d) => (seen.has(d.name) ? false : (seen.add(d.name), true)))
    .slice(0, 5)
    .map((d) => ({
      name: d.name,
      rating: d.rating,
      note: cutText(d.note, 300),
    }));
  return {
    overall: cutText(loose.overall, 600),
    dimensions,
    wentRight: loose.wentRight
      .slice(0, 5)
      .map((w) => ({
        moment: cutText(w.moment, 300),
        why: cutText(w.why, 300),
      })),
    wentWrong: loose.wentWrong.slice(0, 6).map((w) => ({
      moment: cutText(w.moment, 300),
      why: cutText(w.why, 300),
      better: cutText(w.better, 500),
    })),
    tips: loose.tips.slice(0, 6).map((tip) => cutText(tip, 300)),
  };
}
