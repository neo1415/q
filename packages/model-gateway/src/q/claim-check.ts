/**
 * Claim check (Q Intelligence Plan, step 6): no invented figure or entity
 * reaches the screen or the voice.
 *
 * Deterministic, no model. Every figure (number, money with its currency,
 * percentage), every date and every named company or person a drafted
 * sentence states is matched against what this run was given: the
 * authorised facts, the conversation's own turns and this run's tool
 * results (together, the "corpus"). A sentence carrying a claim found in
 * none of them is not published as written:
 *
 * - when it is about a metric we can name ("ARR", "runway"), it becomes
 *   an honest unknown, once per metric per answer ("I don't have a
 *   sourced figure for ARR yet.");
 * - otherwise it is removed.
 *
 * Never the reverse: absence is never turned into zero or into a negative
 * (CLAUDE.md "unknown stays unknown"). The rewrite says only that the
 * figure is not in what Q holds.
 *
 * Matching is by value, so units and formats do not matter: "$1.2M",
 * "1.2m", "1,200,000" and "1.2 million" are one value. A rounded figure
 * matches the source it rounds ("about $1.2M" for 1,234,000). Simple
 * derived arithmetic (sum, difference, ratio, percentage, growth) is
 * allowed only when both inputs are present together: in the same sentence
 * or the same line of one source. Bounding it that way keeps a corpus of
 * a few hundred numbers from "deriving" any figure at all.
 *
 * What is logged is the kind of each ungrounded claim, never its value: a
 * figure the model wrote may itself be private (a founder's burn) or may
 * echo one.
 */

export type ClaimKind = "NUMBER" | "MONEY" | "PERCENT" | "DATE" | "NAME";

/** One checkable claim in a sentence. */
export interface Claim {
  readonly kind: ClaimKind;
  /** The literal text, for tests only; never logged. */
  readonly text: string;
  /** The value as a number; NaN for a name. */
  readonly value: number;
  /** Significant digits stated, which sets the rounding a match allows. */
  readonly precision: number;
  /** ISO-4217-ish code where the text names one ("USD", "NGN"). */
  readonly currency: string | null;
}

interface SourceNumber {
  readonly value: number;
  readonly currency: string | null;
}

/** What a run holds, prepared once for many sentences. */
export interface ClaimCorpus {
  readonly numbers: readonly SourceNumber[];
  /** Each source line's own numbers, the only pairs derivations may use. */
  readonly lines: readonly (readonly number[])[];
  /** Lower-cased, whitespace- and apostrophe-normalised source text. */
  readonly text: string;
  /** Year-month(-day) keys of every date a source states. */
  readonly dates: ReadonlySet<string>;
  /** Words the sources write in lower case: ordinary words, not names. */
  readonly ordinary: ReadonlySet<string>;
}

export interface SentenceCheck {
  /** The sentence to publish, or null when nothing of it may be said. */
  readonly text: string | null;
  /** The kinds of the claims that were not grounded; values withheld. */
  readonly ungrounded: readonly ClaimKind[];
}

const CURRENCY_SIGNS: Readonly<Record<string, string>> = {
  $: "USD",
  "€": "EUR",
  "£": "GBP",
  "₦": "NGN",
  "¥": "JPY",
  "₹": "INR",
  "₵": "GHS",
};
const CURRENCY_CODES =
  "USD|EUR|GBP|NGN|KES|ZAR|GHS|EGP|MAD|RWF|UGX|TZS|XOF|XAF|JPY|INR|CAD|AUD|CHF|AED|SAR|CNY";
const SCALES: Readonly<Record<string, number>> = {
  k: 1e3,
  thousand: 1e3,
  m: 1e6,
  mm: 1e6,
  mn: 1e6,
  million: 1e6,
  b: 1e9,
  bn: 1e9,
  billion: 1e9,
  t: 1e12,
  tn: 1e12,
  trillion: 1e12,
};

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
] as const;
const MONTH_INDEX = new Map<string, number>(
  MONTHS.flatMap((name, index) => [
    [name, index + 1],
    [name.slice(0, 3), index + 1],
  ]),
);
MONTH_INDEX.set("sept", 9);

