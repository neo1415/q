/**
 * An aggregate daily ceiling on model spend (audit F-D8).
 *
 * Every other ceiling is local: per request (`budget.maxEstimatedCostUsd`),
 * per feature (duplex voice, Q Daily, delegation). None stops a loop, a
 * retry storm or a busy day from spending without bound, and the provider
 * budget is the founder's own. This one counts everything the usage ledger
 * counts (text, images, realtime voice) for the current UTC day.
 *
 * Spent = the ledger's sum at the last read + what this process recorded
 * since. The ledger read is cached (`refreshMs`) so the cap costs one small
 * query a minute, not one per request; the in-process tally closes the gap
 * between reads. Several processes share the ledger, so each sees the
 * others' spend at its next refresh: the cap can be overshot by at most one
 * refresh interval of the other processes' spend.
 *
 * Failure posture: past the cap a request is refused with BUDGET_EXCEEDED
 * (the Q failure class BUDGET). A failed ledger read keeps the last known
 * total; with no total ever read, it admits and says so in the log. A
 * ledger outage must not take Q down, and the per-request ceilings still
 * bound every call meanwhile.
 */

export type SpendCapVerdict =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly capUsd: number;
      readonly spentUsd: number;
    };

export type ModelSpendCap = {
  /** May a new request start? */
  readonly check: () => Promise<SpendCapVerdict>;
  /** An attempt this process just recorded in the ledger. */
  readonly note: (costUsd: number) => void;
};

export type DailySpendCapOptions = {
  readonly capUsd: number;
  /** The ledger's total for the UTC day starting at `dayStart`, in USD. */
  readonly readSpentSinceUsd: (dayStart: Date) => Promise<number>;
  readonly now?: (() => Date) | undefined;
  readonly refreshMs?: number | undefined;
  readonly onReadFailure?: ((error: unknown) => void) | undefined;
};

export function utcDayStart(at: Date): Date {
  return new Date(
    Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()),
  );
}

export function createDailySpendCap(
  options: DailySpendCapOptions,
): ModelSpendCap {
  const now = options.now ?? (() => new Date());
  const refreshMs = options.refreshMs ?? 60_000;
  let day = utcDayStart(now()).getTime();
  let ledgerUsd: number | undefined;
  let readAt = Number.NEGATIVE_INFINITY;
  let sinceReadUsd = 0;

  async function refresh(at: number): Promise<void> {
    try {
      const spent = await options.readSpentSinceUsd(new Date(day));
      ledgerUsd = Number.isFinite(spent) && spent >= 0 ? spent : ledgerUsd;
      sinceReadUsd = 0;
    } catch (error: unknown) {
      options.onReadFailure?.(error);
    }
    readAt = at;
  }

  return {
    check: async () => {
      const at = now().getTime();
      const today = utcDayStart(new Date(at)).getTime();
      if (today !== day) {
        // A new UTC day starts from zero, whatever yesterday spent.
        day = today;
        ledgerUsd = undefined;
        sinceReadUsd = 0;
        readAt = Number.NEGATIVE_INFINITY;
      }
      if (at - readAt >= refreshMs) await refresh(at);
      if (ledgerUsd === undefined) return { allowed: true };
      const spentUsd = ledgerUsd + sinceReadUsd;
      return spentUsd >= options.capUsd
        ? { allowed: false, capUsd: options.capUsd, spentUsd }
        : { allowed: true };
    },
    note: (costUsd) => {
      if (Number.isFinite(costUsd) && costUsd > 0) sinceReadUsd += costUsd;
    },
  };
}

/**
 * `CQ_MODEL_DAILY_SPEND_CAP_USD`: unset or empty means no aggregate cap
 * (the behaviour before this existed). Anything else must be a plain
 * non-negative number up to 1000, or startup fails: a typo must never
 * silently lift a cap the founder set.
 */
export function parseDailySpendCapUsd(
  env: Readonly<Record<string, string | undefined>>,
): number | undefined {
  const raw = env["CQ_MODEL_DAILY_SPEND_CAP_USD"]?.trim();
  if (raw === undefined || raw === "") return undefined;
  if (!/^\d+(\.\d+)?$/.test(raw)) {
    throw new Error(
      "CQ_MODEL_DAILY_SPEND_CAP_USD must be a non-negative number of US dollars",
    );
  }
  const value = Number(raw);
  if (value > 1_000) {
    throw new Error("CQ_MODEL_DAILY_SPEND_CAP_USD must be at most 1000");
  }
  return value;
}
