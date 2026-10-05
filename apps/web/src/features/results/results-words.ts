import type { ResultsActivity } from "@capital-q/contracts";

/**
 * Words and small sums for the Results dashboard. Pure: every figure on
 * the page comes from the Results read as recorded; nothing here invents
 * one, and an unknown stays a word ("No answers yet"), never a 0.
 */

/** The periods offered; older links (90d, 12m) still read. */
export const RESULTS_PERIODS = [
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "all", label: "All time" },
] as const;

export const KNOWN_RANGES = ["7d", "30d", "90d", "12m", "all"] as const;
export type KnownRange = (typeof KNOWN_RANGES)[number];

export function rangeOf(value: string | undefined): KnownRange {
  return KNOWN_RANGES.find((range) => range === value) ?? "30d";
}

const STATE_WORDS: Readonly<Record<string, string>> = {
  DISCOVERED: "Discovered",
  INTEREST_EXPRESSED: "Interest sent",
  CONNECTED: "Connected",
  IN_DILIGENCE: "In diligence",
  DECLINED: "Declined",
  CLOSED: "Closed",
};

/** The order a pipeline reads in: forward first, then the ends. */
const STATE_ORDER = [
  "DISCOVERED",
  "INTEREST_EXPRESSED",
  "CONNECTED",
  "IN_DILIGENCE",
  "CLOSED",
  "DECLINED",
];

export function sentenceCase(code: string): string {
  const text = code.replace(/_/g, " ").toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function stateWord(state: string, side: "FOUNDER" | "INVESTOR"): string {
  if (state === "INTEREST_EXPRESSED" && side === "FOUNDER") {
    return "Interested in you";
  }
  return STATE_WORDS[state] ?? sentenceCase(state);
}

export function orderedStages(
  byState: readonly { readonly state: string; readonly count: number }[],
): { readonly state: string; readonly count: number }[] {
  const rank = (state: string) => {
    const at = STATE_ORDER.indexOf(state);
    return at === -1 ? STATE_ORDER.length : at;
  };
  return [...byState]
    .filter((row) => row.count > 0)
    .sort((a, b) => rank(a.state) - rank(b.state) || b.count - a.count);
}

/** A decimal amount as written, grouped; never through a float. */
export function money(currency: string, amount: string): string {
  const [whole = "0", fraction] = amount.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const cents = (fraction ?? "").replace(/0+$/, "");
  return `${currency} ${cents.length === 0 ? grouped : `${grouped}.${cents.padEnd(2, "0").slice(0, 2)}`}`;
}

/** A median wait in plain words. */
export function waitWords(hours: number): string {
  if (hours < 1) return "Under 1 h";
  if (hours < 48) return `${String(Math.round(hours))} h`;
  const days = Math.round(hours / 24);
  return `${String(days)} days`;
}

export type ActivityTotals = {
  readonly interests: number;
  readonly connections: number;
  readonly meetings: number;
};

export function activityTotals(
  activity: ResultsActivity | undefined,
): ActivityTotals | null {
  if (activity === undefined) return null;
  return activity.points.reduce(
    (sum, point) => ({
      interests: sum.interests + point.interests,
      connections: sum.connections + point.connections,
      meetings: sum.meetings + point.meetings,
    }),
    { interests: 0, connections: 0, meetings: 0 },
  );
}

export function dayLabel(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

export function plural(count: number, one: string, many: string): string {
  return `${String(count)} ${count === 1 ? one : many}`;
}

/** A link on this page (the base may carry its own query, as review pages do). */
export function pageHref(
  basePath: string,
  query: Readonly<Record<string, string>>,
): string {
  const params = new URLSearchParams(query).toString();
  return `${basePath}${basePath.includes("?") ? "&" : "?"}${params}`;
}

/** The link that keeps the period and picks a stage (or clears it). */
export function stageHref(
  basePath: string,
  range: KnownRange,
  stage: string | null,
): string {
  return `${pageHref(basePath, stage === null ? { range } : { range, stage })}#pipeline`;
}

/**
 * Commitments now, per status: counts summed across currencies, and one
 * amount line per currency (never added across currencies).
 */
export function commitmentLines(
  rows: readonly {
    readonly status: "STATED" | "CONFIRMED" | "WITHDRAWN";
    readonly currencyCode: string;
    readonly count: number;
    readonly amount: string;
  }[],
): {
  readonly status: "CONFIRMED" | "STATED" | "WITHDRAWN";
  readonly label: string;
  readonly count: number;
  readonly amounts: readonly string[];
}[] {
  const labels = {
    CONFIRMED: "Confirmed",
    STATED: "Stated, not confirmed",
    WITHDRAWN: "Withdrawn",
  } as const;
  return (["CONFIRMED", "STATED", "WITHDRAWN"] as const).map((status) => {
    const mine = rows.filter((row) => row.status === status);
    return {
      status,
      label: labels[status],
      count: mine.reduce((sum, row) => sum + row.count, 0),
      amounts: mine.map((row) => money(row.currencyCode, row.amount)),
    };
  });
}
