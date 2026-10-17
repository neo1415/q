import type {
  ApplicationDimension,
  ApplicationFact,
  FactValue,
} from "../contracts/index.js";

/**
 * Whether an answer is decision-grade, not merely present (live 2026-10-17).
 *
 * "We have a big market" lands a fact on company.market, and until now a
 * fact on a dimension meant the dimension was done: GateQ moved on and the
 * investor read an application that said nothing they could act on. For
 * the dimensions a partner reads in numbers, an answer without one is
 * partial. It earns one follow-up asking for the specific missing element,
 * still bounded by MAX_ASKS_PER_DIMENSION, and after that what is missing
 * is reported as it stands, never pressed.
 *
 * Deterministic on purpose: the platform decides what is still missing;
 * the model only decides how to ask for it. Unknown stays unknown: "I
 * don't know" (value kind NONE) is a real answer and is never chased.
 */

const NUMBER_WORDS =
  /\b(zero|none|nil|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|dozens?|hundreds?|thousands?|millions?|billions?|trillions?|half|percent)\b/iu;
/** Saying there is nothing yet is a specific answer, not a vague one. */
const NOTHING_YET =
  /\b(pre[- ]?revenue|no (revenue|customers|users|sales)( yet)?|not (yet )?(generating|making) revenue)\b/iu;
const PERIOD =
  /\b(per|a|each|every|last|this|over the|in the) (day|week|month|quarter|year)\b|\b(daily|weekly|monthly|quarterly|yearly|annual(ly|i[sz]ed)?|mrr|arr|gmv|run[- ]?rate|ytd|to date|so far|since|fy\s?\d{2,4}|q[1-4]|20\d\d|mo|yr)\b/iu;

const hasNumber = (text: string): boolean =>
  /\d/u.test(text) || NUMBER_WORDS.test(text) || NOTHING_YET.test(text);

type Rule = (text: string) => string | null;

/**
 * What each quantitative dimension still lacks when an answer is vague,
 * phrased as the element to ask for. Never a threshold: the model is told
 * what kind of figure is missing, not what figure would be good enough.
 */
const RULES: Readonly<Partial<Record<ApplicationDimension, Rule>>> = {
  "company.market": (text) =>
    hasNumber(text)
      ? null
      : "the market size in numbers and how it was sized (TAM, SAM, SOM; bottom-up or top-down)",
  "claims.revenue": (text) => {
    if (!hasNumber(text)) {
      return "the revenue figure and the period it covers (monthly, annual run rate or to date)";
    }
    if (NOTHING_YET.test(text) || PERIOD.test(text)) return null;
    return "the period the revenue figure covers (monthly, annual run rate or to date)";
  },
  "claims.traction": (text) =>
    hasNumber(text)
      ? null
      : "the numbers behind the traction: customers or users, and growth over a stated period",
  "company.customers": (text) =>
    hasNumber(text)
      ? null
      : "how many paying customers or active users they have today",
  "raise.use_of_funds": (text) =>
    hasNumber(text)
      ? null
      : "how the round splits across uses, in amounts or percentages, and the runway it buys",
};

/** The dimensions whose answers must carry a figure to count as covered. */
export const QUANTITATIVE_DIMENSIONS: readonly ApplicationDimension[] =
  Object.keys(RULES) as ApplicationDimension[];

function textOf(value: FactValue): string | null {
  switch (value.kind) {
    case "TEXT":
      return value.text;
    case "PHRASES":
      return value.phrases.join("; ");
    // A structured amount is a figure by construction; a code is not
    // something a number is asked of; NONE is an answer, never chased.
    case "AMOUNT":
    case "CODE":
    case "NONE":
      return null;
  }
}

/**
 * What a current answer on a quantitative dimension still lacks, or null
 * when it is specific enough (or not a dimension this applies to). Any one
 * specific current fact is enough: a follow-up answer with the figure
 * covers the dimension whether or not it superseded the vague one.
 */
export function missingSpecifics(
  dimension: ApplicationDimension,
  facts: readonly ApplicationFact[],
): string | null {
  const rule = RULES[dimension];
  if (rule === undefined) return null;
  const current = facts.filter(
    (fact) => fact.dimension === dimension && fact.supersededAt === null,
  );
  if (current.length === 0) return null;
  let missing: string | null = null;
  for (const fact of current) {
    const text = textOf(fact.value);
    if (text === null) return null;
    const gap = rule(text);
    if (gap === null) return null;
    missing ??= gap;
  }
  return missing;
}

/**
 * Several ways into the same figure, so two founders are not read the
 * same script. A suggestion for the model, which still phrases the turn
 * itself and in the applicant's language.
 */
const ANGLES: Readonly<
  Partial<Record<ApplicationDimension, readonly string[]>>
> = {
  "company.market": [
    "How big is this market, in numbers?",
    "What does the opportunity look like in numbers, and how did you size it?",
    "What are your TAM, SAM and SOM, and how did you get there?",
    "If you size the market bottom-up, what do you get?",
  ],
  "claims.revenue": [
    "What is revenue today, and over what period?",
    "Where is revenue now: monthly, or annual run rate?",
    "What did you bill over the last twelve months?",
  ],
  "claims.traction": [
    "What are the numbers behind that: customers, users, growth?",
    "How fast is it growing, month on month?",
    "How many are using it today, and how has that moved this quarter?",
  ],
  "company.customers": [
    "How many customers do you have today?",
    "Who is paying you now, and how many of them?",
    "How many customers or users are live today?",
  ],
  "raise.use_of_funds": [
    "How does the round split across uses, roughly in amounts?",
    "Where does the money go, and how much to each?",
    "What does this round buy in runway and milestones?",
  ],
};

/** FNV-1a: stable across processes, so a retried turn reads the same. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * One suggested way into a quantitative dimension, chosen deterministically
 * from the application (seed) and how often it was already asked, so a
 * follow-up does not repeat the first wording. Null for other dimensions.
 */
export function questionAngle(
  dimension: ApplicationDimension,
  seed: string,
  asked: number,
): string | null {
  const angles = ANGLES[dimension];
  if (angles === undefined || angles.length === 0) return null;
  return angles[hash(`${seed}|${dimension}|${asked}`) % angles.length] ?? null;
}