/**
 * One figure: optional currency (sign or code) before, the digits, an
 * optional scale word, an optional percent sign or currency code after.
 * Not inside a word or an identifier ("B2B", "Q3", "F12", "v2.1").
 */
const FIGURE = new RegExp(
  String.raw`(?<![\p{L}\p{N}_.\/-])` +
    String.raw`(?:(?<sign>[$€£₦¥₹₵])|(?<pre>${CURRENCY_CODES})\s?)?` +
    String.raw`(?<int>\d{1,3}(?:,\d{3})+|\d+)(?:\.(?<frac>\d+))?` +
    String.raw`(?:\s?(?<scale>k|mm|mn|m|bn|b|tn|t|thousand|million|billion|trillion)(?![\p{L}]))?` +
    String.raw`(?:\s?(?<pct>%|percent\b|per\s?cent\b)|\s(?<post>${CURRENCY_CODES})\b)?` +
    String.raw`(?![\p{L}\p{N}_]|\.\d|:\d)`,
  "giu",
);

/** "12 March 2024", "March 12, 2024", "March 2024", "2024-03-12". */
const DATE_PATTERNS: readonly RegExp[] = [
  /\b(?<d>\d{1,2})(?:st|nd|rd|th)?\s+(?<m>[A-Za-z]{3,9})\.?,?\s+(?<y>(?:19|20)\d{2})\b/gu,
  /\b(?<m>[A-Za-z]{3,9})\.?\s+(?<d>\d{1,2})(?:st|nd|rd|th)?,?\s+(?<y>(?:19|20)\d{2})\b/gu,
  /\b(?<m>[A-Za-z]{3,9})\.?,?\s+(?<y>(?:19|20)\d{2})\b/gu,
  /\b(?<y>(?:19|20)\d{2})-(?<mn>\d{2})(?:-(?<d>\d{2}))?\b/gu,
];

/** Words that make a figure a span of planning, not a stated fact. */
const PLANNING_BEFORE =
  /\b(?:next|within|over|every|per|each|past|last|first|in|for|about|around|up to)\s+(?:the\s+)?(?:next\s+|past\s+|last\s+|first\s+)?$/iu;
/** "top 10", "the first 5": a size of list, not a fact. */
const RANK_BEFORE = /\b(?:top|first|bottom)\s+$/iu;
const DURATION_AFTER =
  /^\s*-?\s*(?:minutes?|mins?|hours?|hrs?|days?|weeks?|months?|years?|yrs?|seconds?|secs?|s|ms)\b/iu;
const TIME_AFTER = /^\s*(?:am|pm|a\.m\.|p\.m\.)/iu;

function scaleOf(word: string | undefined): number {
  if (word === undefined) return 1;
  return SCALES[word.toLowerCase()] ?? 1;
}

function significantDigits(intPart: string, frac: string): number {
  const digits = `${intPart}${frac}`.replace(/^0+/u, "");
  const trimmed = frac.length > 0 ? digits : digits.replace(/0+$/u, "");
  return Math.max(1, trimmed.length);
}

interface Figure extends Claim {
  readonly index: number;
  readonly end: number;
}

function figuresIn(text: string): Figure[] {
  const found: Figure[] = [];
  for (const match of text.matchAll(FIGURE)) {
    const groups = match.groups ?? {};
    const intPart = (groups["int"] ?? "").replace(/,/gu, "");
    const frac = groups["frac"] ?? "";
    const scale = scaleOf(groups["scale"]);
    const value = Number(`${intPart}${frac.length > 0 ? `.${frac}` : ""}`);
    if (!Number.isFinite(value)) continue;
    const sign = groups["sign"];
    const code = groups["pre"] ?? groups["post"];
    const currency =
      sign !== undefined
        ? (CURRENCY_SIGNS[sign] ?? null)
        : code !== undefined
          ? code.toUpperCase()
          : null;
    const percent = groups["pct"] !== undefined;
    const index = match.index;
    found.push({
      kind: currency !== null ? "MONEY" : percent ? "PERCENT" : "NUMBER",
      text: match[0],
      value: value * scale,
      precision: Math.max(
        significantDigits(intPart, frac),
        // "1.2m" states two digits whatever the zeros the scale adds.
        scale > 1 ? 1 : 0,
      ),
      currency,
      index,
      end: index + match[0].length,
    });
  }
  return found;
}

