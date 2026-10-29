import {
  registrableDomain,
  type PrimaryKind,
  type SourceTier,
} from "./source-tier.js";

/**
 * Cross-source validation, in code (owner 2026-10-29). A model proposes
 * facts from pages; whether two of them agree, disagree or are out of date
 * is arithmetic and dates, decided here and never by a model.
 *
 *   Corroboration   two facts about the same measure, entity and period,
 *                   whose figures agree (within rounding), from INDEPENDENT
 *                   publishers -- registrable domains, with syndicated copies
 *                   (one story under the same title on several sites)
 *                   counted once. Both become MULTI_SOURCE_SUPPORTED.
 *   Contradiction   the same measure, entity and period, figures that do
 *                   not agree. Both are kept, each lifecycle CONTRADICTORY,
 *                   each naming the other: never the favourable number.
 *   Staleness       a fact older than its line of enquiry's horizon (news
 *                   moves in months, a market size in years) is STALE. An
 *                   undated fact is not stale: unknown stays unknown.
 *
 * ADR-001 axes stay separate: evidence_status (SELF_REPORTED for a
 * company's own disclosure, DOCUMENT_SUPPORTED, MULTI_SOURCE_SUPPORTED) and
 * lifecycle_status (CURRENT, CONTRADICTORY, STALE). Truth class is not
 * decided here: a public page's statement is never VERIFIED by Capital Q.
 */

export type CheckableFact = {
  readonly id: string;
  readonly statement: string;
  readonly figure: string | null;
  readonly asOf: string | null;
  readonly source: number;
  readonly lane: string;
  readonly kind: string;
  readonly domain: string;
  readonly title: string | null;
  readonly publishedAt: string | null;
  /** What is measured ("market size"), as the reader labelled it; a hint. */
  readonly measure?: string | null | undefined;
  /** What it is about ("Nigeria B2B payments"), as labelled; a hint. */
  readonly entity?: string | null | undefined;
  readonly tier: SourceTier;
  readonly tierKind: PrimaryKind | null;
};

export const CHECKED_EVIDENCE_STATUSES = [
  "SELF_REPORTED",
  "DOCUMENT_SUPPORTED",
  "MULTI_SOURCE_SUPPORTED",
] as const;
export type CheckedEvidenceStatus = (typeof CHECKED_EVIDENCE_STATUSES)[number];

export const CHECKED_LIFECYCLE_STATUSES = [
  "CURRENT",
  "CONTRADICTORY",
  "STALE",
] as const;
export type CheckedLifecycleStatus =
  (typeof CHECKED_LIFECYCLE_STATUSES)[number];

export type CrossChecked<F extends CheckableFact = CheckableFact> = F & {
  readonly evidenceStatus: CheckedEvidenceStatus;
  readonly lifecycleStatus: CheckedLifecycleStatus;
  /** Facts from independent publishers that agree with it. */
  readonly corroboratedBy: readonly string[];
  /** Facts about the same measure and period whose figures disagree. */
  readonly contradicts: readonly string[];
  /** Whether a date (its period, else its page's) is known. */
  readonly dated: boolean;
};

/** Relative difference within which two figures are the same number rounded. */
export const AGREEMENT_TOLERANCE = 0.05;
/** Word overlap above which two statements are about the same thing. */
export const SAME_MEASURE_OVERLAP = 0.6;

// ---------------------------------------------------------------------------
// Figures
// ---------------------------------------------------------------------------

export type ParsedFigure = {
  readonly value: number;
  /** "%", a currency code, or "COUNT". */
  readonly unit: string;
};

const CURRENCY_SYMBOLS: Readonly<Record<string, string>> = {
  $: "USD",
  US$: "USD",
  "€": "EUR",
  "£": "GBP",
  "₦": "NGN",
  "₹": "INR",
  "¥": "JPY",
};
const SCALE: Readonly<Record<string, number>> = {
  k: 1e3,
  thousand: 1e3,
  m: 1e6,
  mn: 1e6,
  mln: 1e6,
  million: 1e6,
  b: 1e9,
  bn: 1e9,
  billion: 1e9,
  tn: 1e12,
  trillion: 1e12,
};

