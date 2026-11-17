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

import { countryOfName } from "@capital-q/taxonomy/countries";

import { documentTables } from "./document-rows.js";

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
  /** A date's day or month: it grounds a plain number only ("22 November"). */
  readonly datePart?: true;
  /** Money or a percentage as the source wrote it; absent for a plain number. */
  readonly kind?: "MONEY" | "PERCENT";
}

/** What a figure is, for arithmetic: money, a percentage or a plain number. */
type OperandKind = "MONEY" | "PERCENT" | "NUMBER";

/** A figure an operation may take: its value, kind and currency. */
interface Operand {
  readonly value: number;
  readonly kind: OperandKind;
  readonly currency: string | null;
}

/** What a run holds, prepared once for many sentences. */
export interface ClaimCorpus {
  readonly numbers: readonly SourceNumber[];
  /**
   * Each source line's own figures: a pair from one line may ground a
   * derivation only when the sentence says one of the two itself.
   */
  readonly lines: readonly (readonly Operand[])[];
  /** Lower-cased, whitespace- and apostrophe-normalised source text. */
  readonly text: string;
  /** Year-month(-day) keys of every date a source states. */
  readonly dates: ReadonlySet<string>;
  /** Words the sources write in lower case: ordinary words, not names. */
  readonly ordinary: ReadonlySet<string>;
  /** The minutes of every clock time a source states ("56" of 08:56). */
  readonly minutes: ReadonlySet<string>;
  /**
   * Each source's lines in order, lower-cased (a JSON tool result's escaped
   * line breaks count as breaks), with Q's own earlier words taken out:
   * what a count of a named item is bound to.
   */
  readonly sourceLines: readonly (readonly string[])[];
  /**
   * Per quarter ("2027-Q1"), what each count table of the sources adds up
   * to over its rows starting then (document-rows.ts): what a count said
   * of a quarter ("5 in Q1") is bound to.
   */
  readonly periodCounts: ReadonlyMap<string, readonly number[]>;
  /**
   * Q's own earlier words (lower-cased), so a count only they name is
   * withheld: live run 434ead80 (Thames Arc, 17 Nov 2026) said "4
   * public-sector account managers" with no document read at all, from
   * recalled memory and Q's earlier replies. Empty: the rule is off.
   */
  readonly echoText: string;
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
  // Not a time's minutes ("08:56"); a JSON value ("customers":1340) is.
  String.raw`(?<![\p{L}\p{N}_.\/-])(?<!\d:)` +
    String.raw`(?:(?<sign>[$€£₦¥₹₵])|(?<pre>${CURRENCY_CODES})\s?)?` +
    String.raw`(?<int>\d{1,3}(?:,\d{3})+|\d+)(?:\.(?<frac>\d+))?` +
    String.raw`(?:\s?(?<scale>k|mm|mn|m|bn|b|tn|t|thousand|million|billion|trillion)(?![\p{L}]))?` +
    String.raw`(?:\s?(?<pct>%|percent\b|per\s?cent\b)|\s(?<post>${CURRENCY_CODES})\b)?` +
    // A multiple written "2.5x" or "3×": the figure is the multiple.
    String.raw`(?:[x×](?![\p{L}\p{N}]))?` +
    String.raw`(?![\p{L}\p{N}_]|\.\d|:\d)`,
  "giu",
);

/** "12 March 2024", "March 12, 2024", "March 2024", "2024-03-12". */
const DATE_PATTERNS: readonly RegExp[] = [
  /\b(?<d>\d{1,2})(?:st|nd|rd|th)?\s+(?<m>[A-Za-z]{3,9})\.?,?\s+(?<y>(?:19|20)\d{2})\b/gu,
  /\b(?<m>[A-Za-z]{3,9})\.?\s+(?<d>\d{1,2})(?:st|nd|rd|th)?,?\s+(?<y>(?:19|20)\d{2})\b/gu,
  /\b(?<m>[A-Za-z]{3,9})\.?,?\s+(?<y>(?:19|20)\d{2})\b/gu,
  // ISO, alone or as a timestamp's date ("2026-10-03T08:56:00Z").
  /\b(?<y>(?:19|20)\d{2})-(?<mn>\d{2})(?:-(?<d>\d{2}))?(?!\d)/gu,
];

/**
 * A clock time, "08:56" or "3:30 pm", alone or inside an ISO timestamp.
 * Its minutes are what is checked: a true time the model converted to the
 * reader's time zone keeps its minutes and changes its hour.
 */
const CLOCK_TIME =
  /(?<![\d:])(?<h>\d{1,2}):(?<m>[0-5]\d)(?::\d{2}(?:\.\d+)?)?(?!\d)/gu;