/** A figure that states no checkable fact: a list position, a time, a span. */
function isIncidental(sentence: string, figure: Figure): boolean {
  if (figure.kind !== "NUMBER") return false;
  const literal = figure.text.trim();
  // A lone digit (a list position, "one of 3").
  if (/^\d$/u.test(literal)) return true;
  const before = sentence.slice(0, figure.index);
  const after = sentence.slice(figure.end);
  // "3pm", "10:30".
  if (TIME_AFTER.test(after)) return true;
  // "top 10".
  if (RANK_BEFORE.test(before)) return true;
  // "over the next 12 months", "within 30 days" -- a span of planning;
  // "a runway of 18 months" is still checked.
  if (PLANNING_BEFORE.test(before) && DURATION_AFTER.test(after)) return true;
  // A list item's own number ("2.", "3)").
  if (/^[.)]\s/u.test(after) && /(?:^|\n)\s*$/u.test(before)) return true;
  return false;
}

function dateKeysIn(text: string): { key: string; year: number }[] {
  const keys: { key: string; year: number }[] = [];
  for (const pattern of DATE_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const groups = match.groups ?? {};
      const year = Number(groups["y"]);
      const month =
        groups["mn"] !== undefined
          ? Number(groups["mn"])
          : MONTH_INDEX.get((groups["m"] ?? "").toLowerCase());
      if (month === undefined || month < 1 || month > 12) continue;
      const day = groups["d"] === undefined ? null : Number(groups["d"]);
      const ym = `${String(year)}-${String(month).padStart(2, "0")}`;
      keys.push({ key: ym, year });
      if (day !== null && day >= 1 && day <= 31) {
        keys.push({ key: `${ym}-${String(day).padStart(2, "0")}`, year });
      }
    }
  }
  return keys;
}