const FIGURE_PATTERN =
  /(US\$|[$€£₦₹¥]|\b[A-Z]{3}\b|\bKSh\b)?\s?(\d[\d,]*(?:\.\d+)?)\s?(%|per ?cent\b|percent\b|trillion\b|billion\b|million\b|thousand\b|tn\b|bn\b|mn\b|mln\b|[kmb]\b)?/u;

/**
 * The figure a fact turns on, as a value and a unit. Null when it has no
 * number, or only a year. Never converts between currencies.
 */
export function parseFigure(text: string | null): ParsedFigure | null {
  if (text === null) return null;
  const pattern = new RegExp(FIGURE_PATTERN.source, "gu");
  for (const match of text.matchAll(pattern)) {
    const raw = match[2] ?? "";
    const symbol = match[1];
    const suffix = (match[3] ?? "").toLowerCase().replace(/\s/gu, "");
    const value = Number(raw.replace(/,/gu, ""));
    if (!Number.isFinite(value)) continue;
    // A bare year is a date, not a figure.
    if (
      symbol === undefined &&
      suffix === "" &&
      /^(?:19|20)\d{2}$/u.test(raw)
    ) {
      continue;
    }
    if (suffix === "%" || suffix.startsWith("per")) {
      return { value, unit: "%" };
    }
    const scaled = value * (SCALE[suffix] ?? 1);
    const currency =
      symbol === undefined
        ? null
        : symbol === "KSh"
          ? "KES"
          : (CURRENCY_SYMBOLS[symbol] ?? symbol.toUpperCase());
    return { value: scaled, unit: currency ?? "COUNT" };
  }
  return null;
}

/** Whether two figures of one unit are the same number, allowing rounding. */
export function figuresAgree(a: ParsedFigure, b: ParsedFigure): boolean {
  if (a.unit !== b.unit) return false;
  const largest = Math.max(Math.abs(a.value), Math.abs(b.value));
  if (largest === 0) return true;
  return Math.abs(a.value - b.value) / largest <= AGREEMENT_TOLERANCE;
}

// ---------------------------------------------------------------------------
// Measure, period, independence
// ---------------------------------------------------------------------------

const MONTHS =
  "january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec";
const NOISE = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "that",
  "this",
  "its",
  "was",
  "were",
  "are",
  "has",
  "had",
  "have",
  "been",
  "will",
  "into",
  "about",
  "according",
  "reached",
  "reaches",
  "estimated",
  "estimate",
  "estimates",
  "valued",
  "worth",
  "stood",
  "around",
  "approximately",
  "nearly",
  "over",
  "more",
  "than",
  "less",
  "some",
  "per",
  "cent",
  "percent",
  "million",
  "billion",
  "trillion",
  "thousand",
  "year",
  "years",
  "said",
  "says",
  "reported",
  "report",
  "total",
  "also",
  "which",
  "while",
  "their",
  "they",
]);

/** The words that say what a statement is about. */
export function measureWords(statement: string): ReadonlySet<string> {
  return new Set(
    statement
      .toLowerCase()
      .replace(new RegExp(`\\b(?:${MONTHS})\\b`, "gu"), " ")
      .split(/[^\p{L}\p{N}]+/u)
      .filter(
        (word) =>
          word.length >= 3 &&
          !/^\d/u.test(word) &&
          !NOISE.has(word) &&
          !["usd", "eur", "gbp", "ngn", "kes", "zar", "inr"].includes(word),
      ),
  );
}

function overlap(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  return shared / (a.size + b.size - shared);
}

