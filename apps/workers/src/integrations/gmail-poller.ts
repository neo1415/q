import type { IntegrationsService } from "@capital-q/integrations";
import { createCorrelationId } from "@capital-q/observability";

import { abortableSleep, type RunnerLogger } from "../outbox-runner.js";

/**
 * The Gmail reply poller (BIZ-007; setup contract: "a history.list polling
 * fallback as well, every 5 min per connected mailbox, so replies still
 * arrive if push is misconfigured").
 *
 * Each tick renews expiring Gmail watches and syncs every connected
 * mailbox from its stored history cursor. The sync is the same idempotent
 * one the push endpoint runs, so push and poll racing on one reply record
 * it once. One mailbox failing never stops the others (the service
 * isolates them); a failed tick is logged and the next one runs.
 */

export const GMAIL_POLL_INTERVAL_MS = 5 * 60 * 1000;

export async function runGmailReplyPoller(options: {
  readonly integrations: Pick<IntegrationsService, "pollAll">;
  readonly signal: AbortSignal;
  readonly logger: RunnerLogger;
  readonly intervalMs?: number | undefined;
  readonly sleep?:
    ((ms: number, signal: AbortSignal) => Promise<void>) | undefined;
}): Promise<void> {
  const sleep = options.sleep ?? abortableSleep;
  const intervalMs = options.intervalMs ?? GMAIL_POLL_INTERVAL_MS;
  while (!options.signal.aborted) {
    try {
      const result = await options.integrations.pollAll(createCorrelationId());
      options.logger.info({ ...result }, "gmail reply poll");
    } catch {
      options.logger.warn(
        {},
        "gmail reply poll failed; retrying next interval",
      );
    }
    await sleep(intervalMs, options.signal);
  }
}
