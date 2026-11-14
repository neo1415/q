/**
 * Owner live 14 Nov 2026 (run bba40261, audit D1): fit questions that leave
 * out the companies the person is already in contact with, for
 * TURN_READER v88's `question.excludeRelationships`. Paraphrases, spoken
 * and non-English phrasings and negatives, each with what a correct reading
 * carries. Graded by code (test/fit-exclusion.test.ts offline), never by a
 * model. Synthetic, fictional companies only. Which companies are excluded
 * is never the reading's: code reads their own relationships.
 */

export type FitExclusionCase = {
  readonly id: string;
  readonly said: string;
  readonly modality?: "VOICE" | "TEXT" | undefined;
  readonly expected: {
    /** The question kinds a correct reading may give. */
    readonly kinds: readonly ("FIT" | "DISCOVER_COMPANIES")[];
    readonly excludeRelationships: boolean;
  };
};

const FIT: FitExclusionCase["expected"]["kinds"] = ["FIT", "DISCOVER_COMPANIES"];

export const FIT_EXCLUSION_CASES: readonly FitExclusionCase[] = [
  {
    id: "live-01 bba40261",
    said: "Give me the strongest fits for my mandate, leaving out companies I'm already in contact with",
    expected: { kinds: FIT, excludeRelationships: true },
  },
  {
    id: "para-01 haven't reached out",
    said: "Which companies fit my mandate that I haven't reached out to yet?",
    expected: { kinds: FIT, excludeRelationships: true },
  },
  {
    id: "para-02 not my pipeline",
    said: "New names please, nothing that's already in my pipeline",
    expected: { kinds: FIT, excludeRelationships: true },
  },
  {
    id: "para-03 skip talking to",
    said: "Top five fits, skip the ones I'm already talking to",
    expected: { kinds: FIT, excludeRelationships: true },
  },
  {
    id: "voice-01 spoken",
    said: "uh what are my best matches but like not people i've already been in touch with",
    modality: "VOICE",
    expected: { kinds: FIT, excludeRelationships: true },
  },
  {
    id: "spanish-01",
    said: "¿Qué empresas encajan con mi mandato, aparte de las que ya contacté?",
    expected: { kinds: FIT, excludeRelationships: true },
  },
  {
    id: "french-01",
    said: "Les meilleures entreprises pour mon mandat, hors celles avec qui je suis déjà en contact",
    expected: { kinds: FIT, excludeRelationships: true },
  },
  // Negatives: about those companies themselves, or no exclusion at all.
  {
    id: "neg-01 rank my pipeline",
    said: "Rank my pipeline by fit with my mandate",
    expected: { kinds: FIT, excludeRelationships: false },
  },
  {
    id: "neg-02 which of those I'm talking to",
    said: "Which of the companies I'm talking to fits best?",
    expected: { kinds: FIT, excludeRelationships: false },
  },
  {
    id: "neg-03 plain fit",
    said: "What are the strongest fits for my mandate?",
    expected: { kinds: FIT, excludeRelationships: false },
  },
];

export type FitExclusionReading = {
  readonly question: {
    readonly kind: string;
    readonly excludeRelationships?: boolean | undefined;
  } | null;
};

/** True when the reading carries the expected exclusion; else why not. */
export function gradeFitExclusion(
  expected: FitExclusionCase["expected"],
  reading: FitExclusionReading | null,
): true | string {
  if (reading === null) return "not read";
  const question = reading.question;
  if (question === null) return "no question read";
  if (!(expected.kinds as readonly string[]).includes(question.kind)) {
    return `kind ${question.kind}`;
  }
  const excluded = question.excludeRelationships === true;
  if (excluded !== expected.excludeRelationships) {
    return `excludeRelationships ${String(excluded)}`;
  }
  return true;
}