/** "Q2 2025" -> "q2 2025"; "2023" -> "2023"; nothing datable -> null. */
export function periodKey(asOf: string | null): string | null {
  if (asOf === null) return null;
  const text = asOf.toLowerCase();
  const years = [...text.matchAll(/\b(?:19|20)\d{2}\b/gu)].map((m) => m[0]);
  if (years.length === 0) return null;
  const part = /\b(q[1-4]|h[12])\b/u.exec(text)?.[1] ?? "";
  return [part, ...[...new Set(years)].sort()]
    .filter((p) => p !== "")
    .join(" ");
}

function hintKey(fact: CheckableFact): string | null {
  const norm = (text: string | null | undefined) =>
    (text ?? "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  const measure = norm(fact.measure);
  const entity = norm(fact.entity);
  return measure.length === 0 || entity.length === 0
    ? null
    : `${entity}|${measure}`;
}

/**
 * Whether two facts are about the same measure of the same thing in the
 * same period. The reader's labels decide when both carry them; otherwise
 * their statements must share most of their words, within one line of
 * enquiry. Never compares across periods: 2021's figure is not 2024's.
 */
export function sameMeasure(a: CheckableFact, b: CheckableFact): boolean {
  if (periodKey(a.asOf) !== periodKey(b.asOf)) return false;
  const ka = hintKey(a);
  const kb = hintKey(b);
  if (ka !== null && kb !== null) return ka === kb;
  if (a.lane !== b.lane) return false;
  return (
    overlap(measureWords(a.statement), measureWords(b.statement)) >=
    SAME_MEASURE_OVERLAP
  );
}

function normalTitle(title: string | null): string | null {
  if (title === null) return null;
  const text = title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  return text.length >= 20 ? text : null;
}

/**
 * Independent publishers: each source's registrable domain, and sources
 * that carry the same story under the same title on different sites
 * (syndication, a press release republished) are one publisher.
 */
export function independenceKeys(
  facts: readonly Pick<CheckableFact, "source" | "domain" | "title">[],
): ReadonlyMap<number, string> {
  const parent = new Map<string, string>();
  const find = (key: string): string => {
    let at = key;
    for (;;) {
      const up = parent.get(at) ?? at;
      if (up === at) return at;
      at = up;
    }
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb);
  };
  const byTitle = new Map<string, string>();
  for (const fact of facts) {
    const publisher = `d:${registrableDomain(fact.domain)}`;
    if (!parent.has(publisher)) parent.set(publisher, publisher);
    const title = normalTitle(fact.title);
    if (title === null) continue;
    const seen = byTitle.get(title);
    if (seen === undefined) byTitle.set(title, publisher);
    else union(seen, publisher);
  }
  const keys = new Map<number, string>();
  for (const fact of facts) {
    keys.set(fact.source, find(`d:${registrableDomain(fact.domain)}`));
  }
  return keys;
}

// ---------------------------------------------------------------------------
// Staleness
// ---------------------------------------------------------------------------

/**
 * How long a fact of this line of enquiry stays current, in months.
 * News, deals and funding move in months; regulation in a year or two;
 * a market's size or a competitor set in a few years.
 */
export function horizonMonths(lane: string, kind: string): number {
  const text = `${lane} ${kind}`.toUpperCase();
  if (/NEWS|DEVELOPMENT|FUNDING|DEAL|ROUND|ANNOUNCE/u.test(text)) return 18;
  if (
    /REGULAT|POLICY|LICEN|COMPLIANCE|LEGAL|ENFORCE|RISK|LITIGATION/u.test(text)
  )
    return 24;
  if (
    /MARKET|SIZE|DEMAND|GROWTH|ADOPTION|VOLUME|FIGURE|TREND|COMPETITOR|PRICING|ECONOMICS/u.test(
      text,
    )
  )
    return 36;
  return 60;
}

