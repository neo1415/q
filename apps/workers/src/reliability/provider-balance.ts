import {
  assessProviderBalance,
  balanceAlertText,
  SPEND_RATE_WINDOW_DAYS,
  type ProviderBalanceAssessment,
  type ProviderBalanceSetting,
  type ProviderSpend,
} from "@capital-q/model-gateway";
import type { OperatorAlert } from "@capital-q/platform-admin";

import { abortableSleep, type RunnerLogger } from "../outbox-runner.js";

/**
 * Premium Plan P1, DECISIONS 63: once an hour, each provider whose balance
 * the owner has stated (`CQ_PROVIDER_BALANCE_<CODE>`) is projected against
 * the spend `ai_ops.model_usage` records, and the owner is alerted when it
 * would last fewer than about seven days. An alert only: nothing is
 * stopped, no cap is applied. The immediate alert on a credit or quota
 * refusal is the gateway's (`onProviderBlocked`), not this.
 */

export const PROVIDER_BALANCE_INTERVAL_MS = 60 * 60 * 1000;

const DAY_MS = 86_400_000;

export async function checkProviderBalances(input: {
  readonly settings: readonly ProviderBalanceSetting[];
  readonly readSpend: (query: {
    readonly providerCode: string;
    readonly since: Date;
    readonly windowStart: Date;
  }) => Promise<ProviderSpend>;
  readonly alert: (alert: OperatorAlert) => Promise<boolean>;
  readonly now: Date;
  readonly logger: RunnerLogger;
}): Promise<readonly ProviderBalanceAssessment[]> {
  const assessments: ProviderBalanceAssessment[] = [];
  for (const setting of input.settings) {
    let spend: ProviderSpend;
    try {
      spend = await input.readSpend({
        providerCode: setting.providerCode,
        since: setting.asOf,
        windowStart: new Date(
          input.now.getTime() - SPEND_RATE_WINDOW_DAYS * DAY_MS,
        ),
      });
    } catch (error: unknown) {
      // An unreadable ledger is said, never read as "no spend".
      input.logger.warn(
        { err: error, provider: setting.providerCode },
        "provider balance check could not read the spend ledger",
      );
      continue;
    }
    const assessment = assessProviderBalance({
      setting,
      spend,
      now: input.now,
    });
    assessments.push(assessment);
    input.logger.info(
      {
        provider: assessment.providerCode,
        remainingUsd: assessment.remainingUsd,
        dailySpendUsd: assessment.dailySpendUsd,
        daysLeft: assessment.daysLeft,
        unpricedCalls: assessment.unpricedCalls,
        alert: assessment.alert,
      },
      "provider balance check",
    );
    const wording = balanceAlertText(assessment);
    if (wording !== null) {
      await input.alert({
        key: `provider-balance:${assessment.providerCode}:${assessment.alert ?? ""}`,
        ...wording,
      });
    }
  }
  return assessments;
}

export async function runProviderBalanceWatch(options: {
  readonly settings: readonly ProviderBalanceSetting[];
  readonly readSpend: Parameters<typeof checkProviderBalances>[0]["readSpend"];
  readonly alert: (alert: OperatorAlert) => Promise<boolean>;
  readonly signal: AbortSignal;
  readonly logger: RunnerLogger;
  readonly intervalMs?: number | undefined;
  readonly now?: (() => Date) | undefined;
  readonly sleep?:
    ((ms: number, signal: AbortSignal) => Promise<void>) | undefined;
}): Promise<void> {
  const sleep = options.sleep ?? abortableSleep;
  const now = options.now ?? (() => new Date());
  const intervalMs = options.intervalMs ?? PROVIDER_BALANCE_INTERVAL_MS;
  while (!options.signal.aborted) {
    try {
      await checkProviderBalances({
        settings: options.settings,
        readSpend: options.readSpend,
        alert: options.alert,
        now: now(),
        logger: options.logger,
      });
    } catch (error: unknown) {
      options.logger.warn(
        { err: error },
        "provider balance check failed; retrying next interval",
      );
    }
    await sleep(intervalMs, options.signal);
  }
}
