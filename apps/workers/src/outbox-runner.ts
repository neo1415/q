import type {
  OutboxPublisher,
  PublishBatchResult,
} from "@capital-q/eventing/publisher";

/**
 * The polling loop that drives the outbox publisher.
 *
 * Lives in the worker deployable and nowhere else: neither the eventing
 * package nor any domain package owns a process loop. It publishes bounded
 * batches back to back while there is work, sleeps for the poll interval
 * when a batch comes back empty or a batch fails, and stops when its signal
 * aborts. A failing database does not crash the process; it is logged and
 * retried on the next tick.
 */

/** The subset of a structured logger the runner needs. */
export type RunnerLogger = {
  readonly info: (fields: Record<string, unknown>, message: string) => void;
  readonly warn: (fields: Record<string, unknown>, message: string) => void;
  readonly error: (fields: Record<string, unknown>, message: string) => void;
};

export type OutboxPublisherRunnerOptions = {
  readonly publisher: OutboxPublisher;
  readonly batchSize: number;
  readonly pollIntervalMs: number;
  readonly logger: RunnerLogger;
  /** Injectable for tests; defaults to an abortable setTimeout. */
  readonly sleep?:
    ((ms: number, signal: AbortSignal) => Promise<void>) | undefined;
};

export type OutboxPublisherRunner = {
  /** Resolves once the signal aborts and the current tick has finished. */
  readonly run: (signal: AbortSignal) => Promise<void>;
};

export function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function summarise(result: PublishBatchResult): Record<string, unknown> {
  return {
    claimed: result.claimed,
    published: result.published,
    failed: result.failed,
    exhausted: result.exhausted,
  };
}

export function createOutboxPublisherRunner(
  options: OutboxPublisherRunnerOptions,
): OutboxPublisherRunner {
  const { publisher, batchSize, pollIntervalMs, logger } = options;
  const sleep = options.sleep ?? abortableSleep;

  return {
    run: async (signal) => {
      logger.info({ batchSize, pollIntervalMs }, "outbox publisher started");

      while (!signal.aborted) {
        let idle = true;
        try {
          const result = await publisher.publishAvailable({ limit: batchSize });
          idle = result.claimed === 0;

          // Identifiers and counters only; payloads never reach the log.
          for (const record of result.records) {
            const fields = {
              eventId: record.eventId,
              eventType: record.eventType,
              eventVersion: record.eventVersion,
              tenantId: record.tenantId,
              attempt: record.attempt,
              durationMs: record.durationMs,
            };
            if (record.outcome === "PUBLISHED") {
              logger.info(fields, "outbox event published");
            } else {
              (record.exhausted ? logger.error : logger.warn)(
                {
                  ...fields,
                  outcome: record.outcome,
                  error: record.error,
                  exhausted: record.exhausted,
                },
                record.exhausted
                  ? "outbox event exhausted its attempts"
                  : "outbox event publication failed; will retry",
              );
            }
          }
          if (result.claimed > 0) {
            logger.info(summarise(result), "outbox batch complete");
          }
        } catch (error) {
          // The claim transaction itself failed (database unreachable, etc.).
          // Nothing was published; back off for one interval and try again.
          logger.error(
            { error: error instanceof Error ? error.name : "unknown" },
            "outbox batch failed",
          );
        }

        if (idle && !signal.aborted) {
          await sleep(pollIntervalMs, signal);
        }
      }

      logger.info({}, "outbox publisher stopped");
    },
  };
}