/** When the fact was true: its period's last year, else its page's date. */
export function factDate(
  fact: Pick<CheckableFact, "asOf" | "publishedAt">,
): Date | null {
  const years = [...(fact.asOf ?? "").matchAll(/\b(?:19|20)\d{2}\b/gu)].map(
    (m) => Number(m[0]),
  );
  if (years.length > 0) {
    // The end of the latest year it names: the most generous reading.
    return new Date(Date.UTC(Math.max(...years), 11, 31));
  }
  if (fact.publishedAt !== null) {
    const time = Date.parse(fact.publishedAt);
    if (!Number.isNaN(time)) return new Date(time);
  }
  return null;
}

export function isStale(
  fact: Pick<CheckableFact, "asOf" | "publishedAt" | "lane" | "kind">,
  today: Date,
): boolean {
  const date = factDate(fact);
  if (date === null) return false;
  const months =
    (today.getUTCFullYear() - date.getUTCFullYear()) * 12 +
    (today.getUTCMonth() - date.getUTCMonth());
  return months > horizonMonths(fact.lane, fact.kind);
}

// ---------------------------------------------------------------------------
// The check
// ---------------------------------------------------------------------------

export function crossCheck<F extends CheckableFact>(
  facts: readonly F[],
  today: Date,
): readonly CrossChecked<F>[] {
  const keys = independenceKeys(facts);
  const figures = facts.map(
    (fact) => parseFigure(fact.figure ?? null) ?? parseFigure(fact.statement),
  );
  const corroborated = facts.map(() => new Set<string>());
  const contradicted = facts.map(() => new Set<string>());
  for (let i = 0; i < facts.length; i += 1) {
    for (let j = i + 1; j < facts.length; j += 1) {
      const a = facts[i];
      const b = facts[j];
      if (a === undefined || b === undefined) continue;
      if (!sameMeasure(a, b)) continue;
      const fa = figures[i] ?? null;
      const fb = figures[j] ?? null;
      const independent = keys.get(a.source) !== keys.get(b.source);
      if (fa !== null && fb !== null) {
        // Different units are different measures (a share is not an amount).
        if (fa.unit !== fb.unit) continue;
        if (figuresAgree(fa, fb)) {
          if (independent) {
            corroborated[i]?.add(b.id);
            corroborated[j]?.add(a.id);
          }
        } else {
          contradicted[i]?.add(b.id);
          contradicted[j]?.add(a.id);
        }
      } else if (fa === null && fb === null && independent) {
        // Statements without figures can agree; code cannot say they
        // disagree, so they never contradict.
        corroborated[i]?.add(b.id);
        corroborated[j]?.add(a.id);
      }
    }
  }
  return facts.map((fact, index) => {
    const by = [...(corroborated[index] ?? [])];
    const against = [...(contradicted[index] ?? [])];
    const evidenceStatus: CheckedEvidenceStatus =
      by.length > 0
        ? "MULTI_SOURCE_SUPPORTED"
        : fact.tierKind === "COMPANY_DISCLOSURE"
          ? "SELF_REPORTED"
          : "DOCUMENT_SUPPORTED";
    const lifecycleStatus: CheckedLifecycleStatus =
      against.length > 0
        ? "CONTRADICTORY"
        : isStale(fact, today)
          ? "STALE"
          : "CURRENT";
    return {
      ...fact,
      evidenceStatus,
      lifecycleStatus,
      corroboratedBy: by,
      contradicts: against,
      dated: factDate(fact) !== null,
    };
  });
}

// ---------------------------------------------------------------------------
// Open questions: what the next round looks for
// ---------------------------------------------------------------------------

export const GAP_REASONS = [
  "NO_FACT",
  "COULD_NOT_RUN",
  "CONTRADICTORY",
  "STALE_ONLY",
  "NO_PRIMARY_SOURCE",
] as const;
export type GapReason = (typeof GAP_REASONS)[number];

export type OpenGap = {
  readonly lane: string;
  readonly reason: GapReason;
};

