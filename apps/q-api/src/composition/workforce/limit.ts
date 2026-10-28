/**
 * The person's monthly limit for Q's work (founder brief J6, workforce
 * mockup 2026-10-06: "Q pauses new work and asks you at the limit").
 *
 * One deployment-wide figure for now, in USD, from configuration; a
 * per-person limit is a later packet. New jobs are not started once the
 * month's workforce spend reaches it; work already approved and running is
 * not cut off mid-step, and every model call is still bounded by its own
 * per-call budget at the gateway.
 */

export const DEFAULT_WORKFORCE_MONTHLY_LIMIT_USD = 60;

export function workforceMonthlyLimitUsd(
  env: Readonly<Record<string, string | undefined>>,
): number | null {
  const raw = env["Q_WORKFORCE_MONTHLY_LIMIT_USD"]?.trim();
  if (raw === undefined || raw.length === 0) {
    return DEFAULT_WORKFORCE_MONTHLY_LIMIT_USD;
  }
  if (raw.toLowerCase() === "none") return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0
    ? value
    : DEFAULT_WORKFORCE_MONTHLY_LIMIT_USD;
}

/** Whether this month's spend leaves room for a new job. */
export async function withinMonthlyLimit(
  spent: () => Promise<readonly { readonly usd: string }[]>,
  limitUsd: number | null,
): Promise<boolean> {
  if (limitUsd === null) return true;
  // An unavailable ledger is not evidence of zero spend. Callers hold new
  // work separately from an actually exhausted allowance.
  const rows = await spent();
  const micros = rows.reduce((sum, row) => {
    const usd = Number(row.usd);
    const next = sum + Math.round(usd * 1_000_000);
    if (
      row.usd.trim().length === 0 ||
      !Number.isFinite(usd) ||
      usd < 0 ||
      !Number.isSafeInteger(next)
    ) {
      throw new Error("Invalid workforce spend");
    }
    return next;
  }, 0);
  return !(micros >= Math.round(limitUsd * 1_000_000));
}

/**
 * The most one job may spend (owner 2026-10-23: deep work -- a dozen
 * focused searches, their pages read, a document written, critiqued and
 * revised -- costs low single-digit dollars; the old $0.50 bought one
 * keyword search and a generic brief). `Q_WORKFORCE_JOB_CAP_USD`, bounded.
 * Spending beyond it is never planned; work over it needs the person.
 */
export const DEFAULT_WORKFORCE_JOB_CAP_USD = 2.5;
const JOB_CAP_BOUNDS = { min: 0.5, max: 10 } as const;

export function workforceJobCapUsd(
  env: Readonly<Record<string, string | undefined>>,
): number {
  const raw = env["Q_WORKFORCE_JOB_CAP_USD"]?.trim();
  const value = raw === undefined || raw.length === 0 ? NaN : Number(raw);
  if (!Number.isFinite(value)) return DEFAULT_WORKFORCE_JOB_CAP_USD;
  return Math.min(JOB_CAP_BOUNDS.max, Math.max(JOB_CAP_BOUNDS.min, value));
}

function boundedInteger(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
  fallback: number,
  bounds: { readonly min: number; readonly max: number },
): number {
  const raw = env[name]?.trim();
  const value = raw === undefined || raw.length === 0 ? NaN : Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(bounds.max, Math.max(bounds.min, Math.floor(value)));
}

/**
 * Searches one job may send to the public-web providers, planned questions
 * included (diligence audit 2026-10-28: up to ~32 a research step).
 * `Q_WORKFORCE_JOB_SEARCH_BUDGET`, bounded. A provider's own fail-over or
 * fan-out behind one search counts as that one search.
 */
export const DEFAULT_WORKFORCE_JOB_SEARCH_BUDGET = 8;

export function workforceJobSearchBudget(
  env: Readonly<Record<string, string | undefined>>,
): number {
  return boundedInteger(
    env,
    "Q_WORKFORCE_JOB_SEARCH_BUDGET",
    DEFAULT_WORKFORCE_JOB_SEARCH_BUDGET,
    { min: 1, max: 40 },
  );
}

/** A planned job's page-read budget, ms. `Q_RESEARCH_PLANNED_EXTRACT_MS`. */
export const DEFAULT_PLANNED_EXTRACT_MS = 8_000;

export function plannedExtractBudgetMs(
  env: Readonly<Record<string, string | undefined>>,
): number {
  return boundedInteger(
    env,
    "Q_RESEARCH_PLANNED_EXTRACT_MS",
    DEFAULT_PLANNED_EXTRACT_MS,
    { min: 1_000, max: 30_000 },
  );
}
