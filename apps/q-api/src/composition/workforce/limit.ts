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
  // A ledger that cannot be read does not stop the person's work: each
  // call is still capped by its own budget at the gateway.
  const rows = await spent().catch(() => []);
  const micros = rows.reduce(
    (sum, row) => sum + Math.round(Number(row.usd) * 1_000_000),
    0,
  );
  return !(micros >= Math.round(limitUsd * 1_000_000));
}