/**
 * Lines of enquiry where a primary source is expected: regulation,
 * licensing, filings and registries are made by an official body, so a
 * press account of them alone is a gap.
 */
export function wantsPrimary(lane: string): boolean {
  return /REGULAT|POLICY|LICEN|COMPLIANCE|LEGAL|ENFORCE|LITIGATION|FILING|REGISTR|GOVERN|CENTRAL_BANK|GAZETTE|STATISTIC/u.test(
    lane.toUpperCase(),
  );
}

/**
 * The open questions after a round, in code: a planned line with no
 * admitted fact (or that could not run), facts that contradict, a line
 * whose facts are all stale, a line that wants a primary source and has
 * none. A line already tried `maxTries` times is not reopened: the report
 * says what stayed open instead of the loop spending on it again.
 */
export function openGaps(input: {
  readonly lanes: readonly {
    readonly lane: string;
    readonly ran: boolean;
    readonly primary: boolean;
  }[];
  readonly facts: readonly CrossChecked[];
  readonly tries: ReadonlyMap<string, number>;
  readonly maxTries: number;
}): readonly OpenGap[] {
  const gaps: OpenGap[] = [];
  for (const line of input.lanes) {
    if ((input.tries.get(line.lane) ?? 0) >= input.maxTries) continue;
    const facts = input.facts.filter((fact) => fact.lane === line.lane);
    if (facts.length === 0) {
      gaps.push({
        lane: line.lane,
        reason: line.ran ? "NO_FACT" : "COULD_NOT_RUN",
      });
      continue;
    }
    if (facts.some((fact) => fact.lifecycleStatus === "CONTRADICTORY")) {
      gaps.push({ lane: line.lane, reason: "CONTRADICTORY" });
      continue;
    }
    // Every fact it has is out of date (an undated fact is not stale).
    if (facts.every((fact) => fact.lifecycleStatus === "STALE")) {
      gaps.push({ lane: line.lane, reason: "STALE_ONLY" });
      continue;
    }
    if (
      (line.primary || wantsPrimary(line.lane)) &&
      !facts.some(
        (fact) =>
          fact.tier === "PRIMARY" && fact.tierKind !== "COMPANY_DISCLOSURE",
      )
    ) {
      gaps.push({ lane: line.lane, reason: "NO_PRIMARY_SOURCE" });
    }
  }
  return gaps;
}

/** A gap as the planner reads it (and as a report states what stayed open). */
export function gapText(gap: OpenGap): string {
  switch (gap.reason) {
    case "NO_FACT":
      return `${gap.lane}: searched, but no page gave a usable sourced fact`;
    case "COULD_NOT_RUN":
      return `${gap.lane}: could not be searched (the search provider did not answer)`;
    case "CONTRADICTORY":
      return `${gap.lane}: sources disagree; look for the primary source or a third independent one`;
    case "STALE_ONLY":
      return `${gap.lane}: only out-of-date facts so far; look for the latest figures or publications`;
    case "NO_PRIMARY_SOURCE":
      return `${gap.lane}: no primary source yet; look for the regulator's, registry's or official publication`;
  }
}

/**
 * What public search cannot establish about private markets, whatever was
 * found (owner 2026-10-29): stated by code in every investigation report.
 */
export const PUBLIC_SEARCH_LIMITS: readonly string[] = [
  "Private companies' revenue, margins, burn and unit economics: not public unless filed with a registry or regulator; any figure here is the company's or the press's claim.",
  "Beneficial ownership and cap tables: not established by press coverage; only an official registry or the company's own filings show them, and many markets do not publish them.",
  "Actual fund commitments and deal terms: announced rounds and fund sizes are claims; what investors committed, on what terms, is not public.",
  "Regulatory standing in progress: licence applications, supervisory findings and enforcement not yet published by the regulator are not visible to public search.",
  "Customer contracts, pipeline and retention: not public; only what a company or its customers chose to announce.",
];
