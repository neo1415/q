import type { ModelProviderCode } from "@capital-q/contracts";

/**
 * Provider balance watch (Premium Plan P1; DECISIONS 63: alert when a model
 * provider's remaining balance would last fewer than about seven days at
 * current spend; never a hard stop).
 *
 * None of the configured model providers (OpenAI, Anthropic, Groq, Google)
 * exposes the remaining prepaid balance to an inference key. So the owner
 * states a balance and when it was true (`CQ_PROVIDER_BALANCE_<CODE>`), and
 * the remaining balance is that figure less what `ai_ops.model_usage` has
 * recorded since. The projection is arithmetic only: no model, no guess.
 * Unpriced calls are counted and named, because they make the spend an
 * understatement, never silently zero.
 */

/** DECISIONS 63: "about 7 days". */
export const BALANCE_ALERT_DAYS = 7;

/** The spend rate is read over this many days, or since the balance was stated. */
export const SPEND_RATE_WINDOW_DAYS = 3;

const DAY_MS = 86_400_000;

export type ProviderBalanceSetting = {
  readonly providerCode: ModelProviderCode;
  /** The balance the owner read on the provider's console, in USD. */
  readonly balanceUsd: number;
  /** When that balance was true. Spend after it is subtracted. */
  readonly asOf: Date;
};

export type ProviderSpend = {
  readonly providerCode: ModelProviderCode;
  /** Recorded spend since the stated balance's `asOf`. */
  readonly spentSinceAsOfUsd: number;
  /** Recorded spend over the rate window ending now. */
  readonly windowSpentUsd: number;
  /** Calls in the rate window the ledger could not price. */
  readonly unpricedCalls: number;
};

export type ProviderBalanceAssessment = {
  readonly providerCode: ModelProviderCode;
  readonly remainingUsd: number;
  readonly dailySpendUsd: number;
  /** Null when nothing is being spent (the balance is not running down). */
  readonly daysLeft: number | null;
  readonly unpricedCalls: number;
  readonly alert: "EXHAUSTED" | "LOW" | null;
};

/**
 * Remaining balance and days left at the current spend rate. The rate
 * window is shortened to the time since the balance was stated when that
 * is shorter, so a fresh top-up is judged on the spend that is running it
 * down, but never shorter than an hour (one burst is not a rate).
 */
export function assessProviderBalance(input: {
  readonly setting: ProviderBalanceSetting;
  readonly spend: ProviderSpend;
  readonly now: Date;
  readonly alertDays?: number | undefined;
}): ProviderBalanceAssessment {
  const alertDays = input.alertDays ?? BALANCE_ALERT_DAYS;
  const remainingUsd = round(
    input.setting.balanceUsd - Math.max(0, input.spend.spentSinceAsOfUsd),
  );
  const sinceAsOfDays = Math.max(
    1 / 24,
    (input.now.getTime() - input.setting.asOf.getTime()) / DAY_MS,
  );
  const windowDays = Math.min(SPEND_RATE_WINDOW_DAYS, sinceAsOfDays);
  const rate = Math.max(0, input.spend.windowSpentUsd) / windowDays;
  const dailySpendUsd = round(rate);
  const daysLeft = rate > 0 ? round(Math.max(0, remainingUsd) / rate) : null;
  const alert =
    remainingUsd <= 0
      ? "EXHAUSTED"
      : daysLeft !== null && daysLeft < alertDays
        ? "LOW"
        : null;
  return {
    providerCode: input.setting.providerCode,
    remainingUsd,
    dailySpendUsd,
    daysLeft,
    unpricedCalls: input.spend.unpricedCalls,
    alert,
  };
}

/**
 * `CQ_PROVIDER_BALANCE_OPENAI=9.72@2026-11-05T23:00:00Z`: one setting per
 * provider, the balance in USD and the instant it was read. A malformed
 * value is reported, never read as zero (a zero would alert falsely; a
 * missing one would hide an alert).
 */
