import type { NotificationDelivery } from "@capital-q/communication";

import { abortableSleep, type RunnerLogger } from "../outbox-runner.js";

/**
 * Notice delivery (AUTO, ADR 0030): every 30 seconds, push new notices to
 * the person's devices and email the "Needs you" ones still unread after
 * ten minutes. Each notice is marked as it goes, so a restart repeats
 * nothing; a failed pass is retried on the next.
 */
export const NOTICE_DELIVERY_INTERVAL_MS = 30_000;

export async function runNoticeDeliveryTicker(options: {
  readonly delivery: Pick<NotificationDelivery, "tick">;
  readonly signal: AbortSignal;
  readonly logger: RunnerLogger;
  readonly intervalMs?: number | undefined;
  readonly sleep?:
    ((ms: number, signal: AbortSignal) => Promise<void>) | undefined;
}): Promise<void> {
  const sleep = options.sleep ?? abortableSleep;
  const intervalMs = options.intervalMs ?? NOTICE_DELIVERY_INTERVAL_MS;
  while (!options.signal.aborted) {
    try {
      const sent = await options.delivery.tick();
      if (sent.pushed + sent.emailed > 0) {
        options.logger.info({ ...sent }, "notices delivered");
      }
    } catch {
      options.logger.warn({}, "notice delivery failed; retrying next interval");
    }
    await sleep(intervalMs, options.signal);
  }
}
