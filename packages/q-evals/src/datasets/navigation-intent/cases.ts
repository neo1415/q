/**
 * C10 navigation-intent eval (owner directive 13 Nov 2026: semantic intent,
 * not keyword routing). Natural paraphrases, spoken and non-English
 * phrasings, follow-ups, multi-part turns and negatives for TURN_READER
 * v83's typed `navigation` intent, each with the intent a correct reading
 * carries. Graded by code (test/navigation-intent.test.ts offline,
 * test/navigation-intent.live.test.ts on the real reader), never by a
 * model. Synthetic, fictional companies only.
 *
 * The live misreadings (5af6c8ad3, 13 Nov) are cases none-01..03: a chart
 * question, "Now do the same for Silo Credit." and "What stage is
 * Ledgerline at?" each moved or offered a page nobody asked for.
 */

import type { TurnNavigationMode } from "@capital-q/q-core";

export type NavigationIntentTurn = {
  readonly role: "USER" | "Q";
  readonly text: string;
};

export type NavigationIntentExpected = {
  readonly mode: TurnNavigationMode;
  /** True: they said not to go or open anything (mode NONE then). */
  readonly negated?: boolean | undefined;
  /** True: the turn also asks more, so the reading's parts hold two or more. */
  readonly multiPart?: boolean | undefined;
};

export type NavigationIntentCase = {
  readonly id: string;
  readonly said: string;
  readonly recent: readonly NavigationIntentTurn[];
  readonly modality?: "VOICE" | "TEXT" | undefined;
  readonly expected: NavigationIntentExpected;
};

const LEDGERLINE_CHART: readonly NavigationIntentTurn[] = [
  {
    role: "USER",
    text: "How has Ledgerline's monthly recurring revenue moved since June? Let me see it visually.",
  },
  {
    role: "Q",
    text: "Here is Ledgerline's monthly recurring revenue as the company states it: USD 30,000 in June 2026 rising to USD 42,000 in September 2026.",
  },
];

const CLINICREST_SHOWN: readonly NavigationIntentTurn[] = [
  { role: "USER", text: "Which seed healthtech companies fit my mandate?" },
  {
    role: "Q",
    text: "Clinicrest fits best: clinic software in Nairobi, raising a seed round.",
  },
];

export const NAVIGATION_INTENT_CASES: readonly NavigationIntentCase[] = [
  // GO: asked to be taken somewhere, however said.
  {
    id: "go-01 take me",
    said: "Take me to my pipeline",
    recent: [],
    expected: { mode: "GO" },
  },
  {
    id: "go-02 open a record",
    said: "Open Clinicrest",
    recent: CLINICREST_SHOWN,
    expected: { mode: "GO" },
  },
  {
    id: "go-03 bring up",
    said: "Can you bring up my documents?",
    recent: [],
    expected: { mode: "GO" },
  },
  {
    id: "go-04 pidgin",
    said: "abeg carry me go my documents",
    recent: [],
    expected: { mode: "GO" },
  },
  {
    id: "go-05 spanish",
    said: "Llévame a Descubrir, por favor",
    recent: [],
    expected: { mode: "GO" },
  },
  {
    id: "go-06 french",
    said: "Emmène-moi à mes relations",
    recent: [],
    expected: { mode: "GO" },
  },
  {
    id: "go-07 spoken",
    said: "uh yeah so like pull up ledgerline's page for me",
    recent: [],
    modality: "VOICE",
    expected: { mode: "GO" },
  },
  {
    id: "go-08 multi-part",
    said: "Open Clinicrest and tell me its stage",
    recent: CLINICREST_SHOWN,
    expected: { mode: "GO", multiPart: true },
  },
  // OFFER_ONLY: what one of their own screens holds, not asked to go.
  {
    id: "offer-01 show me my pipeline",
    said: "Show me my pipeline",
    recent: [],
    expected: { mode: "OFFER_ONLY" },
  },
  {
    id: "offer-02 what's in",
    said: "What's in my data room?",
    recent: [],
    expected: { mode: "OFFER_ONLY" },
  },
  {
    id: "offer-03 where's",
    said: "Where's my pipeline?",
    recent: [],
    expected: { mode: "OFFER_ONLY" },
  },
  {
    id: "offer-04 saved list",
    said: "What's on my saved list?",
    recent: [],
    expected: { mode: "OFFER_ONLY" },
  },
  // NONE: no navigation asked or implied, even where a page shows it.
  {
    id: "none-01 chart (live)",
    said: "How has Ledgerline's monthly recurring revenue moved since June? Let me see it visually.",
    recent: [],
    expected: { mode: "NONE" },
  },
  {
    id: "none-02 same for (live)",
    said: "Now do the same for Silo Credit.",
    recent: LEDGERLINE_CHART,
    expected: { mode: "NONE" },
  },
  {
    id: "none-03 stage (live)",
    said: "What stage is Ledgerline at?",
    recent: LEDGERLINE_CHART,
    expected: { mode: "NONE" },
  },
  {
    id: "none-04 comparison",
    said: "Compare Ledgerline and Clinicrest on burn and runway",
    recent: [],
    expected: { mode: "NONE" },
  },
  {
    id: "none-05 analysis",
    said: "Is Ledgerline's burn sustainable?",
    recent: [],
    expected: { mode: "NONE" },
  },
  {
    id: "none-06 show me companies",
    said: "Show me three fintech companies in Lagos",
    recent: [],
    expected: { mode: "NONE" },
  },
  {
    id: "none-07 thanks",
    said: "Thanks, that's really helpful",
    recent: LEDGERLINE_CHART,
    expected: { mode: "NONE" },
  },
  // Negated: they said not to go anywhere.
  {
    id: "neg-01 don't open it",
    said: "Don't open it, just tell me its stage",
    recent: CLINICREST_SHOWN,
    expected: { mode: "NONE", negated: true },
  },
  {
    id: "neg-02 no need to take me",
    said: "No need to take me to the pipeline, just summarise it here",
    recent: [],
    expected: { mode: "NONE", negated: true },
  },
];

/** The reading's navigation intent and parts, as the grader sees them. */
export type NavigationIntentReading = {
  readonly navigation?:
    { readonly mode: string; readonly negated: boolean } | null | undefined;
  readonly parts?: readonly unknown[] | undefined;
};

/** True when the reading carries the expected intent; why not otherwise. */
export function gradeNavigationIntent(
  expected: NavigationIntentExpected,
  reading: NavigationIntentReading | null,
): true | string {
  if (reading === null) return "not read";
  const navigation = reading.navigation ?? null;
  if (navigation === null) return "no navigation read";
  if (navigation.mode !== expected.mode) return `mode ${navigation.mode}`;
  if (navigation.negated !== (expected.negated ?? false)) {
    return `negated ${String(navigation.negated)}`;
  }
  if (expected.multiPart === true && (reading.parts?.length ?? 0) < 2) {
    return `parts ${String(reading.parts?.length ?? 0)}`;
  }
  return true;
}
