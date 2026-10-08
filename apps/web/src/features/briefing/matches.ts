import type {
  DiscoveredCompanyDto,
  FitBand,
  FitParameter,
  FitProfileDto,
} from "@capital-q/contracts";

/**
 * Investor arrival (audit E-02; Zino 2026-10-08: "as an investor it
 * notices new companies that meet my mandate, tells me all of them and
 * gives its opinion"). The companies come from their own precomputed
 * slate (deterministic, declared-mandate ranking); Q's take is written by
 * code from the fit profile's own reasons and unknowns. No model, no
 * number, no percentage: fit with a mandate is said as fit, never as a
 * view on the business (Fit ≠ Business Quality).
 */

export const ARRIVAL_MATCHES_MAX = 6;

export type ArrivalMatch = {
  readonly companyId: string;
  readonly name: string;
  readonly line: string | null;
  readonly stage: string | null;
  /** ISO alpha-2 head-office country, as the company states it. */
  readonly country: string | null;
  readonly band: FitBand | null;
  /** Q's take, in words, from the fit profile (or the slate's reasons). */
  readonly take: string;
};

export type ArrivalMatches = {
  /**
   * SINCE_LAST_VISIT: this browser knows what they were shown before.
   * NOT_LOOKED_AT: it does not, so nothing is claimed about "new".
   */
  readonly label: "SINCE_LAST_VISIT" | "NOT_LOOKED_AT";
  readonly items: readonly ArrivalMatch[];
  /** How many there are in all (items are the first few). */
  readonly total: number;
};

/**
 * Slate companies they have not acted on (no relationship, not saved) and,
 * when this browser remembers what it showed before, not shown yet. The
 * slate's own order is kept: it is the ranking.
 */
export function newMatchesFor(input: {
  readonly items: readonly DiscoveredCompanyDto[];
  /** Companies they already have a relationship with. */
  readonly touched: ReadonlySet<string>;
  /** Shown in an earlier arrival on this browser; null: not known. */
  readonly seen: ReadonlySet<string> | null;
}): readonly DiscoveredCompanyDto[] {
  return input.items.filter(
    (item) =>
      !input.touched.has(item.companyId) &&
      item.viewerSaved !== true &&
      (input.seen === null || !input.seen.has(item.companyId)),
  );
}

const PARAMETER_WORDS: Readonly<Record<FitParameter, string>> = {
  STAGE: "stage",
  SECTOR: "sector",
  GEOGRAPHY: "geography",
  CHEQUE_SIZE: "cheque size",
  BUSINESS_MODEL: "business model",
  TRACTION: "traction",
  TEAM: "team",
  THESIS: "thesis",
  ROUND_TERMS: "round terms",
};

const BAND_WORDS: Readonly<Record<FitBand, string>> = {
  STRONG_FIT: "A strong fit with your mandate",
  GOOD_FIT: "A good fit with your mandate",
  PARTIAL_FIT: "A partial fit with your mandate",
  WEAK_FIT: "A weak fit with your mandate",
  NOT_ENOUGH_INFORMATION: "Not enough is known yet to say how well it fits",
  OUTSIDE_MANDATE: "Outside one of the rules you declared",
};

const REASON_WORDS: Readonly<Record<string, string>> = {
  STAGE_IN_RANGE: "stage",
  SECTOR_MATCH: "sector",
  GEOGRAPHY_MATCH: "geography",
  BUSINESS_MODEL_MATCH: "business model",
  CUSTOMER_TYPE_MATCH: "customer type",
};

function list(words: readonly string[]): string {
  if (words.length <= 1) return words[0] ?? "";
  return `${words.slice(0, -1).join(", ")} and ${words.at(-1) ?? ""}`;
}

function capital(text: string): string {
  return text.length === 0
    ? text
    : `${text[0]?.toUpperCase() ?? ""}${text.slice(1)}`;
}

/** The closing every take carries: fit is not a view on the business. */
export const FIT_IS_NOT_QUALITY =
  "That's fit with your mandate, not a judgement of the business.";