function clockMinutesIn(text: string): string[] {
  return [...text.matchAll(CLOCK_TIME)].map(
    (match) => match.groups?.["m"] ?? "",
  );
}

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
function isIncidental(
  sentence: string,
  figure: Figure,
  loneDigit = true,
): boolean {
  if (figure.kind !== "NUMBER") return false;
  const literal = figure.text.trim();
  // A lone digit (a list position, "one of 3").
  if (loneDigit && /^\d$/u.test(literal)) return true;
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
  /**
   * Q's own earlier words (its replies, its summaries of the conversation).
   * They ground a figure by value as any source does, but a count of a
   * named item is never bound to them: what Q said before is not what the
   * document says, and a wrong count repeated is still wrong.
   */
  echoes: readonly string[] = [],
  /**
   * Whether a count of an item only the echoes name is withheld (default
   * true). Off where the text checked is itself an echo (a recalled
   * summary held to the documents: summaryCorrections).
   */
  options: { readonly echoOnlyWithheld?: boolean } = {},
): ClaimCorpus {
  const numbers: SourceNumber[] = [];
  const lines: Operand[][] = [];
  const dates = new Set<string>();
  const ordinary = new Set<string>();
  const minutes = new Set<string>();
  const sourceLines: string[][] = [];
  const echoed = echoSentences(echoes);
  for (const source of sources) {
    const own: string[] = [];
    for (const segment of source.split(SEGMENT_BREAK)) {
      const trimmed = withoutEchoes(normaliseText(segment), echoed).trim();
      if (trimmed.length > 0) own.push(trimmed);
    }
    if (own.length > 0) sourceLines.push(own);
  }
  // Each table's rows starting in a quarter, added up (document-rows.ts);
  // from the sources only, never from Q's own earlier words.
  const periodCounts = new Map<string, number[]>();
  for (const own of sourceLines) {
    if (!own.some((line) => line.includes("|"))) continue;
    for (const table of documentTables(own.join("\n"))) {
      const sums = new Map<string, number>();
      for (const row of table.rows) {
        if (row.period === null) continue;
        sums.set(row.period, (sums.get(row.period) ?? 0) + row.count);
      }
      for (const [period, sum] of sums) {
        const known = periodCounts.get(period) ?? [];
        if (!known.includes(sum)) known.push(sum);
        periodCounts.set(period, known);
      }
    }
  }
  const iso = today.toISOString().slice(0, 10);
  const all = [...sources, ...echoes, iso];
  for (const source of all) {
    // A count of records a tool returned ("you've reached out to 20
    // companies") is the length of a list it holds.
    for (const length of listLengths(source)) {
      numbers.push({ value: length, currency: null });
    }
    for (const line of source.split(/\n|(?<=[.;!?])\s+(?=[A-Z])/u)) {
      const own = figuresIn(line);
      for (const figure of own) {
        numbers.push({
          value: figure.value,
          currency: figure.currency,
          ...(figure.kind === "MONEY" || figure.kind === "PERCENT"
            ? { kind: figure.kind }
            : {}),
        });
      }
      // Bounded: a line listing dozens of numbers (a table dump) adds its
      // values but not its pairs.
      if (own.length >= 2 && own.length <= 12) {
        lines.push(own.map(operandOf));
      }
      for (const minute of clockMinutesIn(line)) minutes.add(minute);
      for (const { key } of dateKeysIn(line)) {
        dates.add(key);
        // A date's day and month ground "22 November" said without a year.
        for (const part of key.split("-").slice(1)) {
          numbers.push({ value: Number(part), currency: null, datePart: true });
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
    minutes,
    sourceLines,
    periodCounts,
    echoText:
      options.echoOnlyWithheld === false
        ? ""
        : normaliseText(echoes.join("\n")),
  };
}

/** Q's own earlier sentences, long enough to be recognised where quoted. */
function echoSentences(echoes: readonly string[]): readonly string[] {
  const out = new Set<string>();
  for (const echo of echoes) {
    for (const part of echo.split(
      /\r?\n|\\n|(?<=[.;!?])\s+|(?<=:)\s+|(?<=;)\s*/u,
    )) {
      const trimmed = normaliseText(part).trim();
      if (trimmed.length >= ECHO_MIN_CHARS) out.add(trimmed);
    }
  }
  // Longest first, so a sentence is taken out before a part of it.
  return [...out].sort((left, right) => right.length - left.length);
}

const ECHO_MIN_CHARS = 24;

/** A source line with Q's own earlier sentences quoted in it taken out. */
function withoutEchoes(line: string, echoed: readonly string[]): string {
  let out = line;
  for (const sentence of echoed) {
    if (out.length < sentence.length) continue;
    if (out.includes(sentence)) out = out.split(sentence).join(" ¦ ");
  }
  return out;
}

/**
 * A source's lines: real line breaks, a JSON tool result's escaped ones,
 * and the boundary between two of its string values.
 */
const SEGMENT_BREAK = /\r?\n|\\n|\\r|(?<=")\s*,\s*(?=")/u;

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

function operandOf(figure: Claim): Operand {
  return {
    value: figure.value,
    kind:
      figure.kind === "MONEY"
        ? "MONEY"
        : figure.kind === "PERCENT"
          ? "PERCENT"
          : "NUMBER",
    currency: figure.currency,
  };
}

/** A plain number an operation may take: a factor, a duration, a period. */
const plainOperand = (value: number): Operand => ({
  value,
  kind: "NUMBER",
  currency: null,
});

/**
 * What a result of arithmetic is. POINTS is a difference of two
 * percentages: said as points ("37 percentage points"), never as a
 * percentage ("37% higher" is a relative claim: 90% for 78% on 41%).
 */
type ResultKind = OperandKind | "POINTS";

interface Result {
  readonly value: number;
  readonly kind: ResultKind;
}

/**
 * Every result one operation of `a` with `b` gives, by kind. Money is
 * added to, averaged with and compared with money of the same currency
 * only. A ratio of
 * like with like is a multiple (or months: cash ÷ burn), times 100 a
 * percentage, and a growth rate. Money or a count is multiplied or
 * divided by a plain number (a period, a duration), and a percentage of
 * it taken.
 */
function combine(a: Operand, b: Operand): Result[] {
  const out: Result[] = [];
  const like =
    a.kind === b.kind &&
    (a.kind !== "MONEY" ||
      a.currency === null ||
      b.currency === null ||
      a.currency === b.currency);
  if (like) {
    out.push({ value: a.value + b.value, kind: a.kind });
    // The mid-point of a range ("KES 3 to KES 5": KES 4).
    out.push({ value: (a.value + b.value) / 2, kind: a.kind });
    out.push({
      value: Math.abs(a.value - b.value),
      kind: a.kind === "PERCENT" ? "POINTS" : a.kind,
    });
    if (b.value !== 0) {
      out.push({ value: a.value / b.value, kind: "NUMBER" });
      out.push({ value: (a.value / b.value) * 100, kind: "PERCENT" });
      out.push({
        value: Math.abs(((a.value - b.value) / b.value) * 100),
        kind: "PERCENT",
      });
    }
  }
  if (b.kind === "NUMBER" && a.kind !== "PERCENT") {
    out.push({ value: a.value * b.value, kind: a.kind });
    if (b.value !== 0) out.push({ value: a.value / b.value, kind: a.kind });
  }
  if (a.kind === "PERCENT" && b.kind !== "PERCENT") {
    out.push({ value: (a.value * b.value) / 100, kind: b.kind });
  }
  return out;
}

/** "37% points": a percentage sign that still says points. */
const POINTS_AFTER = /^\s*(?:percentage[\s-]+)?points?\b/iu;

/** May a result of this kind be said as this claim? */
function saysKind(claim: Claim, result: ResultKind, after: string): boolean {
  if (claim.kind === "MONEY") return result === "MONEY";
  if (claim.kind === "PERCENT") {
    return (
      result === "PERCENT" || (result === "POINTS" && POINTS_AFTER.test(after))
    );
  }
  // A plain number: a multiple, months, points, a count, or money said
  // without its sign ("a difference of 1.3 million").
  return result !== "PERCENT";
}

/** Is `figure` a number the sources state, at its stated precision? */
function directlyGrounded(figure: Claim, corpus: ClaimCorpus): boolean {
  // A multiple is a plain number: neither "$3" nor "3%" nor a date's
  // month ("March 2024") grounds "a 3x multiple"; and a day or month of a
  // date grounds a plain number only ("22 November").
  const multiple = /[x×]$/u.test(figure.text.trim());
  const plainNumber = figure.kind === "NUMBER" && !multiple;
  const direct = corpus.numbers.some(
    (source) =>
      (source.datePart !== true || plainNumber) &&
      (!multiple || source.kind === undefined) &&
      roundsTo(figure.value, figure.precision, source.value) &&
      (figure.currency === null ||
        source.currency === null ||
        source.currency === figure.currency),
  );
  if (direct) return true;
  // A year said as itself ("in 2024").
  return (
    figure.kind === "NUMBER" &&
    Number.isInteger(figure.value) &&
    figure.value >= 1900 &&
    figure.value <= 2100 &&
    [...corpus.dates].some((key) => key.startsWith(String(figure.value)))
  );
}

/**
 * A figure is grounded when the sources state it, or when it is
 * recomputed: one operation (combine) of two inputs reproduces it at the
 * figure's own stated precision, as a result of a kind the figure may say.
 * The inputs are what the reader can see -- the sentence's own sourced
 * figures, the sentence before's, sourced durations and the periods the
 * sentence converts between -- or a pair from one source line of which
 * the sentence says at least one. Never a figure that is itself only
 * derived from coincidence, and never a pair the reader cannot see
 * (400k ÷ 1.2M × 100 on a deck line does not ground "33%").
 */
function figureGrounded(
  figure: Claim,
  corpus: ClaimCorpus,
  inputs: readonly Operand[],
  after = "",
): boolean {
  if (directlyGrounded(figure, corpus)) return true;
  const reproduces = (a: Operand, b: Operand): boolean =>
    combine(a, b).some(
      (result) =>
        Number.isFinite(result.value) &&
        saysKind(figure, result.kind, after) &&
        roundsTo(figure.value, figure.precision, result.value),
    );
  for (const [i, a] of inputs.entries()) {
    for (const [j, b] of inputs.entries()) {
      if (i !== j && reproduces(a, b)) return true;
    }
  }
  const said = (operand: Operand): boolean =>
    inputs.some(
      (input) =>
        input.value === operand.value ||
        (operand.value !== 0 &&
          Math.abs(input.value - operand.value) / Math.abs(operand.value) <
            1e-9),
    );
  return corpus.lines.some((line) =>
    line.some(
      (a, i) =>
        said(a) &&
        line.some((b, j) => i !== j && (reproduces(a, b) || reproduces(b, a))),
    ),
  );
}

/**
 * The conversion factors between rates the sentence itself states: "$180k
 * a month is $2.16M a year" states a month and a year, so x12 is part of
 * its own arithmetic. Both periods must be said in the sentence; a lone
 * "annual burn is $1.02M" names one period and gains nothing.
 */
const PERIODS: readonly (readonly [string, RegExp])[] = [
  ["week", /\b(?:a|per|each|every)\s+week\b|\bweekly\b|\/\s?wk\b/iu],
  ["month", /\b(?:a|per|each|every)\s+month\b|\bmonthly\b|\/\s?mo(?:nth)?\b/iu],
  ["quarter", /\b(?:a|per|each|every)\s+quarter\b|\bquarterly\b/iu],
  [
    "year",
    // "over a full year", "the whole year", "12 months": live NUM-106
    // (2026-11-06) asked "over a full year" and the reply echoed it.
    /\b(?:a|per|each|every)\s+year\b|\b(?:a|one|the)\s+(?:full|whole)\s+year\b|\bfull[- ]year\b|\b(?:12|twelve)\s+months\b|\b(?:yearly|annual(?:ly|i[sz]ed)?|per\s+annum)\b|\/\s?yr\b/iu,
  ],
];
const PERIOD_FACTORS: readonly (readonly [string, string, number])[] = [
  ["month", "year", 12],
  ["quarter", "year", 4],
  ["week", "year", 52],
  ["month", "quarter", 3],
];

/**
 * A calendar factor the sentence writes as its own operand ("$180k × 12",
 * "× 12 months", "times 52") beside the period it converts to: the
 * multiplication is on the page, and 12 months to a year is the calendar,
 * not a fact anyone could have invented. Only these factors, only beside
 * their period; any other multiplier is a claim like any number.
 */
const CALENDAR_OPERAND = /(?:[×x*]|\btimes)\s?(?<n>12|52|4)\b(?!\s?[.,]\d)/giu;
const CALENDAR_PERIOD: Readonly<Record<string, string>> = {
  "12": "year",
  "52": "year",
  "4": "year",
};

function calendarOperandsIn(sentence: string): number[] {
  const said = new Set(
    PERIODS.filter(([, pattern]) => pattern.test(sentence)).map(([p]) => p),
  );
  const out: number[] = [];
  for (const match of sentence.matchAll(CALENDAR_OPERAND)) {
    const n = match.groups?.["n"] ?? "";
    const period = CALENDAR_PERIOD[n];
    if (period !== undefined && said.has(period)) out.push(Number(n));
  }
  return out;
}

function periodFactorsIn(sentence: string): number[] {
  const said = new Set(
    PERIODS.filter(([, pattern]) => pattern.test(sentence)).map(([p]) => p),
  );
  return PERIOD_FACTORS.filter(([a, b]) => said.has(a) && said.has(b)).map(
    ([, , factor]) => factor,
  );
}

/**
 * Durations the claim check does not test as claims ("9 months" is a lone
 * digit) that the sources do state, so "9 months at $120k a month implies
 * about $1.08M" can show its own arithmetic. Only as inputs, never as a
 * claim's own grounding.
 */
function durationInputsIn(sentence: string, corpus: ClaimCorpus): number[] {
  return figuresIn(sentence)
    .filter(
      (figure) =>
        isIncidental(sentence, figure) &&
        DURATION_AFTER.test(sentence.slice(figure.end)) &&
        corpus.numbers.some((source) => source.value === figure.value),
    )
    .map((figure) => figure.value);
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
    // Regions, cities and blocs. Countries come from the one canonical
    // list (@capital-q/taxonomy/countries), never a copy here.
    "north africa",
    "west africa",
    "east africa",
    "southern africa",
    "sub saharan africa",
    "sub-saharan africa",
    "middle east",
    "latin america",
    "north america",
    "south america",
    "european union",
    "new york",
    "san francisco",
    "silicon valley",
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
    "has have had let please want need see consider ask check open compare book send " +
    // A greeting or sign-off opens no name: "Hi Ngozi," names Ngozi, and
    // "Best, Daniel" names Daniel (step 10: messages written for the person).
    "hi hello hey dear thanks thank best regards cheers warmly kind"
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
    // An opening quotation mark or bracket starts a new name: a document's
    // title quoted after a name is not part of it. Live run 82b3f4ac
    // (17 Nov 2026): 'the Halyard Security "Team and hiring plan" ...' read
    // "Halyard Security Team" as an invented name and lost the sentence
    // that answered "how many in Q1".
    if (/^[("“‘[]/u.test(said)) flush();
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
    // "Northwind's ARR" names Northwind. So does closing Markdown emphasis,
    // and punctuation inside it: "**Silo Health:** Nairobi …" names Silo
    // Health (live ORD-016 #0, 7a41ff4: read as "Silo Health Nairobi", the
    // whole list line was removed).
    const unmarked = said.replace(/[*_`]+$/u, "");
    if (possessive) flush();
    else if (unmarked !== said && /[*_`]{2}$|`$/u.test(said)) flush();
    else if (/[,;:!?.)"”]$/u.test(unmarked) && !/\b[A-Z]\.$/u.test(unmarked)) {
      flush();
    }
  }
  flush();
  return names;
}

const ACRONYM = /^[A-Z]{2,6}s?$/u;

const sourcedWords = (words: string, corpus: ClaimCorpus): boolean =>
  new RegExp(
    `(?<![\\p{L}\\p{N}])${words.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}(?![\\p{L}\\p{N}])`,
    "u",
  ).test(corpus.text);

/**
 * Words the sources write that describe and name nobody: an acronym they
 * use ("SME" of "SME lending") beside a place they name, as itself or as
 * "<place>-based". Live 2026-11-06 (61b7a85, ORD-016 #0 and CMP-061 #0):
 * "Silo Credit is a Lagos-based SME lender" read "Lagos-based SME" as an
 * invented name and lost the line that named Silo Credit. Only with such
 * an acronym, and only when what is left is itself in the sources: parts
 * of two names put together ("Kora Credit"), or a place beside a word or
 * acronym no source writes, are still names.
 */
function sourcedDescription(name: string, corpus: ClaimCorpus): boolean {
  const tokens = name.split(/\s+/u).filter((token) => token.length > 0);
  const acronyms = tokens.filter(
    (token) =>
      ACRONYM.test(token) &&
      sourcedWords(token.toLowerCase().replace(/s$/u, ""), corpus),
  );
  if (acronyms.length === 0) return false;
  const rest = tokens
    .filter((token) => !acronyms.includes(token))
    .map((token) => token.replace(/-based$/iu, ""))
    .join(" ");
  return rest.length === 0 || sourcedWords(normaliseText(rest), corpus);
}

function nameGrounded(name: string, corpus: ClaimCorpus): boolean {
  const normal = normaliseText(name);
  if (KNOWN_PHRASES.has(normal)) return true;
  if (countryOfName(name) !== null) return true;
  if (corpus.text.includes(normal)) return true;
  if (sourcedDescription(name, corpus)) return true;
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

/**
 * A name made of a sourced name of two or more words and ordinary words
 * beside it, on either side: "Halyard Security Hiring Plan" is Halyard
 * Security and words the sources write in lower case. A one-word part is
 * never the sourced name: parts of two names put together ("Kora Credit")
 * stay a name no source states. Used only where the sentence's counts are
 * bound to the sources' rows (SentenceCheckOptions.rowBound).
 */
function nameGroundedInParts(name: string, corpus: ClaimCorpus): boolean {
  const words = name.split(/\s+/u).filter((word) => word.length > 0);
  const ordinary = (part: readonly string[]): boolean =>
    part.every((word) => {
      const lower = normaliseText(word);
      return (
        CONNECTOR.test(lower) ||
        NOT_NAME_WORDS.has(lower) ||
        KNOWN_PHRASES.has(lower) ||
        corpus.ordinary.has(lower)
      );
    });
  const sourced = (part: readonly string[]): boolean =>
    part.length >= 2 && corpus.text.includes(normaliseText(part.join(" ")));
  for (let cut = 1; cut < words.length; cut += 1) {
    const head = words.slice(0, cut);
    const tail = words.slice(cut);
    if (sourced(head) && ordinary(tail)) return true;
    if (ordinary(head) && sourced(tail)) return true;
  }
  return false;
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
  for (const minute of clockMinutesIn(sentence)) {
    claims.push({
      kind: "DATE",
      text: `time:${minute}`,
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
 * Scenario E (live 2026-11-16, run 06de74f3): a comparison stated
 * Tensorgate's "USD 360,000 of contracted ARR", then a sentence with an
 * ungrounded figure about ARR became "Neither Capital Q's records nor the
 * sources I read give a figure for ARR yet" -- false, the records hold
 * one, and the answer contradicted itself. The honest unknown is said only
 * when no source names the metric at all; otherwise the ungrounded
 * sentence is removed and the grounded figures stand.
 */
function sourcesNameMetric(label: string, corpus: ClaimCorpus): boolean {
  return METRICS.some(
    ([pattern, metric]) => metric === label && pattern.test(corpus.text),
  );
}

/** The words after a claim in its sentence ("… points"). */
function afterClaim(sentence: string, claim: Claim): string {
  const at = sentence.indexOf(claim.text);
  return at < 0 ? "" : sentence.slice(at + claim.text.length);
}

// --- Counts of a named item ---------------------------------------------

/**
 * Live scenario D rerun on d252444b1 (16 Nov 2026, run b0a877f8): Q said
 * the hiring plan adds "4 public-sector account managers"; the plan it had
 * just read says 3 ("Public-sector account manager | Sales | 3 2027-Q1"),
 * so the parts summed to 16 against the stated 15. The check never looked:
 * a lone digit is skipped as a list position, and matching by value alone
 * finds a 4 somewhere in any long source.
 *
 * Principle: a count stated of a named item ("6 deployment engineers") is
 * bound to that item. Where the sources name the same item on a short line
 * that carries a count, the claimed count must be on one of the lines that
 * name it (or be their total). A count of an item no source names, or
 * names only on lines without a count, is left to the value check: the
 * binding only ever narrows what the sources ground, so an item it cannot
 * place never fails a sentence.
 */

/** Words that measure rather than name what is counted. */
const MEASURE_WORDS = new Set([
  "second",
  "minute",
  "hour",
  "day",
  "week",
  "month",
  "quarter",
  "year",
  "decade",
  "time",
  "percent",
  "per",
  "cent",
  "point",
  "basis",
  "x",
  "pound",
  "dollar",
  "euro",
  "share",
  "page",
  "slide",
  "item",
  "thing",
  "other",
  "more",
  "less",
  "fewer",
  "people",
  "person",
  "group",
  "role",
  "one",
]);

/** Words that end the item a count is of. */
const ITEM_END = new Set([
  "in",
  "by",
  "from",
  "with",
  "to",
  "for",
  "on",
  "at",
  "across",
  "over",
  "starting",
  "each",
  "per",
  "a",
  "an",
  "the",
  "of",
  "is",
  "are",
  "was",
  "were",
  "will",
  "would",
  "who",
  "which",
  "that",
  "than",
  "as",
  "plus",
  "or",
  "nor",
  "but",
  "if",
  "when",
  "while",
  "after",
  "before",
  "during",
  "until",
  "between",
  "under",
  "into",
  "out",
  "up",
  "this",
  "these",
  "those",
  "their",
  "its",
  "his",
  "her",
  "our",
  "your",
  "it",
  "they",
  "there",
  "so",
  "not",
  "no",
  "all",
  "both",
  "only",
  "also",
  "about",
  "around",
  "approximately",
  "roughly",
  "nearly",
  "almost",
  "including",
  "here",
]);

/** Small counts a source may write in words ("three account managers"). */
const COUNT_WORDS: readonly string[] = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
];

const singular = (word: string): string =>
  word.endsWith("ies") && word.length > 4
    ? `${word.slice(0, -3)}y`
    : word.endsWith("sses") || word.endsWith("ches") || word.endsWith("shes")
      ? word.slice(0, -2)
      : word.endsWith("s") && !word.endsWith("ss") && word.length > 3
        ? word.slice(0, -1)
        : word;

const escapeRegExp = (text: string): string =>
  text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

/** The item a count right before `after` is of: its words, or null. */
function countedItem(after: string): readonly string[] | null {
  const tokens = after
    .replace(/[’‘`]/gu, "'")
    .toLowerCase()
    .split(/(\s+|[,;:.!?()"“”]|—|–)/u)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
  const words: string[] = [];
  for (const [index, token] of tokens.entries()) {
    if (!/^[\p{L}][\p{L}'-]*$/u.test(token) && token !== "&") break;
    // A count ends the item before it, in words as in digits (live
    // a1777c9a: "four ... account managers and one information security
    // and assurance manager" ran on into one seven-word item).
    if (COUNT_WORD_SET.has(token)) break;
    if (token === "and" || token === "&") {
      // "finance and operations manager" is one item; "managers and 1
      // assurance manager" (or "and one ...") ends at the next count.
      const next = tokens[index + 1];
      if (
        next === undefined ||
        !/^[\p{L}]/u.test(next) ||
        COUNT_WORD_SET.has(next)
      ) {
        break;
      }
      words.push("and");
      continue;
    }
    if (ITEM_END.has(token)) break;
    for (const part of token.split("-")) {
      if (part.length > 0) words.push(part.replace(/'s$/u, ""));
    }
    if (words.length > 6) return null;
  }
  while (words.at(-1) === "and") words.pop();
  const content = words.filter((word) => word !== "and");
  if (content.length < 2) return null;
  if (content.some((word) => MEASURE_WORDS.has(singular(word)))) return null;
  return words;
}

/** A count a source line states: a whole number (not a year) or a word. */
type LineCount = {
  readonly value: number;
  readonly index: number;
  readonly end: number;
};

const COUNT_WORD_PATTERNS = COUNT_WORDS.map(
  (word) => new RegExp(`(?<![\\p{L}])${word}(?![\\p{L}])`, "gu"),
);

const COUNT_WORD_SET: ReadonlySet<string> = new Set(COUNT_WORDS);

/** "four", "Six": a count written as a word, not part of another word. */
const COUNT_WORD = new RegExp(
  `(?<![\\p{L}\\p{N}-])(?:${COUNT_WORDS.join("|")})(?![\\p{L}\\p{N}-])`,
  "giu",
);

/**
 * The whole-number counts a text states, in digits or in words, in order.
 * Live a1777c9a: the model wrote "four public-sector account managers" and
 * "five in Q1", and every count check read digits only.
 */
function countFiguresIn(text: string): Figure[] {
  const found: Figure[] = figuresIn(text).filter(
    (figure) =>
      figure.kind === "NUMBER" &&
      Number.isInteger(figure.value) &&
      !isYear(figure),
  );
  for (const match of text.matchAll(COUNT_WORD)) {
    found.push({
      kind: "NUMBER",
      text: match[0],
      value: COUNT_WORDS.indexOf(match[0].toLowerCase()),
      precision: 1,
      currency: null,
      index: match.index,
      end: match.index + match[0].length,
    });
  }
  return found.sort((left, right) => left.index - right.index);
}

/** A count's literal code may put right: digits, or a count word. */
const correctable = (figure: Figure): boolean => {
  const literal = figure.text.trim();
  return /^\d+$/u.test(literal) || COUNT_WORD_SET.has(literal.toLowerCase());
};

function countsAt(line: string): LineCount[] {
  const out: LineCount[] = [];
  for (const figure of figuresIn(line)) {
    if (figure.kind !== "NUMBER" || !Number.isInteger(figure.value)) continue;
    if (isYear(figure)) continue;
    out.push({ value: figure.value, index: figure.index, end: figure.end });
  }
  for (const [value, pattern] of COUNT_WORD_PATTERNS.entries()) {
    for (const match of line.matchAll(pattern)) {
      out.push({
        value,
        index: match.index,
        end: match.index + match[0].length,
      });
    }
  }
  return out.sort((left, right) => left.index - right.index);
}

const isYear = (figure: Figure): boolean =>
  /^\d{4}$/u.test(figure.text.trim()) &&
  figure.value >= 1900 &&
  figure.value <= 2100;

/**
 * Live re-check on 927f25ddd (16 Nov 2026, conversation e7e3c866): the
 * plan's rows came as retrieved passages, and a 4 anywhere along a line
 * that named "public-sector account manager" (Q's own earlier reply, a
 * run-together passage) grounded "4 public-sector account managers". A
 * count is bound to a row, not to a line: the count written right before
 * the item ("3 account managers"), else the first count after it across a
 * column break ("Public-sector account manager | Sales | 3 2027-Q1"), else,
 * where the line holds only the item, the count opening the next line
 * (columns extracted one per line). A role wrapped across two table lines
 * ("Information security and assurance | Operations | 1" over "manager |
 * G&A") is that role's row.
 */
const COUNT_BEFORE_GAP = /^\s+(?:[\p{L}-]+\s+)?$/u;
const COLUMN_BREAK = /[|:\t=–—]|\s{2,}/u;
const COLUMN_GAP_MAX = 80;
const SENTENCE_END = /[.!?](?:\s|$)/u;
const LINE_OPENS_WITH_COUNT =
  /^\s*(?:\d+|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)(?![\p{L}\p{N}])/u;

function boundCount(line: string, start: number, end: number): number | null {
  const counts = countsAt(line);
  const before = counts.filter((count) => count.end <= start).at(-1);
  if (
    before !== undefined &&
    COUNT_BEFORE_GAP.test(line.slice(before.end, start))
  ) {
    return before.value;
  }
  const after = counts.find((count) => count.index >= end);
  if (after === undefined) return null;
  const gap = line.slice(end, after.index);
  if (/^\s*$/u.test(gap)) return after.value;
  if (
    gap.length <= COLUMN_GAP_MAX &&
    COLUMN_BREAK.test(gap) &&
    !SENTENCE_END.test(gap)
  ) {
    return after.value;
  }
  return null;
}

/** The item as a source may write it (either number, hyphens). */
function itemBody(words: readonly string[]): string {
  return words
    .map((word) => {
      if (word === "and") return "(?:and|&)";
      const base = singular(word);
      const forms = [`${escapeRegExp(base)}(?:s|es)?`];
      if (base.endsWith("y")) {
        forms.push(`${escapeRegExp(base.slice(0, -1))}ies`);
      }
      return `(?:${forms.join("|")})`;
    })
    .join("[\\s-]+");
}

/** A row's count for the item, and where the row is. */
type RowCount = {
  readonly value: number;
  readonly source: number;
  readonly row: string;
};

/** Every row of the sources that names the item and binds a count to it. */
function itemRows(item: readonly string[], corpus: ClaimCorpus): RowCount[] {
  const whole = new RegExp(`(?<![\\p{L}])${itemBody(item)}(?![\\p{L}])`, "gu");
  // A table cell wrapped onto the next line: the head of the item ending
  // the cell, the rest of it opening the next line.
  const wraps = item.flatMap((_, at) => {
    const head = item.slice(0, at);
    const tail = item.slice(at);
    if (
      head.filter((word) => word !== "and").length < 2 ||
      head.at(-1) === "and" ||
      tail[0] === "and"
    ) {
      return [];
    }
    return [
      {
        head: new RegExp(
          `(?<![\\p{L}])${itemBody(head)}(?=\\s*(?:\\||$))`,
          "gu",
        ),
        tail: new RegExp(`^\\s*${itemBody(tail)}(?![\\p{L}])`, "u"),
      },
    ];
  });
  const rows: RowCount[] = [];
  corpus.sourceLines.forEach((lines, source) => {
    lines.forEach((line, at) => {
      const next = lines[at + 1] ?? "";
      const found: { readonly start: number; readonly end: number }[] = [];
      for (const match of line.matchAll(whole)) {
        found.push({ start: match.index, end: match.index + match[0].length });
      }
      for (const wrap of wraps) {
        if (!wrap.tail.test(next)) continue;
        for (const match of line.matchAll(wrap.head)) {
          found.push({
            start: match.index,
            end: match.index + match[0].length,
          });
        }
      }
      for (const { start, end } of found) {
        let value = boundCount(line, start, end);
        if (value === null) {
          // The line is the item alone; its count opens the next line.
          const rest = `${line.slice(0, start)}${line.slice(end)}`;
          if (/^[\s|:()-]*$/u.test(rest) && LINE_OPENS_WITH_COUNT.test(next)) {
            value = countsAt(next)[0]?.value ?? null;
          }
        }
        if (value !== null) rows.push({ value, source, row: line });
      }
    });
  });
  return rows;
}

/** What the sources hold of a count of one item. */
type CountBinding =
  | { readonly kind: "UNPLACED" }
  /** A row naming the item binds this count (the sources it is in). */
  | { readonly kind: "GROUNDED"; readonly sources: ReadonlySet<number> }
  /** Rows name the item with counts, none of them this one. */
  | {
      readonly kind: "CONTRADICTED";
      /** The one count every such row gives, or null where they differ. */
      readonly only: number | null;
      readonly sources: ReadonlySet<number>;
    };

/**
 * A head count's noun ("15 planned hires", "5 people"): a total the
 * sentence's own arithmetic may ground (statedTotal), never a named item.
 */
const HEAD_COUNT_NOUNS: ReadonlySet<string> = new Set([
  "hire",
  "people",
  "person",
  "role",
  "employee",
  "staff",
  "position",
  "headcount",
  "member",
]);

/** Q's own earlier words name the item, as a whole phrase. */
function echoNames(item: readonly string[], corpus: ClaimCorpus): boolean {
  if (corpus.echoText.length === 0) return false;
  if (HEAD_COUNT_NOUNS.has(singular(item.at(-1) ?? ""))) return false;
  return new RegExp(`(?<![\\p{L}])${itemBody(item)}(?![\\p{L}])`, "u").test(
    corpus.echoText,
  );
}

function bindCount(
  value: number,
  item: readonly string[],
  corpus: ClaimCorpus,
): CountBinding {
  const rows = itemRows(item, corpus);
  if (rows.length === 0) {
    // Named only in Q's own earlier words (recalled memory, its earlier
    // replies): no source holds this count, and a count Q said before is
    // not one a document said. Withheld, never put right.
    return echoNames(item, corpus)
      ? { kind: "CONTRADICTED", only: null, sources: new Set<number>() }
      : { kind: "UNPLACED" };
  }
  const matching = rows.filter((row) => row.value === value);
  if (matching.length > 0) {
    return {
      kind: "GROUNDED",
      sources: new Set(matching.map((row) => row.source)),
    };
  }
  // Their total, within one source ("10 engineers" over a row of 6 and a
  // row of 4).
  const bySource = new Map<number, Map<string, number>>();
  for (const row of rows) {
    const own = bySource.get(row.source) ?? new Map<string, number>();
    if (!own.has(row.row)) own.set(row.row, row.value);
    bySource.set(row.source, own);
  }
  const totalled = [...bySource.entries()].filter(
    ([, own]) =>
      own.size >= 2 &&
      [...own.values()].reduce((sum, one) => sum + one, 0) === value,
  );
  if (totalled.length > 0) {
    return {
      kind: "GROUNDED",
      sources: new Set(totalled.map(([source]) => source)),
    };
  }
  const values = new Set(rows.map((row) => row.value));
  return {
    kind: "CONTRADICTED",
    only: values.size === 1 ? ([...values][0] ?? null) : null,
    sources: new Set(rows.map((row) => row.source)),
  };
}

/** A sentence's counts of named items, held to the rows that name them. */
type CountsChecked = {
  /** The sentence, any count the sources settle put right. */
  readonly text: string;
  /** Counts put right. */
  readonly corrected: number;
  /** A count the sources contradict and do not settle, or parts off their total. */
  readonly contradicted: boolean;
  /**
   * A stated total its listed parts add up to, each part grounded: the
   * sum is the sentence's own arithmetic, visible to the reader.
   */
  readonly totals: readonly number[];
};

/** "15 people in total", "a total of 15": the stated total. */
const TOTAL_AFTER = /^\s*(?:[\p{L}'-]+\s+){0,3}?in\s+total\b/iu;
const TOTAL_BEFORE = /\b(?:a\s+)?total\s+of\s+$/iu;
/** "hire 15 people", "15 new hires": a head count stated as a total. */
const TOTAL_UNIT =
  /^\s+(?:new\s+|additional\s+|more\s+)?(?:people|persons|hires|staff|employees|roles|positions|heads|members)\b/iu;
/** A list that is only part of the total ("including 3 …"). */
const PART_OF =
  /\b(?:including|includes|such as|among them|for example|e\.g\.|of which|at least|up to|about|around|roughly|approximately|others?|more|rest)\b/iu;

/** The counts of named items a sentence lists. */
function listedParts(text: string): Figure[] {
  return countFiguresIn(text).filter(
    (figure) =>
      !isIncidental(text, figure, false) &&
      countedItem(text.slice(figure.end)) !== null,
  );
}

/** Head counts the sentence before states ("planning to hire 15 people"). */
function totalsStatedIn(previous: string): readonly number[] {
  return figuresIn(previous)
    .filter(
      (figure) =>
        figure.kind === "NUMBER" &&
        Number.isInteger(figure.value) &&
        !isYear(figure) &&
        TOTAL_UNIT.test(previous.slice(figure.end)),
    )
    .map((figure) => figure.value);
}

/**
 * Live re-check on a65386689 (run 91bb8564): "15 people ...: 5 in Q1, 10
 * in Q2 and 1 in Q3", where the plan's Q1 rows add up to 4. A count said of
 * a quarter is held to what the sources' count tables add up to over their
 * rows starting then (claimCorpus `periodCounts`); a quarter said without
 * its year is bound only where the tables give it in one year.
 */
const PERIOD_AFTER =
  /^\s+(?:(?:new\s+)?(?:people|persons|hires|roles|staff|employees|heads)\s+)?(?:in|by|during|from|for|starting(?:\s+in)?)\s+(?:the\s+)?(?:(?<y1>(?:19|20)\d{2})\s?-\s?q(?<q1>[1-4])|q(?<q2>[1-4])(?:\s+(?:of\s+)?(?<y2>(?:19|20)\d{2}))?)(?![\p{L}\p{N}])/iu;

type PeriodPart = {
  readonly figure: Figure;
  readonly quarter: string;
  readonly year: string | null;
};

function periodPartsIn(text: string): PeriodPart[] {
  return countFiguresIn(text).flatMap((figure) => {
    const match = PERIOD_AFTER.exec(text.slice(figure.end));
    const groups = match?.groups;
    const quarter = groups?.["q1"] ?? groups?.["q2"];
    if (quarter === undefined) return [];
    return [
      { figure, quarter, year: groups?.["y1"] ?? groups?.["y2"] ?? null },
    ];
  });
}

function bindPeriod(part: PeriodPart, corpus: ClaimCorpus): CountBinding {
  const keys = [...corpus.periodCounts.keys()].filter(
    (key) =>
      key.endsWith(`-Q${part.quarter}`) &&
      (part.year === null || key.startsWith(part.year)),
  );
  if (keys.length === 0) return { kind: "UNPLACED" };
  if (new Set(keys.map((key) => key.slice(0, 4))).size > 1) {
    return { kind: "UNPLACED" };
  }
  const values = new Set(
    keys.flatMap((key) => corpus.periodCounts.get(key) ?? []),
  );
  if (values.has(part.figure.value)) {
    return { kind: "GROUNDED", sources: new Set() };
  }
  return {
    kind: "CONTRADICTED",
    only: values.size === 1 ? ([...values][0] ?? null) : null,
    sources: new Set(),
  };
}

/**
 * What the count checks did, for the run's diagnostic line: counts
 * examined (a count of a named item or of a quarter the check could read),
 * bound to a source row or table, contradicted by one, put right, or left
 * unplaced (no row names the item). Numbers only, never text.
 */
export type CountTally = {
  examined: number;
  bound: number;
  contradicted: number;
  corrected: number;
  unplaced: number;
};

export const emptyCountTally = (): CountTally => ({
  examined: 0,
  bound: 0,
  contradicted: 0,
  corrected: 0,
  unplaced: 0,
});

function count(tally: CountTally | undefined, bound: CountBinding): void {
  if (tally === undefined) return;
  tally.examined += 1;
  if (bound.kind === "GROUNDED") tally.bound += 1;
  else if (bound.kind === "CONTRADICTED") tally.contradicted += 1;
  else tally.unplaced += 1;
}

/** A count written as a word ("four account managers") the rows contradict. */
function wordCountContradicted(text: string, corpus: ClaimCorpus): boolean {
  const lower = text.toLowerCase();
  return COUNT_WORD_PATTERNS.some((pattern, value) =>
    [...lower.matchAll(pattern)].some((match) => {
      const item = countedItem(lower.slice(match.index + match[0].length));
      return (
        item !== null && bindCount(value, item, corpus).kind === "CONTRADICTED"
      );
    }),
  );
}

function checkCounts(
  sentence: string,
  corpus: ClaimCorpus,
  previous = "",
  tally?: CountTally,
): CountsChecked {
  const contradicted: CountsChecked = {
    text: sentence,
    corrected: 0,
    contradicted: true,
    totals: [],
  };
  let text = sentence;
  const grounded = new Set<number>();
  const corrections: { readonly sources: ReadonlySet<number> }[] = [];
  let periodCorrections = 0;
  const periodValues: number[] = [];
  const periods = periodPartsIn(sentence);
  const parts = [
    ...listedParts(sentence).map((figure) => ({ figure, period: null })),
    ...periods.map((period) => ({ figure: period.figure, period })),
  ].sort((left, right) => right.figure.index - left.figure.index);
  // Right to left, so a correction never moves a figure still to check.
  for (const { figure, period } of parts) {
    if (period !== null) {
      const bound = bindPeriod(period, corpus);
      count(tally, bound);
      if (bound.kind === "GROUNDED") {
        periodValues.push(figure.value);
        continue;
      }
      if (bound.kind !== "CONTRADICTED") continue;
      if (bound.only === null || !correctable(figure)) {
        return contradicted;
      }
      text = `${text.slice(0, figure.index)}${String(bound.only)}${text.slice(figure.end)}`;
      periodValues.push(bound.only);
      periodCorrections += 1;
      continue;
    }
    const item = countedItem(sentence.slice(figure.end));
    if (item === null) continue;
    const bound = bindCount(figure.value, item, corpus);
    count(tally, bound);
    if (bound.kind === "GROUNDED") {
      for (const source of bound.sources) grounded.add(source);
      continue;
    }
    if (bound.kind !== "CONTRADICTED") continue;
    if (bound.only === null || !correctable(figure)) {
      return contradicted;
    }
    text = `${text.slice(0, figure.index)}${String(bound.only)}${text.slice(figure.end)}`;
    corrections.push({ sources: bound.sources });
  }
  if (periodCorrections > 0) {
    // A quarter's count is put right only where the sentence's quarters,
    // as put right, add up to the head count it (or the sentence before)
    // states, each of them on the tables: "15 people ...: 4 in Q1, 10 in
    // Q2 and 1 in Q3". Otherwise the sentence goes.
    const after = periodPartsIn(text);
    const sum = after.reduce((all, part) => all + part.figure.value, 0);
    const stated = [...totalsStatedIn(text), ...totalsStatedIn(previous)];
    const placed = after.every(
      (part) => bindPeriod(part, corpus).kind === "GROUNDED",
    );
    if (after.length < 2 || !placed || !stated.includes(sum)) {
      return contradicted;
    }
  }
  const total = statedTotal(text, corpus);
  if (total === "OFF") return contradicted;
  if (corrections.length > 0 && total === null) {
    // A count is put right only where the rows naming the item agree on
    // one count, whichever source states it, and the sentence is plainly
    // reciting those rows: its parts, put right, add up to the head count
    // the sentence before stated ("planning to hire 15 people. The roles
    // are ..."), or its other counts are grounded on rows of the same
    // source. Otherwise the sentence goes (the claim check's rule), never
    // a figure code chose alone: "2 deployment engineers joined in July"
    // is not the plan's count.
    const listed = listedParts(text);
    const sum = listed.reduce((all, part) => all + part.value, 0);
    const stated = totalsStatedIn(previous);
    const addsUp = listed.length >= 2 && stated.includes(sum);
    if (listed.length >= 2 && stated.length > 0 && !addsUp) {
      return contradicted;
    }
    const recited = corrections.every((correction) =>
      [...correction.sources].some((source) => grounded.has(source)),
    );
    if (!addsUp && !recited) return contradicted;
  }
  if (tally !== undefined) {
    tally.corrected += corrections.length + periodCorrections;
  }
  return {
    text,
    corrected: corrections.length + periodCorrections,
    contradicted: false,
    totals: [...(total === null ? [] : [total]), ...periodValues],
  };
}

// --- The period a figure is said to cover ---------------------------------

/**
 * "for the 12 months to October 2026": a trailing period said of the
 * figures before it in the same clause.
 */
const TRAILING_PERIOD =
  /,?\s*\b(?:for|over|in|across)\s+the\s+(?:last\s+|trailing\s+)?(?<n>\d{1,2}|twelve|six|three)\s+months\s+(?:to|ending|ended)\s+(?:\d{1,2}\s+)?(?<m>[A-Za-z]{3,9})\.?,?\s+(?<y>(?:19|20)\d{2})\b/giu;

const PERIOD_WORDS: Readonly<Record<string, number>> = {
  twelve: 12,
  six: 6,
  three: 3,
};

/** A period a source line states for the figures on it or under it. */
type PeriodLabel =
  | { readonly kind: "TRAILING"; readonly months: number; readonly ym: string }
  | { readonly kind: "MONTH"; readonly ym: string }
  | { readonly kind: "OTHER" };

const SOURCE_TRAILING =
  /\b(?<n>\d{1,2}|twelve|six|three)\s+months\s+(?:to|ending|ended)\s+(?:\d{1,2}\s+)?(?<m>[a-z]{3,9})\.?,?\s+(?<y>(?:19|20)\d{2})\b/iu;
const SOURCE_RANGE =
  /\b[a-z]{3,9}\.?\s+(?:19|20)\d{2}\s+(?:to|-|–|—)\s+[a-z]{3,9}\.?\s+(?:19|20)\d{2}\b/iu;

function yearMonth(month: string, year: string): string | null {
  const index = MONTH_INDEX.get(month.toLowerCase());
  return index === undefined
    ? null
    : `${year}-${String(index).padStart(2, "0")}`;
}

function periodLabelOf(line: string): PeriodLabel | null {
  const trailing = SOURCE_TRAILING.exec(line);
  if (trailing !== null) {
    const groups = trailing.groups ?? {};
    const n = groups["n"] ?? "";
    const months = PERIOD_WORDS[n.toLowerCase()] ?? Number(n);
    const ym = yearMonth(groups["m"] ?? "", groups["y"] ?? "");
    return ym === null ? { kind: "OTHER" } : { kind: "TRAILING", months, ym };
  }
  if (SOURCE_RANGE.test(line)) return { kind: "OTHER" };
  const months = new Set(
    dateKeysIn(line)
      .map(({ key }) => key.slice(0, 7))
      .filter((key) => /^\d{4}-\d{2}$/u.test(key)),
  );
  if (months.size > 1) return { kind: "OTHER" };
  const [ym] = [...months];
  return ym === undefined ? null : { kind: "MONTH", ym };
}

/** A heading: a period and no figure of its own ("Summary for October 2026"). */
function isPeriodHeading(line: string): boolean {
  const withoutDates = line
    .replace(SOURCE_TRAILING, " ")
    .replace(/\b(?:19|20)\d{2}(?:-\d{2}(?:-\d{2})?)?\b/gu, " ")
    .replace(/\b\d{1,2}(?:st|nd|rd|th)?\s+(?=[a-z]{3,9})/giu, " ");
  return !/\d/u.test(withoutDates) && line.length <= 80;
}

const HEADING_LOOKBACK = 15;

/**
 * The periods the sources state for a figure: each source line holding a
 * value it rounds to, labelled by its own period, else by the nearest
 * period heading above it in the same source.
 */
function periodsOfFigure(figure: Figure, corpus: ClaimCorpus): PeriodLabel[] {
  const labels: PeriodLabel[] = [];
  for (const lines of corpus.sourceLines) {
    lines.forEach((line, at) => {
      const holds = figuresIn(line).some(
        (found) =>
          (figure.kind !== "PERCENT" || found.kind === "PERCENT") &&
          roundsTo(figure.value, figure.precision, found.value),
      );
      if (!holds) return;
      const own = periodLabelOf(line);
      if (own !== null) {
        labels.push(own);
        return;
      }
      for (let up = at - 1; up >= 0 && up >= at - HEADING_LOOKBACK; up -= 1) {
        const above = lines[up] ?? "";
        if (!isPeriodHeading(above)) continue;
        const heading = periodLabelOf(above);
        if (heading !== null) {
          labels.push(heading);
          return;
        }
      }
    });
  }
  return labels;
}

function monthName(ym: string): string {
  const [year, month] = ym.split("-");
  const name = MONTHS[Number(month) - 1] ?? "";
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${year ?? ""}`;
}

/**
 * Live run a4b412eb (Halyard's founder, 17 Nov 2026): "£92,340 net burn
 * and 4.2 months of runway for the 12 months to October 2026" -- the
 * management accounts give both for October 2026 alone ("Summary for
 * October 2026"); only the 29.3% gross margin is for the 12 months. A
 * count check reads no period, so the phrase went out as written.
 *
 * A trailing period said of a clause's figures is held to the period the
 * sources label each figure with (its own line, else the period heading
 * above it). Where a figure's sources label it only as one month, never
 * the trailing period: when every figure the phrase covers is that same
 * month, the phrase is put right ("for October 2026"); otherwise it is
 * taken out, and the figures stand without a period the sources do not
 * give them. A figure no source labels decides nothing.
 */
function checkPeriods(
  sentence: string,
  corpus: ClaimCorpus,
  tally: CountTally,
): { readonly text: string; readonly corrected: number } {
  let text = sentence;
  let corrected = 0;
  const phrases = [...sentence.matchAll(TRAILING_PERIOD)].reverse();
  for (const phrase of phrases) {
    const groups = phrase.groups ?? {};
    const n = groups["n"] ?? "";
    const months = PERIOD_WORDS[n.toLowerCase()] ?? Number(n);
    const ym = yearMonth(groups["m"] ?? "", groups["y"] ?? "");
    if (ym === null) continue;
    const start = phrase.index;
    const clauseStart = Math.max(
      sentence.lastIndexOf(":", start),
      sentence.lastIndexOf(";", start),
      sentence.lastIndexOf("(", start),
      0,
    );
    const clause = sentence.slice(clauseStart, start);
    const covered = figuresIn(clause).filter(
      (figure) =>
        !isIncidental(clause, figure) &&
        figure.precision >= 2 &&
        !/^(?:19|20)\d{2}$/u.test(figure.text.trim()) &&
        dateKeysIn(clause.slice(figure.index, figure.end + 9)).length === 0,
    );
    if (covered.length === 0) continue;
    const verdicts = covered.map((figure) => {
      const labels = periodsOfFigure(figure, corpus).filter(
        (label) => label.kind !== "OTHER",
      );
      if (
        labels.some(
          (label) =>
            label.kind === "TRAILING" &&
            label.months === months &&
            label.ym === ym,
        )
      ) {
        return { kind: "SAID" as const };
      }
      const monthly = new Set(
        labels.flatMap((label) => (label.kind === "MONTH" ? [label.ym] : [])),
      );
      return labels.length > 0 &&
        labels.every((label) => label.kind === "MONTH") &&
        monthly.size === 1
        ? { kind: "MONTH" as const, ym: [...monthly][0] ?? "" }
        : { kind: "UNKNOWN" as const };
    });
    if (!verdicts.some((verdict) => verdict.kind === "MONTH")) continue;
    tally.examined += 1;
    tally.contradicted += 1;
    const [first] = verdicts;
    const oneMonth =
      first?.kind === "MONTH" &&
      verdicts.every(
        (verdict) => verdict.kind === "MONTH" && verdict.ym === first.ym,
      )
        ? first.ym
        : null;
    const end = start + phrase[0].length;
    const lead = /^,?\s*/u.exec(phrase[0])?.[0] ?? "";
    text =
      oneMonth === null
        ? `${text.slice(0, start)}${text.slice(end)}`
        : `${text.slice(0, start)}${lead.includes(",") ? ", " : " "}for ${monthName(oneMonth)}${text.slice(end)}`;
    corrected += 1;
    tally.corrected += 1;
  }
  return { text, corrected };
}

/**
 * A head count this sentence states that the next sentence's parts,
 * each bound to its source row (as put right), add up to: the sum is the
 * answer's own arithmetic, visible to the reader.
 */
function headCountListedNext(
  sentence: string,
  next: string | undefined,
  corpus: ClaimCorpus,
): readonly number[] {
  if (next === undefined) return [];
  const stated = totalsStatedIn(sentence);
  if (stated.length === 0) return [];
  const listed = checkCounts(next, corpus, sentence);
  if (listed.contradicted) return [];
  const parts = listedParts(listed.text);
  if (parts.length < 2) return [];
  const bound = parts.every((part) => {
    const item = countedItem(listed.text.slice(part.end));
    return (
      item !== null && bindCount(part.value, item, corpus).kind === "GROUNDED"
    );
  });
  const sum = parts.reduce((all, part) => all + part.value, 0);
  return bound && stated.includes(sum) ? [sum] : [];
}

/**
 * Whether a text states a count of a named item that the rows naming it
 * contradict (a finding is kept or dropped, never rewritten).
 */
function countsContradicted(text: string, corpus: ClaimCorpus): boolean {
  if (wordCountContradicted(text, corpus)) return true;
  if (
    periodPartsIn(text).some(
      (part) => bindPeriod(part, corpus).kind === "CONTRADICTED",
    )
  ) {
    return true;
  }
  return listedParts(text).some((figure) => {
    const item = countedItem(text.slice(figure.end));
    return (
      item !== null &&
      bindCount(figure.value, item, corpus).kind === "CONTRADICTED"
    );
  });
}

/**
 * Text Q wrote earlier (a stored summary of another conversation), its
 * counts held to this run's sources: each sentence's counts put right
 * under the answer's rule (the rows agree and the sentence recites them),
 * or the sentence left out when a count the rows contradict cannot be.
 * Counts only: nothing else in the text is checked or rewritten, and a
 * count no row names is left as written (unplaced is not contradicted).
 * The corpus must hold the text itself only as an echo, so its own words
 * never bind its counts.
 */
export function recheckCounts(
  text: string,
  corpus: ClaimCorpus,
): {
  readonly text: string;
  readonly corrected: number;
  readonly dropped: number;
} {
  let corrected = 0;
  let dropped = 0;
  const lines = text.split("\n").map((line) => {
    if (line.trim().length === 0) return line;
    const sentences = line.split(/(?<=[.!?])\s+(?=[\p{Lu}\d"“(*])/u);
    const kept: string[] = [];
    let previous = "";
    for (const sentence of sentences) {
      const counts = checkCounts(sentence, corpus, previous);
      previous = sentence;
      if (counts.contradicted || countsContradicted(counts.text, corpus)) {
        dropped += 1;
        continue;
      }
      corrected += counts.corrected;
      kept.push(counts.text);
    }
    return kept.length === 0 ? null : kept.join(" ");
  });
  return {
    text: lines
      .filter((line): line is string => line !== null)
      .join("\n")
      .trim(),
    corrected,
    dropped,
  };
}

/**
 * The total a sentence states before its colon, held to the parts it
 * lists after it: "OFF" when they do not add up to it; the total when they
 * do and each part is grounded (the sum is the sentence's own arithmetic);
 * null when the sentence states no such total.
 */
function statedTotal(text: string, corpus: ClaimCorpus): number | "OFF" | null {
  const colon = text.indexOf(":");
  if (colon <= 0 || PART_OF.test(text)) return null;
  const figures = figuresIn(text).filter(
    (figure) =>
      figure.kind === "NUMBER" &&
      Number.isInteger(figure.value) &&
      !isYear(figure),
  );
  const total = figures.find(
    (figure) =>
      figure.end <= colon &&
      (TOTAL_AFTER.test(text.slice(figure.end, colon)) ||
        TOTAL_BEFORE.test(text.slice(0, figure.index)) ||
        TOTAL_UNIT.test(text.slice(figure.end, colon))),
  );
  const parts = figures.filter(
    (figure) =>
      figure.index > colon && countedItem(text.slice(figure.end)) !== null,
  );
  if (total === undefined || parts.length < 2) return null;
  if (parts.reduce((sum, part) => sum + part.value, 0) !== total.value) {
    return "OFF";
  }
  const grounded = parts.every((part) => {
    const item = countedItem(text.slice(part.end));
    return (
      (item !== null &&
        bindCount(part.value, item, corpus).kind === "GROUNDED") ||
      directlyGrounded(part, corpus)
    );
  });
  return grounded ? total.value : null;
}

/** How a sentence is checked; every default is the answer path's. */
export interface SentenceCheckOptions {
  /** Check multi-word names too (default true). */
  readonly names?: boolean | undefined;
  /**
   * Rewrite an ungrounded figure about a named metric as Q's honest
   * unknown (default true). False removes the sentence instead: in a
   * message written for the person to the other side, or in a filed
   * document, Q's own "I don't have a sourced figure" is not theirs to say.
   */
  readonly unknownLine?: boolean | undefined;
  /**
   * The grounded figures of the sentence just before, in the same
   * paragraph: inputs a derivation here may use (never a claim's own
   * grounding), so arithmetic split over two sentences stays visible.
   */
  readonly before?: readonly Operand[] | undefined;
  /**
   * The sentence just before, in the same paragraph: a head count it
   * states ("planning to hire 15 people") is the total the next
   * sentence's parts may add up to.
   */
  readonly previous?: string | undefined;
  /**
   * The sentence just after, in the same paragraph (the whole answer's
   * check only): a head count stated here ("planning to hire 15 people")
   * is grounded when the parts it lists next, each bound to its row, add
   * up to it.
   */
  readonly next?: string | undefined;
  /**
   * Set by the check itself: the sentence's counts were bound to the
   * sources' rows, none contradicted. A name there that is a sourced name
   * run together with ordinary words ("Halyard Security Hiring Plan") is
   * grounded (nameGroundedInParts), so the sentence that answers a count
   * is not lost over how a sourced name was written.
   */
  readonly rowBound?: boolean | undefined;
}

/**
 * Check one sentence against the corpus. `said` holds the metrics already
 * said to be unknown in this answer, so the honest unknown is said once.
 */
export function checkSentence(
  sentence: string,
  corpus: ClaimCorpus,
  said: Set<string> = new Set(),
  options: SentenceCheckOptions = {},
): SentenceCheck {
  return checkOne(sentence, corpus, said, options).check;
}

/**
 * One sentence's check, with the figures it states when it is published
 * as written: the next sentence of the same paragraph may work from them
 * ("$2.4M versus $1.1M. That is about 2.2 times.").
 */
function checkOne(
  sentence: string,
  corpus: ClaimCorpus,
  said: Set<string>,
  options: SentenceCheckOptions,
  stats?: ClaimCheckStats,
): { readonly check: SentenceCheck; readonly figures: readonly Operand[] } {
  const one = checkOneCounted(sentence, corpus, said, options, stats?.counts);
  if (stats !== undefined) {
    stats.sentences += 1;
    if (one.check.text === null) stats.dropped += 1;
    else if (one.check.text !== sentence) stats.rewritten += 1;
  }
  return one;
}

function checkOneCounted(
  sentence: string,
  corpus: ClaimCorpus,
  said: Set<string>,
  options: SentenceCheckOptions,
  tally: CountTally | undefined,
): { readonly check: SentenceCheck; readonly figures: readonly Operand[] } {
  // This sentence's own tally, so whether its counts were bound to the
  // sources' rows is known here; added to the answer's tally below.
  const own = emptyCountTally();
  const merge = (): void => {
    if (tally === undefined) return;
    tally.examined += own.examined;
    tally.bound += own.bound;
    tally.contradicted += own.contradicted;
    tally.corrected += own.corrected;
    tally.unplaced += own.unplaced;
  };
  const counts = checkCounts(sentence, corpus, options.previous, own);
  if (counts.contradicted) {
    merge();
    return { check: { text: null, ungrounded: ["NUMBER"] }, figures: [] };
  }
  const rowBound = own.bound > 0 && own.contradicted === 0;
  const period = checkPeriods(counts.text, corpus, own);
  merge();
  const checked = checkClaims(
    period.text,
    corpus,
    said,
    { ...options, rowBound },
    [
      ...counts.totals,
      ...headCountListedNext(counts.text, options.next, corpus),
    ],
  );
  if (counts.corrected === 0 && period.corrected === 0) return checked;
  // Logged as what was not grounded as written; the text is put right.
  const corrected: ClaimKind[] = [
    ...Array.from({ length: counts.corrected }, (): ClaimKind => "NUMBER"),
    ...Array.from({ length: period.corrected }, (): ClaimKind => "DATE"),
  ];
  return {
    ...checked,
    check: {
      ...checked.check,
      ungrounded: [...corrected, ...checked.check.ungrounded],
    },
  };
}

function checkClaims(
  sentence: string,
  corpus: ClaimCorpus,
  said: Set<string>,
  options: SentenceCheckOptions,
  totals: readonly number[] = [],
): { readonly check: SentenceCheck; readonly figures: readonly Operand[] } {
  const claims = extractClaims(sentence).filter(
    (claim) => options.names !== false || claim.kind !== "NAME",
  );
  if (claims.length === 0) {
    return { check: { text: sentence, ungrounded: [] }, figures: [] };
  }
  const figures = claims.filter(
    (claim) =>
      claim.kind === "NUMBER" ||
      claim.kind === "MONEY" ||
      claim.kind === "PERCENT" ||
      (claim.kind === "DATE" && Number.isFinite(claim.value)),
  );
  // The inputs a derived figure may use: the sentence's own sourced
  // figures, its stated sourced durations, its stated period conversions
  // and the sentence before's figures. Every input is said, so the
  // arithmetic is visible to the reader.
  const own = figures
    .filter((figure) => directlyGrounded(figure, corpus))
    .map(operandOf);
  const calendar = calendarOperandsIn(sentence);
  const inputs: Operand[] = [
    ...own,
    ...durationInputsIn(sentence, corpus).map(plainOperand),
    ...periodFactorsIn(sentence).map(plainOperand),
    ...calendar.map(plainOperand),
    ...(options.before ?? []),
  ];
  const ungrounded: ClaimKind[] = [];
  for (const claim of claims) {
    const ok =
      claim.kind === "NAME"
        ? nameGrounded(claim.text, corpus) ||
          (options.rowBound === true && nameGroundedInParts(claim.text, corpus))
        : Number.isFinite(claim.value)
          ? (claim.kind === "NUMBER" &&
              (calendar.includes(claim.value) ||
                totals.includes(claim.value))) ||
            figureGrounded(claim, corpus, inputs, afterClaim(sentence, claim))
          : claim.text.startsWith("time:")
            ? corpus.minutes.has(claim.text.slice("time:".length))
            : corpus.dates.has(claim.text) ||
              // A month without a day matches a source with that day.
              [...corpus.dates].some((key) => key.startsWith(`${claim.text}-`));
    if (!ok) ungrounded.push(claim.kind);
  }
  if (ungrounded.length === 0) {
    return {
      check: { text: sentence, ungrounded },
      figures: figures.map(operandOf),
    };
  }
  // A name we cannot ground is removed; a figure becomes an honest unknown
  // about its metric when there is one, said once.
  const metric =
    ungrounded.includes("NAME") || options.unknownLine === false
      ? null
      : metricOf(sentence);
  if (
    metric === null ||
    said.has(metric) ||
    sourcesNameMetric(metric, corpus)
  ) {
    return { check: { text: null, ungrounded }, figures: [] };
  }
  said.add(metric);
  return {
    check: {
      text: `Neither Capital Q's records nor the sources I read give a figure for ${metric} yet.`,
      ungrounded,
    },
    figures: [],
  };
}

/** Said when nothing of an answer could be grounded; states no fact. */
export const NOTHING_SOURCED =
  "I don't have a sourced answer to that in what I can see yet.";

/**
 * What a check did over an answer, for its diagnostic line: sentences
 * checked, dropped and rewritten, the count checks' tally, and what the
 * corpus held. Numbers only: no figure, wording or source text.
 */
export type ClaimCheckStats = {
  sentences: number;
  dropped: number;
  rewritten: number;
  counts: CountTally;
};

export const emptyClaimCheckStats = (): ClaimCheckStats => ({
  sentences: 0,
  dropped: 0,
  rewritten: 0,
  counts: emptyCountTally(),
});

/** What a corpus held, by kind, for the diagnostic line. */
export function corpusShape(corpus: ClaimCorpus): {
  readonly sources: number;
  readonly tables: number;
  readonly quarters: number;
} {
  let tables = 0;
  for (const own of corpus.sourceLines) {
    if (!own.some((line) => line.includes("|"))) continue;
    tables += documentTables(own.join("\n")).length;
  }
  return {
    sources: corpus.sourceLines.length,
    tables,
    quarters: corpus.periodCounts.size,
  };
}

/** A claim check for one answer: the streamed sentences and its stored text. */
export interface ClaimChecker {
  sentence(sentence: string): SentenceCheck;
  /**
   * Whether a text (a finding about to be shown) states a count the
   * sources' rows or tables contradict, against the current corpus.
   */
  contradictsCounts(text: string): boolean;
  /** What the streamed sentences' checks did so far, and the corpus's shape. */
  stats(): ClaimCheckStats & {
    readonly corpus: ReturnType<typeof corpusShape>;
  };
}

/**
 * One answer's checker. `sources` is read on each sentence, because a tool
 * round adds its results between sentences of a long turn; the corpus is
 * rebuilt only when what it returns has changed.
 */
export function createClaimChecker(
  sources: () => readonly string[],
  today: Date = new Date(),
  /** Q's own earlier words (claimCorpus `echoes`). */
  echoes: () => readonly string[] = () => [],
): ClaimChecker {
  let key: readonly string[] | null = null;
  let corpus: ClaimCorpus | null = null;
  const said = new Set<string>();
  // The sentence just before, while the paragraph goes on.
  let before: readonly Operand[] = [];
  let previous = "";
  const current = (): ClaimCorpus => {
    const now = [...sources(), "\u0000", ...echoes()];
    if (
      corpus === null ||
      key === null ||
      key.length !== now.length ||
      key.some((source, index) => source !== now[index])
    ) {
      key = now;
      const split = now.indexOf("\u0000");
      corpus = claimCorpus(now.slice(0, split), today, now.slice(split + 1));
    }
    return corpus;
  };
  const stats = emptyClaimCheckStats();
  return {
    contradictsCounts: (text) => countsContradicted(text, current()),
    stats: () => ({ ...stats, corpus: corpusShape(current()) }),
    sentence: (sentence) => {
      const checked = checkOne(
        sentence,
        current(),
        said,
        { before, previous },
        stats,
      );
      // A paragraph break ends what the next sentence may work from.
      const ends = /\n\s*$/u.test(sentence);
      before = ends ? [] : checked.figures;
      previous = ends ? "" : sentence;
      return checked.check;
    },
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
): {
  readonly text: string;
  readonly ungrounded: readonly ClaimKind[];
  readonly stats: ClaimCheckStats;
} {
  const stats = emptyClaimCheckStats();
  const said = new Set<string>();
  const ungrounded: ClaimKind[] = [];
  const lines = answer.split("\n").map((line) => {
    if (line.trim().length === 0) return line;
    const lead = /^\s*(?:[-*•]|\d+[.)])\s+/u.exec(line)?.[0] ?? "";
    const body = line.slice(lead.length);
    const sentences = body.split(/(?<=[.!?])\s+(?=[\p{Lu}\d"“(*])/u);
    const kept: string[] = [];
    let before: readonly Operand[] = [];
    let previous = "";
    for (const [at, sentence] of sentences.entries()) {
      const one = checkOne(
        sentence,
        corpus,
        said,
        { before, previous, next: sentences[at + 1] },
        stats,
      );
      const checked = one.check;
      before = one.figures;
      previous = sentence;
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
    stats,
  };
}

/**
 * Every figure `text` states is grounded in `corpus`. The extras' join
 * (parallel-extras.ts) uses it for findings, the same matcher the answer's
 * sentences go through.
 */
export function figuresGrounded(text: string, corpus: ClaimCorpus): boolean {
  // A count of a named item the rows naming it contradict (live
  // e7e3c866: "4 public-sector account managers" as a finding).
  if (countsContradicted(text, corpus)) return false;
  const figures = figuresIn(text).filter(
    (figure) => !isIncidental(text, figure),
  );
  const inputs = figures
    .filter((figure) => directlyGrounded(figure, corpus))
    .map(operandOf);
  return figures.every((figure) =>
    figureGrounded(figure, corpus, inputs, text.slice(figure.end)),
  );
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

/** What `groundText` kept of a text, and what it took out. */
export interface GroundedText {
  readonly text: string;
  /** The kinds of the claims that were not grounded; values withheld. */
  readonly ungrounded: readonly ClaimKind[];
  /** Sentences removed or rewritten. */
  readonly changed: number;
}

/**
 * Any text Q wrote outside a live answer (Q Intelligence Plan, step 10:
 * a workforce message, a filed document), sentence by sentence against
 * what the work was given, keeping its line breaks and list markers.
 * Unlike `checkAnswer` it never substitutes `NOTHING_SOURCED`: nothing
 * left is an empty text, for the caller to hold. `exempt` keeps a sentence
 * that is not stated as fact (a labelled estimate or Q's inference, which
 * carries its own truth class).
 */
export function groundText(
  text: string,
  corpus: ClaimCorpus,
  options: SentenceCheckOptions & {
    readonly exempt?: ((sentence: string) => boolean) | undefined;
  } = {},
): GroundedText {
  const said = new Set<string>();
  const ungrounded: ClaimKind[] = [];
  let changed = 0;
  const lines = text.split("\n").map((line) => {
    if (line.trim().length === 0) return line;
    const lead = /^\s*(?:[-*•]|\d+[.)])\s+/u.exec(line)?.[0] ?? "";
    const body = line.slice(lead.length);
    const sentences = body.split(/(?<=[.!?])\s+(?=[\p{Lu}\d"“(*])/u);
    const kept: string[] = [];
    for (const sentence of sentences) {
      if (options.exempt?.(sentence) === true) {
        kept.push(sentence);
        continue;
      }
      const checked = checkSentence(sentence, corpus, said, options);
      ungrounded.push(...checked.ungrounded);
      if (checked.text !== sentence) changed += 1;
      if (checked.text !== null) kept.push(checked.text);
    }
    return kept.length === 0 ? null : `${lead}${kept.join(" ")}`;
  });
  return {
    text: lines
      .filter((line): line is string => line !== null)
      .join("\n")
      .replace(/\n{3,}/gu, "\n\n")
      .trim(),
    ungrounded,
    changed,
  };
}

/**
 * A rendered prompt message without its template's own words: what is
 * left is the values put into it (the facts, the conversation, Capital
 * Q's turn notes). Q Intelligence Plan, step 10: the answer prompt's
 * instructions carry figures of their own ("7.5/10 · Good fit", "at most
 * three"), and with the whole task message among the claim check's
 * sources, a founder-private runway of 7.5 months invented by a model
 * that obeyed a planted instruction was "sourced" by the instructions.
 * A rendering that does not follow its template is returned whole (the
 * check's earlier behaviour), so a mismatch never drops a real source.
 */
export function templateValues(content: string, template: string): string {
  const chunks = template
    .split(/\{\{\w+\}\}/u)
    .filter((chunk) => chunk.length > 0);
  let out = "";
  let at = 0;
  for (const chunk of chunks) {
    const found = content.indexOf(chunk, at);
    if (found === -1) return content;
    out += `${content.slice(at, found)}\n`;
    at = found + chunk.length;
  }
  return out + content.slice(at);
}

/**
 * Whether a text states a count of a named item, of a quarter, or a head
 * count, in digits or in words: what only a check against the document's
 * rows may let through (conversation-recall.ts).
 */
export function statesCounts(text: string): boolean {
  return (
    periodPartsIn(text).length > 0 ||
    listedParts(text).length > 0 ||
    countFiguresIn(text).some((figure) =>
      TOTAL_UNIT.test(text.slice(figure.end)),
    )
  );
}
