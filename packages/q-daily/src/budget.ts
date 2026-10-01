/**
 * The Q Daily's budget guard (DAILY spec §6, G7).
 *
 * Every search, extract, model call and photo search the pipeline makes
 * passes through a meter first. A meter that says no is a step skipped,
 * never an error: an edition with fewer stories is better than a bill
 * nobody approved. The caps are code, not configuration a model can move.
 */

export const DAILY_BUDGET = {
  /** News searches for one shared public gathering. */
  clusterSearches: 4,
  /** Searches for one person's own names (their company, their relationships). */
  personalSearches: 3,
  /** Full-text extract calls for one gathering (each reads up to five pages). */
  extractCalls: 2,
  /** Story-writer model calls for one gathering. */
  clusterStoryWrites: 8,
  /** Story-writer model calls for one person's own section. */
  personalStoryWrites: 3,
  /** Q's take: one call per edition. */
  takeCalls: 1,
  /** Stock-photo searches per gathering. */
  photoSearches: 3,
  /** Results asked of each search. */
  resultsPerSearch: 6,
  /** RSS items considered per feed. */
  itemsPerFeed: 15,
  /** Stories printed in one edition, lead and briefs included. */
  storiesPerEdition: 14,
  /** Editions one worker tick composes, one after another. */
  editionsPerTick: 3,
  /** Editions per day across the deployment, unless the env lowers it. */
  editionsPerDay: 60,
} as const;

export type BudgetLine = "search" | "extract" | "write" | "take" | "photo";

export type BudgetMeter = {
  /** Take one unit of a line; false when the line is spent. */
  readonly take: (line: BudgetLine) => boolean;
  readonly used: (line: BudgetLine) => number;
  /** Searches and extracts together: what the provider bills. */
  readonly searchesUsed: () => number;
  /** Story writes and the take together: model calls. */
  readonly modelCallsUsed: () => number;
};

export function createBudgetMeter(
  caps: Readonly<Record<BudgetLine, number>>,
): BudgetMeter {
  const used: Record<BudgetLine, number> = {
    search: 0,
    extract: 0,
    write: 0,
    take: 0,
    photo: 0,
  };
  return {
    take: (line) => {
      if (used[line] >= caps[line]) return false;
      used[line] += 1;
      return true;
    },
    used: (line) => used[line],
    searchesUsed: () => used.search + used.extract,
    modelCallsUsed: () => used.write + used.take,
  };
}

export function clusterBudget(): BudgetMeter {
  return createBudgetMeter({
    search: DAILY_BUDGET.clusterSearches,
    extract: DAILY_BUDGET.extractCalls,
    write: DAILY_BUDGET.clusterStoryWrites,
    take: 0,
    photo: DAILY_BUDGET.photoSearches,
  });
}

export function personalBudget(): BudgetMeter {
  return createBudgetMeter({
    search: DAILY_BUDGET.personalSearches,
    extract: 1,
    write: DAILY_BUDGET.personalStoryWrites,
    take: DAILY_BUDGET.takeCalls,
    photo: 0,
  });
}
