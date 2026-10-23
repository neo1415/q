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