/** Q's take on one new match, from what was computed, never invented. */
export function matchOpinion(input: {
  readonly profile: FitProfileDto | null;
  readonly reasons: DiscoveredCompanyDto["reasons"];
}): string {
  const profile = input.profile;
  if (profile === null) {
    const matched = [
      ...new Set(
        input.reasons
          .map((reason) => REASON_WORDS[reason.kind])
          .filter((word): word is string => word !== undefined),
      ),
    ];
    const why =
      matched.length === 0
        ? "It's in your feed under your mandate."
        : `It's in your feed because it matches your mandate on ${list(matched)}.`;
    return `${why} I haven't worked out the full fit yet. ${FIT_IS_NOT_QUALITY}`;
  }
  const by = (outcome: string) =>
    profile.parameters
      .filter((one) => one.applicable && one.outcome === outcome)
      .map((one) => PARAMETER_WORDS[one.parameter]);
  const strong = by("STRONG");
  const partial = by("PARTIAL");
  const misses = by("MISMATCH");
  const unknown = by("UNKNOWN");
  const parts: string[] = [];
  const lines: string[] = [];
  if (strong.length > 0) lines.push(`lines up on ${list(strong.slice(0, 3))}`);
  if (partial.length > 0 && lines.length < 2) {
    lines.push(`partly on ${list(partial.slice(0, 2))}`);
  }
  if (misses.length > 0) lines.push(`misses on ${list(misses.slice(0, 2))}`);
  parts.push(
    lines.length === 0
      ? `${BAND_WORDS[profile.band]}.`
      : `${BAND_WORDS[profile.band]}: it ${list(lines)}.`,
  );
  if (unknown.length > 0) {
    const named = unknown.slice(0, 2);
    parts.push(
      `${capital(list(named))} ${named.length === 1 ? "isn't" : "aren't"} known yet.`,
    );
  }
  parts.push(FIT_IS_NOT_QUALITY);
  return parts.join(" ");
}

const BAND_ORDER: readonly FitBand[] = [
  "STRONG_FIT",
  "GOOD_FIT",
  "PARTIAL_FIT",
  "WEAK_FIT",
  "NOT_ENOUGH_INFORMATION",
  "OUTSIDE_MANDATE",
];

const NUMBER_WORDS = [
  "No",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
];

/** What Q says about the new matches, all of them by name (up to six). */
export function matchesWords(matches: ArrivalMatches | null): string | null {
  if (matches === null || matches.items.length === 0) return null;
  const count =
    matches.total <= 10
      ? (NUMBER_WORDS[matches.total] ?? String(matches.total))
      : String(matches.total);
  const fresh = matches.label === "SINCE_LAST_VISIT" ? "new " : "";
  const head =
    matches.total === 1
      ? `${matches.label === "SINCE_LAST_VISIT" ? "A new company" : "One company in your feed"} fits your mandate: ${matches.items[0]?.name ?? ""}.`
      : `${count} ${fresh}companies in your feed fit your mandate: ${list(matches.items.map((item) => item.name))}${matches.total > matches.items.length ? ", and more" : ""}.`;
  // The best fit, by the platform's band, only when it is a real fit.
  const best = [...matches.items].sort(
    (a, b) =>
      BAND_ORDER.indexOf(a.band ?? "NOT_ENOUGH_INFORMATION") -
      BAND_ORDER.indexOf(b.band ?? "NOT_ENOUGH_INFORMATION"),
  )[0];
  const strongest =
    best !== undefined &&
    matches.items.length > 1 &&
    (best.band === "STRONG_FIT" || best.band === "GOOD_FIT")
      ? `${best.name} fits best. ${best.take.split(". ")[0]?.replace(/\.$/u, "") ?? ""}.`
      : null;
  return [head, strongest].filter((part) => part !== null).join(" ");
}

const SEEN_KEY = "cq.arrival.seen-matches";
const SEEN_MAX = 200;

/** What earlier arrivals on this browser showed; null: none remembered. */
export function readSeenMatches(): ReadonlySet<string> | null {
  try {
    const raw = window.localStorage.getItem(SEEN_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? new Set(parsed.filter((id): id is string => typeof id === "string"))
      : null;
  } catch {
    return null;
  }
}

/** Remembers what this arrival showed (a per-browser convenience only). */
export function rememberSeenMatches(ids: readonly string[]): void {
  try {
    const before = readSeenMatches() ?? new Set<string>();
    const next = [...new Set([...ids, ...before])].slice(0, SEEN_MAX);
    window.localStorage.setItem(SEEN_KEY, JSON.stringify(next));
  } catch {
    // Not remembered: the next arrival says "in your feed", not "new".
  }
}