function normaliseText(text: string): string {
  return text.toLowerCase().replace(/[’‘`]/gu, "'").replace(/\s+/gu, " ");
}

/** The length of every list in a JSON source; nothing for prose. */
function listLengths(source: string): number[] {
  const trimmed = source.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return [];
  }
  const lengths: number[] = [];
  const visit = (value: unknown, depth: number): void => {
    if (depth > 6 || value === null || typeof value !== "object") return;
    if (Array.isArray(value)) {
      if (value.length >= 2) lengths.push(value.length);
      for (const item of value) visit(item, depth + 1);
      return;
    }
    for (const item of Object.values(value)) visit(item, depth + 1);
  };
  visit(parsed, 0);
  return lengths;
}

/**
 * Prepare a run's sources once. `today` is grounded too: "this year" and
 * today's date are not claims anyone invented.
 */
export function claimCorpus(
  sources: readonly string[],
  today: Date = new Date(),
): ClaimCorpus {
  const numbers: SourceNumber[] = [];
  const lines: number[][] = [];
  const dates = new Set<string>();
  const ordinary = new Set<string>();
  const iso = today.toISOString().slice(0, 10);
  const all = [...sources, iso];
  for (const source of all) {
    // A count of records a tool returned ("you've reached out to 20
    // companies") is the length of a list it holds.
    for (const length of listLengths(source)) {
      numbers.push({ value: length, currency: null });
    }
    for (const line of source.split(/\n|(?<=[.;!?])\s+(?=[A-Z])/u)) {
      const own = figuresIn(line);
      for (const figure of own) {
        numbers.push({ value: figure.value, currency: figure.currency });
      }
      // Bounded: a line listing dozens of numbers (a table dump) adds its
      // values but not its pairs.
      if (own.length >= 2 && own.length <= 12) {
        lines.push(own.map((figure) => figure.value));
      }
      for (const { key } of dateKeysIn(line)) {
        dates.add(key);
        // A date's day and month ground "22 November" said without a year.
        for (const part of key.split("-").slice(1)) {
          numbers.push({ value: Number(part), currency: null });
        }
      }
      for (const word of line.match(/(?<![\p{L}])[\p{Ll}][\p{L}'-]*/gu) ?? []) {
        ordinary.add(word);
      }
    }
  }
  return {
    numbers,
    lines,
    text: normaliseText(all.join("\n")),
    dates,
    ordinary,
  };
}

/** Does `source` round to `claim` at the claim's stated precision? */
function roundsTo(claim: number, precision: number, source: number): boolean {
  if (claim === source) return true;
  if (claim === 0 || source === 0) return false;
  const digits = Math.max(2, precision);
  const magnitude = Math.floor(Math.log10(Math.abs(claim)));
  const step = 10 ** (magnitude - digits + 1);
  const rounded = Math.round(source / step) * step;
  return Math.abs(rounded - claim) <= step * 1e-6;
}

function derivedFrom(values: readonly number[]): number[] {
  const out: number[] = [];
  for (const a of values) {
    for (const b of values) {
      if (a === b) continue;
      out.push(a + b, a - b, Math.abs(a - b));
      if (b !== 0) {
        out.push(a / b, (a / b) * 100, ((a - b) / b) * 100);
        out.push(Math.abs(((a - b) / b) * 100));
      }
      out.push((a * b) / 100, a * b);
    }
  }
  return out;
}

function figureGrounded(
  figure: Claim,
  corpus: ClaimCorpus,
  sameSentence: readonly number[],
): boolean {
  const direct = corpus.numbers.some(
    (source) =>
      roundsTo(figure.value, figure.precision, source.value) &&
      (figure.currency === null ||
        source.currency === null ||
        source.currency === figure.currency),
  );
  if (direct) return true;
  // A year said as itself ("in 2024").
  if (
    figure.kind === "NUMBER" &&
    Number.isInteger(figure.value) &&
    figure.value >= 1900 &&
    figure.value <= 2100 &&
    [...corpus.dates].some((key) => key.startsWith(String(figure.value)))
  ) {
    return true;
  }
  // Derived: both inputs present together, in one source line or in this
  // sentence's own grounded figures.
  const pools = [...corpus.lines, sameSentence];
  return pools.some(
    (pool) =>
      pool.length >= 2 &&
      derivedFrom(pool).some((value) =>
        roundsTo(figure.value, figure.precision, value),
      ),
  );
}

// --- Names -------------------------------------------------------------

/**
 * Capital Q's own vocabulary and places: a capitalised phrase that names
 * no company or person anyone could have invented.
 */
const KNOWN_PHRASES = new Set(
  [
    "capital q",
    "gate q",
    "gateq",
    "q pitch",
    "q card",
    "q dock",
    "q daily",
    "data room",
    "express interest",
    "google meet",
    "google calendar",
    "google docs",
    "microsoft teams",
    "power point",
    "investiq",
    "south africa",
    "north africa",
    "west africa",
    "east africa",
    "sub saharan africa",
    "sub-saharan africa",
    "united states",
    "united kingdom",
    "united arab emirates",
    "new york",
    "san francisco",
    "silicon valley",
    "hong kong",
    "saudi arabia",
    "middle east",
    "latin america",
    "north america",
    "south america",
    "european union",
    "ivory coast",
    "cote d'ivoire",
    "sierra leone",
    "costa rica",
    "new zealand",
  ].map(normaliseText),
);

/** Words that begin no name: "The Acme team" names "Acme". */
const FUNCTION_WORDS = new Set(
  (
    "a an the this that these those it its i we you they he she my our your their his her " +
    "and but or so as if when while where what which who why how here there yes no not " +
    "in on at for with from by to of into over under about after before during based given " +
    "however also overall finally then " +
    "shall will can could would should may might must do does did is are was were be been " +
    "has have had let please want need see consider ask check open compare book send"
  ).split(/\s+/u),
);

/** Capitalised words that never begin or make up a name on their own. */
const NOT_NAME_WORDS = new Set(
  (
    "a an the this that these those it its i we you they he she my our your their his her " +
    "and but or so as if when while where what which who why how here there yes no not " +
    "in on at for with from by to of into over under about after before during based given " +
    "q note key next step steps summary overview risks risk gaps gap strengths strength " +
    "however also overall finally first second third then today tomorrow yesterday " +
    "monday tuesday wednesday thursday friday saturday sunday " +
    MONTHS.join(" ") +
    " series seed pre round gross net revenue growth margin total addressable market " +
    "due diligence team product traction financials fit readiness evidence investor investors " +
    "founder founders company companies mandate sector stage ticket size business model unit " +
    "economics customer customers annual recurring monthly burn runway valuation raise " +
    "verified unknown estimate claim inference source sources profile discover board stage " +
    "ai saas fintech healthtech agritech edtech ceo cto cfo coo vp md gp lp ic esg kpi " +
    "arr mrr gmv cac ltv nrr irr moic tam sam som ebitda yoy mom qoq pdf ok"
  ).split(/\s+/u),
);

const CORPORATE_SUFFIX =
  /\s+(?:inc|inc\.|ltd|ltd\.|llc|plc|limited|corp|corp\.|co|co\.|group|holdings|gmbh|sa|ag|bv)$/iu;

const CAPITALISED = /^[\p{Lu}][\p{L}\p{M}'’&.-]*$/u;
// Not "and": "Souqsheet and Maji Loop" is a list of two names.
const CONNECTOR = /^(?:of|&|de|da|van|von|bin|al)$/u;

function cleanToken(token: string): string {
  return token.replace(/^[("'“‘*_[]+|[)"'”’*_\],:;!?.]+$/gu, "");
}

/**
 * Runs of two or more capitalised words ("Yamfield Agro", "Jane Doe",
 * "Bank of America") that are not all ordinary words. One capitalised word
 * alone is not checked: a sentence's first word, an acronym and a product
 * term look the same as a one-word name, and removing a true sentence is
 * worse than letting a one-word name through.
 */
function namesIn(sentence: string): string[] {
  // A heading is a label, not a claim.
  if (/^\s*#/u.test(sentence)) return [];
  const raw = sentence.split(/\s+/u);
  const names: string[] = [];
  let run: string[] = [];
  const flush = (): void => {
    while (run.length > 0 && CONNECTOR.test(run[run.length - 1] ?? "")) {
      run.pop();
    }
    const meaningful = run.filter(
      (word) =>
        !CONNECTOR.test(word) &&
        !NOT_NAME_WORDS.has(word.toLowerCase().replace(/['’]s$/u, "")),
    );
    if (run.length >= 2 && meaningful.length >= 1) {
      names.push(run.join(" ").replace(/['’]s$/u, ""));
    }
    run = [];
  };
  for (const said of raw) {
    const token = cleanToken(said);
    const bare = token.replace(/['’]s$/u, "");
    const possessive = bare !== token;
    if (bare.length > 0 && CAPITALISED.test(bare)) {
      // A function word is part of no name: "The Acme team" is "Acme",
      // and "Shall I" is no one.
      if (FUNCTION_WORDS.has(bare.toLowerCase())) flush();
      else run.push(bare);
    } else if (run.length > 0 && CONNECTOR.test(token)) {
      run.push(token);
    } else {
      flush();
    }
    // A possessive, a sentence boundary or clause punctuation ends a name:
    // "Northwind's ARR" names Northwind.
    if (possessive) flush();
    else if (/[,;:!?.)"”]$/u.test(said) && !/\b[A-Z]\.$/u.test(said)) {
      flush();
    }
  }
  flush();
  return names;
}

function nameGrounded(name: string, corpus: ClaimCorpus): boolean {
  const normal = normaliseText(name);
  if (KNOWN_PHRASES.has(normal)) return true;
  if (corpus.text.includes(normal)) return true;
  const stripped = normal.replace(CORPORATE_SUFFIX, "");
  if (stripped !== normal && corpus.text.includes(stripped)) return true;
  // Every word is ordinary vocabulary -- ours, or a word the sources
  // write in lower case: a title-cased label ("Strong Revenue Growth"),
  // not a name.
  const words = normal.split(" ").filter((word) => !CONNECTOR.test(word));
  return words.every(
    (word) =>
      NOT_NAME_WORDS.has(word) ||
      KNOWN_PHRASES.has(word) ||
      corpus.ordinary.has(word),
  );
}

// --- Claims and the sentence check -------------------------------------

/** Every checkable claim in one sentence. */
export function extractClaims(sentence: string): Claim[] {
  const dateSpans = dateKeysIn(sentence);
  const claims: Claim[] = figuresIn(sentence)
    .filter((figure) => !isIncidental(sentence, figure))
    .map((figure) => {
      const isYear =
        figure.kind === "NUMBER" &&
        Number.isInteger(figure.value) &&
        figure.value >= 1900 &&
        figure.value <= 2100 &&
        /^\d{4}$/u.test(figure.text.trim());
      return isYear ? { ...figure, kind: "DATE" as const } : figure;
    });
  for (const { key } of dateSpans) {
    claims.push({
      kind: "DATE",
      text: key,
      value: Number.NaN,
      precision: 0,
      currency: null,
    });
  }
  for (const name of namesIn(sentence)) {
    claims.push({
      kind: "NAME",
      text: name,
      value: Number.NaN,
      precision: 0,
      currency: null,
    });
  }
  return claims;
}

/** The metric a sentence is about, for its honest-unknown rewrite. */
const METRICS: readonly (readonly [RegExp, string])[] = [
  [/\bARR\b|annual recurring revenue/iu, "ARR"],
  [/\bMRR\b|monthly recurring revenue/iu, "MRR"],
  [/\bGMV\b/iu, "GMV"],
  [/\brunway\b/iu, "runway"],
  [/\bburn\b/iu, "burn"],
  [/\bvaluation\b|\bvalued at\b/iu, "valuation"],
  [/\b(?:raising|raise|round size|ticket)\b/iu, "the raise"],
  [/\bgross margin\b|\bmargins?\b/iu, "margin"],
  [/\brevenue\b|\bsales\b/iu, "revenue"],
  [/\bgrowth\b|\bgrew\b|\bgrowing\b/iu, "growth"],
  [/\bcustomers?\b|\bclients?\b/iu, "customer numbers"],
  [/\busers?\b/iu, "user numbers"],
  [/\bheadcount\b|\bemployees\b|\bstaff\b/iu, "headcount"],
  [/\bchurn\b|\bretention\b/iu, "retention"],
  [/\bcac\b|\bltv\b/iu, "unit economics"],
];

function metricOf(sentence: string): string | null {
  for (const [pattern, label] of METRICS) {
    if (pattern.test(sentence)) return label;
  }
  return null;
}

/**
 * Check one sentence against the corpus. `said` holds the metrics already
 * said to be unknown in this answer, so the honest unknown is said once.
 */
export function checkSentence(
  sentence: string,
  corpus: ClaimCorpus,
  said: Set<string> = new Set(),
): SentenceCheck {
  const claims = extractClaims(sentence);
  if (claims.length === 0) return { text: sentence, ungrounded: [] };
  const figures = claims.filter(
    (claim) =>
      claim.kind === "NUMBER" ||
      claim.kind === "MONEY" ||
      claim.kind === "PERCENT" ||
      (claim.kind === "DATE" && Number.isFinite(claim.value)),
  );
  const groundedValues = figures
    .filter((figure) => figureGrounded(figure, corpus, []))
    .map((figure) => figure.value);
  const ungrounded: ClaimKind[] = [];
  for (const claim of claims) {
    const ok =
      claim.kind === "NAME"
        ? nameGrounded(claim.text, corpus)
        : Number.isFinite(claim.value)
          ? figureGrounded(claim, corpus, groundedValues)
          : corpus.dates.has(claim.text) ||
            // A month without a day matches a source with that day.
            [...corpus.dates].some((key) => key.startsWith(`${claim.text}-`));
    if (!ok) ungrounded.push(claim.kind);
  }
  if (ungrounded.length === 0) return { text: sentence, ungrounded };
  // A name we cannot ground is removed; a figure becomes an honest unknown
  // about its metric when there is one, said once.
  const metric = ungrounded.includes("NAME") ? null : metricOf(sentence);
  if (metric === null || said.has(metric)) return { text: null, ungrounded };
  said.add(metric);
  return {
    text: `I don't have a sourced figure for ${metric} yet.`,
    ungrounded,
  };
}

/** Said when nothing of an answer could be grounded; states no fact. */
export const NOTHING_SOURCED =
  "I don't have a sourced answer to that in what I can see yet.";

/** A claim check for one answer: the streamed sentences and its stored text. */
export interface ClaimChecker {
  sentence(sentence: string): SentenceCheck;
}

/**
 * One answer's checker. `sources` is read on each sentence, because a tool
 * round adds its results between sentences of a long turn; the corpus is
 * rebuilt only when what it returns has changed.
 */
export function createClaimChecker(
  sources: () => readonly string[],
  today: Date = new Date(),
): ClaimChecker {
  let key: readonly string[] | null = null;
  let corpus: ClaimCorpus | null = null;
  const said = new Set<string>();
  const current = (): ClaimCorpus => {
    const now = sources();
    if (
      corpus === null ||
      key === null ||
      key.length !== now.length ||
      key.some((source, index) => source !== now[index])
    ) {
      key = [...now];
      corpus = claimCorpus(now, today);
    }
    return corpus;
  };
  return {
    sentence: (sentence) => checkSentence(sentence, current(), said),
  };
}

/**
 * A whole answer, sentence by sentence, keeping its line breaks. The
 * stored answer goes through the same check the streamed one did, so the
 * screen never shows what the voice was kept from saying.
 */
export function checkAnswer(
  answer: string,
  corpus: ClaimCorpus,
): { readonly text: string; readonly ungrounded: readonly ClaimKind[] } {
  const said = new Set<string>();
  const ungrounded: ClaimKind[] = [];
  const lines = answer.split("\n").map((line) => {
    if (line.trim().length === 0) return line;
    const lead = /^\s*(?:[-*•]|\d+[.)])\s+/u.exec(line)?.[0] ?? "";
    const body = line.slice(lead.length);
    const sentences = body.split(/(?<=[.!?])\s+(?=[\p{Lu}\d"“(*])/u);
    const kept: string[] = [];
    for (const sentence of sentences) {
      const checked = checkSentence(sentence, corpus, said);
      ungrounded.push(...checked.ungrounded);
      if (checked.text !== null) kept.push(checked.text);
    }
    return kept.length === 0 ? null : `${lead}${kept.join(" ")}`;
  });
  const text = lines
    .filter((line): line is string => line !== null)
    .join("\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
  return {
    // Nothing of the answer was grounded: say so, rather than nothing.
    text:
      text.length === 0 && answer.trim().length > 0 ? NOTHING_SOURCED : text,
    ungrounded,
  };
}

/**
 * Every figure `text` states is grounded in `corpus`. The extras' join
 * (parallel-extras.ts) uses it for findings, the same matcher the answer's
 * sentences go through.
 */
export function figuresGrounded(text: string, corpus: ClaimCorpus): boolean {
  const figures = figuresIn(text).filter(
    (figure) => !isIncidental(text, figure),
  );
  const grounded = figures
    .filter((figure) => figureGrounded(figure, corpus, []))
    .map((figure) => figure.value);
  return figures.every((figure) => figureGrounded(figure, corpus, grounded));
}

/**
 * Every form a figure in `text` might take in another text, digits only
 * ("$1.2M" is "1.2" and "1200000"; a lone digit says nothing checkable).
 */
export function statedNumbers(text: string): readonly (readonly string[])[] {
  return figuresIn(text)
    .filter((figure) => !/^\d$/u.test(figure.text.trim()))
    .map((figure) => {
      const literal = /\d[\d,]*(?:\.\d+)?/u.exec(figure.text)?.[0] ?? "";
      const plain = literal.replace(/,/gu, "");
      const whole = String(figure.value);
      return plain === whole ? [plain] : [plain, whole];
    });
}
