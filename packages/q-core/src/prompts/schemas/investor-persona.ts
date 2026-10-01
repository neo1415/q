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
      .min(1)
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

// ---------------------------------------------------------------------------
// v3 (REHEARSE audit, live 2026-10-01): the v2 reading was refused whole
// when the model wrote a seventh priority or a long style line
// ("priorities:too_big", "style:too_big" on every live attempt). The model
// now answers a lenient shape and code trims it to the stored bounds, so
// one long list never costs the whole persona (handover lesson: lenient
// per field).
// ---------------------------------------------------------------------------

export const COUNTERPART_PERSONA_V3_SCHEMA_VERSION = 3;

const Loose = (max: number) => z.string().trim().min(1).max(max);

export const CounterpartPersonaLenientSchema = z
  .object({
    summary: Loose(2_000),
    style: Loose(1_200),
    temperament: z
      .object({
        baseline: z.enum(PERSONA_MOODS),
        warmsTo: z.array(Loose(600)).max(20),
        coolsOn: z.array(Loose(600)).max(20),
      })
      .strict(),
    priorities: z.array(Loose(600)).max(20),
    likelyQuestions: z
      .array(z.object({ question: Loose(800), why: Loose(600) }).strict())
      .min(1)
      .max(30),
    likelyAnswers: z
      .array(z.object({ topic: Loose(400), answer: Loose(1_200) }).strict())
      .max(30),
    pushbacks: z.array(Loose(600)).max(20),
    howToWin: z.array(Loose(600)).max(20),
    dealbreakers: z.array(Loose(600)).max(20),
    grounding: z.enum(["THIN", "SOME", "RICH"]),
  })
  .strict();
export type CounterpartPersonaLenient = z.infer<
  typeof CounterpartPersonaLenientSchema
>;

/** Cut to a bound at a word, so a trimmed line still reads. */
function cut(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = text.slice(0, max - 1);
  const space = head.lastIndexOf(" ");
  return `${(space > max * 0.6 ? head.slice(0, space) : head).trimEnd()}…`;
}
const cutAll = (items: readonly string[], count: number, max: number) =>
  items.slice(0, count).map((item) => cut(item, max));

/** The lenient reading, trimmed to the stored (v2) shape. */
export function normaliseCounterpartPersona(
  loose: CounterpartPersonaLenient,
): CounterpartPersonaResult {
  return {
    summary: cut(loose.summary, 600),
    style: cut(loose.style, 300),
    temperament: {
      baseline: loose.temperament.baseline,
      warmsTo: cutAll(loose.temperament.warmsTo, 5, 200),
      coolsOn: cutAll(loose.temperament.coolsOn, 5, 200),
    },
    priorities: cutAll(loose.priorities, 6, 200),
    likelyQuestions: loose.likelyQuestions.slice(0, 12).map((q) => ({
      question: cut(q.question, 300),
      why: cut(q.why, 200),
    })),
    likelyAnswers: loose.likelyAnswers.slice(0, 10).map((a) => ({
      topic: cut(a.topic, 120),
      answer: cut(a.answer, 400),
    })),
    pushbacks: cutAll(loose.pushbacks, 6, 200),
    howToWin: cutAll(loose.howToWin, 6, 200),
    dealbreakers: cutAll(loose.dealbreakers, 5, 200),
    grounding: loose.grounding,
  };
}

// ---------------------------------------------------------------------------
// v4 (REHEARSE, founder live test 2026-10-01): played as a founder, the
// persona asked the investor "why are you interested?" as if it held the
// leverage. The reading now says how forward this person is, with why, and
// lists the traits it rests on with where each came from, so code can tell
// the played person who holds the leverage and the lobby can show it.
// ---------------------------------------------------------------------------

export const COUNTERPART_PERSONA_V4_SCHEMA_VERSION = 4;

/** How hard this person pushes beyond what their side of the table usually does. */
export const PERSONA_FORWARDNESS = ["RESERVED", "TYPICAL", "FORWARD"] as const;
export type PersonaForwardness = (typeof PERSONA_FORWARDNESS)[number];

/** Where a known trait came from. */
export const PERSONA_TRAIT_SOURCES = [
  "PROFILE",
  "MESSAGES",
  "CALLS",
  "PUBLIC",
  "PITCH",
] as const;

const KnownTrait = z
  .object({
    trait: z.string().trim().min(3).max(200),
    source: z.enum(PERSONA_TRAIT_SOURCES),
  })
  .strict();

/** The stored reading: v2's shape, plus v4's stance and traits when read by v4. */
export const CounterpartPersonaStoredSchema =
  CounterpartPersonaResultSchema.extend({
    forwardness: z.enum(PERSONA_FORWARDNESS).optional(),
    forwardnessWhy: z.string().trim().max(300).optional(),
    knownTraits: z.array(KnownTrait).max(8).optional(),
  }).strict();
export type CounterpartPersonaStored = z.infer<
  typeof CounterpartPersonaStoredSchema
>;

export const CounterpartPersonaV4LenientSchema =
  CounterpartPersonaLenientSchema.extend({
    forwardness: z.enum(PERSONA_FORWARDNESS),
    forwardnessWhy: z.string().trim().max(1_200),
    knownTraits: z
      .array(
        z
          .object({
            trait: Loose(600),
            source: z.enum(PERSONA_TRAIT_SOURCES),
          })
          .strict(),
      )
      .max(20),
  }).strict();
export type CounterpartPersonaV4Lenient = z.infer<
  typeof CounterpartPersonaV4LenientSchema
>;

export function normaliseCounterpartPersonaV4(
  loose: CounterpartPersonaV4Lenient,
): CounterpartPersonaStored {
  return {
    ...normaliseCounterpartPersona(loose),
    forwardness: loose.forwardness,
    forwardnessWhy: cut(loose.forwardnessWhy, 300),
    knownTraits: loose.knownTraits
      .filter((t) => t.trait.length >= 3)
      .slice(0, 8)
      .map((t) => ({ trait: cut(t.trait, 200), source: t.source })),
  };
}
