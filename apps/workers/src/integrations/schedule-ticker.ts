import type { ScheduleService } from "@capital-q/communication";
import { createCorrelationId } from "@capital-q/observability";

import { abortableSleep, type RunnerLogger } from "../outbox-runner.js";

/**
 * Reminders and prep briefs (BIZ-008).
 *
 * Every 30 seconds: due reminders go to Needs you (once, by dedupe key)
 * and, where asked, by email over SMTP (retried for an hour if the relay
 * fails), so a meeting's T-15 email lands within a minute of its time.
 * Prep briefs for calls in the next 24 hours are composed on the same
 * tick; each is written once. One failed tick is logged and the next runs.
 */

export const SCHEDULE_TICK_INTERVAL_MS = 30 * 1000;

export async function runScheduleTicker(options: {
  readonly schedule: Pick<ScheduleService, "deliverDue" | "prepareBriefs">;
  readonly signal: AbortSignal;
  readonly logger: RunnerLogger;
  readonly intervalMs?: number | undefined;
  readonly sleep?:
    ((ms: number, signal: AbortSignal) => Promise<void>) | undefined;
}): Promise<void> {
  const sleep = options.sleep ?? abortableSleep;
  const intervalMs = options.intervalMs ?? SCHEDULE_TICK_INTERVAL_MS;
  while (!options.signal.aborted) {
    const correlationId = createCorrelationId();
    try {
      const reminders = await options.schedule.deliverDue(correlationId);
      const briefs = await options.schedule.prepareBriefs(correlationId);
      if (reminders.delivered + reminders.emailed + briefs > 0) {
        options.logger.info({ ...reminders, briefs }, "schedule tick");
      }
    } catch {
      options.logger.warn({}, "schedule tick failed; retrying next interval");
    }
    await sleep(intervalMs, options.signal);
  }
}