export function parseProviderBalanceSettings(
  env: Readonly<Record<string, string | undefined>>,
): {
  readonly settings: readonly ProviderBalanceSetting[];
  readonly invalid: readonly string[];
} {
  const settings: ProviderBalanceSetting[] = [];
  const invalid: string[] = [];
  const prefix = "CQ_PROVIDER_BALANCE_";
  for (const [name, raw] of Object.entries(env)) {
    if (!name.startsWith(prefix) || raw === undefined || raw.trim() === "") {
      continue;
    }
    const code = name.slice(prefix.length).toLowerCase();
    const match = /^\s*(\d+(?:\.\d+)?)\s*@\s*(\S+)\s*$/u.exec(raw);
    const asOf = match?.[2] === undefined ? Number.NaN : Date.parse(match[2]);
    if (
      !/^[a-z][a-z0-9_]*$/u.test(code) ||
      match?.[1] === undefined ||
      Number.isNaN(asOf)
    ) {
      invalid.push(name);
      continue;
    }
    settings.push({
      providerCode: code,
      balanceUsd: Number(match[1]),
      asOf: new Date(asOf),
    });
  }
  return { settings, invalid };
}

/** The owner-facing wording of an assessment. Figures only; no guess. */
export function balanceAlertText(
  assessment: ProviderBalanceAssessment,
): { readonly subject: string; readonly text: string } | null {
  if (assessment.alert === null) return null;
  const provider = assessment.providerCode;
  const unpriced =
    assessment.unpricedCalls > 0
      ? ` ${String(assessment.unpricedCalls)} recent calls had no price, so real spend is higher than this.`
      : "";
  if (assessment.alert === "EXHAUSTED") {
    return {
      subject: `Capital Q: ${provider} balance is used up`,
      text: `By the ledger, the ${provider} balance you stated is used up (${usd(assessment.remainingUsd)} left; about ${usd(assessment.dailySpendUsd)} a day).${unpriced} Top up on the provider's console and update CQ_PROVIDER_BALANCE_${provider.toUpperCase()}. Q notices a top-up within about 30 seconds; no restart is needed.`,
    };
  }
  return {
    subject: `Capital Q: ${provider} balance lasts about ${String(Math.floor(assessment.daysLeft ?? 0))} days`,
    text: `At the current spend of about ${usd(assessment.dailySpendUsd)} a day, the ${provider} balance (${usd(assessment.remainingUsd)} left by the ledger) lasts about ${String(assessment.daysLeft)} days.${unpriced} Nothing is stopped; this is a reminder to top up.`,
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function usd(value: number): string {
  return `USD ${value.toFixed(2)}`;
}

/**
 * The owner-facing alert for a provider set aside by its own refusal
 * (credit or quota spent, or key refused): sent at once, the first time.
 */
export function providerBlockedAlertText(event: {
  readonly providerCode: ModelProviderCode;
  readonly kind: "ACCOUNT_EXHAUSTED" | "KEY_REFUSED";
}): { readonly key: string; readonly subject: string; readonly text: string } {
  const provider = event.providerCode;
  return event.kind === "ACCOUNT_EXHAUSTED"
    ? {
        key: `provider-blocked:${provider}:account`,
        subject: `Capital Q: ${provider} credit or quota has run out`,
        text: `${provider} refused a request because the account's credit or quota is spent. Q answers from another eligible provider where one exists and otherwise tells people plainly that its reasoning is temporarily unavailable. Top up or raise the limit on the provider's console; Q checks again every 30 seconds and recovers without a restart.`,
      }
    : {
        key: `provider-blocked:${provider}:key`,
        subject: `Capital Q: ${provider} refused the API key`,
        text: `${provider} refused the configured API key (401/403). Q answers from another eligible provider where one exists. Replace or re-enable the key; Q checks again every 30 seconds and recovers without a restart once it is accepted (a changed environment variable still needs a redeploy).`,
      };
}
