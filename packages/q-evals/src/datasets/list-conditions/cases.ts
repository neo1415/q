/**
 * Audit 2026-11-15, RC2: ranked-list questions with a stated condition, for
 * TURN_READER v89's `question.listConditions`. The live turns from the
 * audit (investor and founder), paraphrases, a spoken and two non-English
 * phrasings, and negatives that state no condition, each with what a
 * correct reading carries. Graded by code (test/list-conditions.test.ts
 * offline), never by a model. Synthetic, fictional names only. Which items
 * meet a condition is never the reading's: code reads the records.
 */

type Conditions = {
  readonly relationship?: "EXCLUDE_IN_CONTACT" | "ONLY_IN_CONTACT" | null;
  readonly revenue?: "HAS_REVENUE" | "PRE_REVENUE" | null;
  readonly sector?: "INSIDE" | "OUTSIDE" | null;
  readonly stage?: "INSIDE" | "OUTSIDE" | null;
  readonly geography?: "INSIDE" | "OUTSIDE" | null;
  readonly order?: "BEST_FIRST" | "WORST_FIRST";
};

export type ListConditionsCase = {
  readonly id: string;
  readonly side: "INVESTOR" | "FOUNDER";
  readonly said: string;
  readonly modality?: "VOICE" | "TEXT" | undefined;
  readonly expected: {
    readonly kinds: readonly (
      "FIT" | "DISCOVER_COMPANIES" | "INVESTOR_PROSPECTS"
    )[];
    /** Every field a correct reading must carry; fields not named are null (order BEST_FIRST). */
    readonly conditions: Conditions | null;
  };
};

const COMPANIES: ListConditionsCase["expected"]["kinds"] = [
  "FIT",
  "DISCOVER_COMPANIES",
];
const INVESTORS: ListConditionsCase["expected"]["kinds"] = [
  "INVESTOR_PROSPECTS",
  "FIT",
];

export const LIST_CONDITIONS_CASES: readonly ListConditionsCase[] = [
  {
    id: "live-inv-01 e8d59713",
    side: "INVESTOR",
    said: "Okay, Um, show me the ones with actual revenue",
    modality: "VOICE",
    expected: { kinds: COMPANIES, conditions: { revenue: "HAS_REVENUE" } },
  },
  {
    id: "live-inv-02 81dea17d",
    side: "INVESTOR",
    said: "Now, show me businesses that are pre-revenue, but have unusually strong reasons to be interesting",
    modality: "VOICE",
    expected: { kinds: COMPANIES, conditions: { revenue: "PRE_REVENUE" } },
  },
  {
    id: "live-inv-03 30d18535",
    side: "INVESTOR",
    said: "Are there any promising opportunities outside my preferred sectors that are worth a look, keep them separate from my normal matches",
    modality: "VOICE",
    expected: { kinds: COMPANIES, conditions: { sector: "OUTSIDE" } },
  },
  {
    id: "live-fdr-01 F7-13 b96a8f07",
    side: "FOUNDER",
    said: "Find my strongest opportunities and leave out companies I'm already talking to",
    modality: "VOICE",
    expected: {
      kinds: INVESTORS,
      conditions: { relationship: "EXCLUDE_IN_CONTACT" },
    },
  },
  {
    id: "live-fdr-02 F7-09 83802d51",
    side: "FOUNDER",
    said: "Which ones would be poor fits even if they have a lot of money",
    modality: "VOICE",
    expected: { kinds: INVESTORS, conditions: { order: "WORST_FIRST" } },
  },
  {
    id: "para-inv-01 stage outside",
    side: "INVESTOR",
    said: "Anything good at a stage I don't usually invest in?",
    expected: { kinds: COMPANIES, conditions: { stage: "OUTSIDE" } },
  },
  {
    id: "para-inv-02 weakest",
    side: "INVESTOR",
    said: "Which of my matches are the weakest fits?",
    expected: { kinds: COMPANIES, conditions: { order: "WORST_FIRST" } },
  },
  {
    id: "para-fdr-01 only talking to",
    side: "FOUNDER",
    said: "Of the investors I'm already talking to, which fit best?",
    expected: {
      kinds: INVESTORS,
      conditions: { relationship: "ONLY_IN_CONTACT" },
    },
  },
  {
    id: "spanish-01 revenue",
    side: "INVESTOR",
    said: "Muéstrame solo las empresas que ya facturan",
    expected: { kinds: COMPANIES, conditions: { revenue: "HAS_REVENUE" } },
  },
  {
    id: "french-01 outside regions",
    side: "INVESTOR",
    said: "Des entreprises intéressantes hors de mes régions ?",
    expected: { kinds: COMPANIES, conditions: { geography: "OUTSIDE" } },
  },
  // Negatives: a plain ranking, or a named filter that is discover's.
  {
    id: "neg-01 plain fit",
    side: "INVESTOR",
    said: "What are the strongest fits for my mandate?",
    expected: { kinds: COMPANIES, conditions: null },
  },
  {
    id: "neg-02 named sector stays discover's",
    side: "INVESTOR",
    said: "Show me fintech companies in Kenya",
    expected: { kinds: COMPANIES, conditions: null },
  },
  {
    id: "neg-03 founder plain",
    side: "FOUNDER",
    said: "Which investors should I talk to first?",
    expected: { kinds: INVESTORS, conditions: null },
  },
];

export type ListConditionsReading = {
  readonly question: {
    readonly kind: string;
    readonly listConditions?: Readonly<Record<string, unknown>> | null;
  } | null;
};

const FIELDS = [
  "relationship",
  "revenue",
  "sector",
  "stage",
  "geography",
] as const;

/** A read value as text for a grading message; the model's output is unknown. */
function describeValue(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value ?? null) ?? "null";
}

/** True when the reading carries exactly the expected conditions; else why not. */
export function gradeListConditions(
  expected: ListConditionsCase["expected"],
  reading: ListConditionsReading | null,
): true | string {
  if (reading === null) return "not read";
  const question = reading.question;
  if (question === null) return "no question read";
  if (!(expected.kinds as readonly string[]).includes(question.kind)) {
    return `kind ${question.kind}`;
  }
  const got = question.listConditions ?? null;
  const want = expected.conditions;
  const active = (record: Readonly<Record<string, unknown>> | null) =>
    record !== null &&
    (FIELDS.some((field) => (record[field] ?? null) !== null) ||
      record["order"] === "WORST_FIRST");
  if (want === null) {
    return active(got) ? "a condition nobody stated" : true;
  }
  if (got === null) return "no conditions read";
  for (const field of FIELDS) {
    const expectedValue = want[field] ?? null;
    if ((got[field] ?? null) !== expectedValue) {
      return `${field} ${describeValue(got[field])}`;
    }
  }
  const order = got["order"] ?? "BEST_FIRST";
  if (order !== (want.order ?? "BEST_FIRST")) {
    return `order ${describeValue(order)}`;
  }
  return true;
}
