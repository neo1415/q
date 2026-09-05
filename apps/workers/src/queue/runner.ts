import type { RunnerLogger } from "../outbox-runner.js";
import { abortableSleep } from "../outbox-runner.js";
import type { QueueClient, QueueMessage } from "./pgmq.js";

/**
 * One polling loop over one queue, with the retry and dead-letter policy the
 * job's own contract declares.
 *
 * Acknowledgement discipline: a message is removed only after the handler
 * says its durable state is committed. A crash before that redelivers the
 * message, which is why every handler must be idempotent — losing work is
 * worse than doing it twice against an idempotent write.
 *
 * A message that keeps failing is not retried forever. Transient failures
 * back off; decisions (an unsupported format, a refused package) go straight
 * to the dead-letter queue, because retrying a poison document is how one
 * bad file becomes permanent load.
 */

export type MessageOutcome =
  /** Work is committed. Remove the message. */
  | { readonly kind: "DONE" }
  /** Keep it as history rather than deleting it. */
  | { readonly kind: "ARCHIVE" }
  /** Transient: hide it for a backoff and try again, up to the attempt limit. */
  | { readonly kind: "RETRY"; readonly errorCode: string }
  /** A decision, not an outage. Dead-letter it now; another attempt cannot help. */
  | { readonly kind: "PERMANENT"; readonly errorCode: string };

export type QueueRunnerOptions = {
  readonly queue: string;
  readonly deadLetterQueue?: string | undefined;
  readonly client: QueueClient;
  readonly handle: (message: QueueMessage) => Promise<MessageOutcome>;
  readonly batchSize: number;
  readonly pollIntervalMs: number;
  readonly visibilityTimeoutSeconds: number;
  readonly maxAttempts: number;
  readonly backoff: {
    readonly initialDelaySeconds: number;
    readonly maxDelaySeconds: number;
    readonly jitter: boolean;
  };
  readonly logger: RunnerLogger;
  readonly sleep?:
    ((ms: number, signal: AbortSignal) => Promise<void>) | undefined;
  /** Injectable so backoff jitter is deterministic in tests. */
  readonly random?: (() => number) | undefined;
};

export type QueueRunner = {
  readonly run: (signal: AbortSignal) => Promise<void>;
  /** One pass, for tests and for draining on shutdown. */
  readonly runOnce: () => Promise<number>;
};

export function backoffSeconds(
  attempt: number,
  options: QueueRunnerOptions["backoff"],
  random: () => number,
): number {
  const raw =
    options.initialDelaySeconds * Math.pow(2, Math.max(0, attempt - 1));
  const capped = Math.min(raw, options.maxDelaySeconds);
  // Jitter spreads retries so a shared dependency failure does not
  // resynchronise every document onto the same second.
  return options.jitter
    ? Math.max(1, Math.round(capped * (0.5 + random() * 0.5)))
    : capped;
}

export function createQueueRunner(options: QueueRunnerOptions): QueueRunner {
  const { client, logger, queue } = options;
  const sleep = options.sleep ?? abortableSleep;
  const random = options.random ?? Math.random;

  async function deadLetter(
    message: QueueMessage,
    errorCode: string,
  ): Promise<void> {
    if (options.deadLetterQueue !== undefined) {
      // Identifiers and a bounded code only: never the payload's content,
      // never an error string a document could have shaped.
      await client.send(options.deadLetterQueue, {
        queue,
        msgId: message.msgId,
        attempts: message.readCount,
        errorCode,
        enqueuedAt: message.enqueuedAt,
        deadLetteredAt: new Date().toISOString(),
        message: message.message,
      });
    }
    await client.remove(queue, message.msgId);
    logger.error(
      { queue, msgId: message.msgId, attempts: message.readCount, errorCode },
      "queue message dead-lettered",
    );
  }

  async function handleOne(message: QueueMessage): Promise<void> {
    let outcome: MessageOutcome;
    try {
      outcome = await options.handle(message);
    } catch (error: unknown) {
      // An unexpected throw is transient by default: the alternative is
      // discarding work because of a bug in error classification.
      outcome = {
        kind: "RETRY",
        errorCode: error instanceof Error ? "HANDLER_ERROR" : "UNKNOWN_ERROR",
      };
      logger.error(
        {
          queue,
          msgId: message.msgId,
          error: error instanceof Error ? error.name : "unknown",
        },
        "queue handler threw",
      );
    }

    switch (outcome.kind) {
      case "DONE":
        await client.remove(queue, message.msgId);
        return;
      case "ARCHIVE":
        await client.archive(queue, message.msgId);
        return;
      case "PERMANENT":
        await deadLetter(message, outcome.errorCode);
        return;
      case "RETRY": {
        if (message.readCount >= options.maxAttempts) {
          await deadLetter(message, outcome.errorCode);
          return;
        }
        const delay = backoffSeconds(
          message.readCount,
          options.backoff,
          random,
        );
        await client.delayVisibility(queue, message.msgId, delay);
        logger.warn(
          {
            queue,
            msgId: message.msgId,
            attempts: message.readCount,
            errorCode: outcome.errorCode,
            retryInSeconds: delay,
          },
          "queue message will be retried",
        );
      }
    }
  }

  const runOnce = async (): Promise<number> => {
    const messages = await client.read(queue, {
      visibilityTimeoutSeconds: options.visibilityTimeoutSeconds,
      batchSize: options.batchSize,
    });
    for (const message of messages) {
      await handleOne(message);
    }
    return messages.length;
  };

  return {
    runOnce,
    run: async (signal) => {
      logger.info(
        { queue, batchSize: options.batchSize },
        "queue consumer started",
      );
      while (!signal.aborted) {
        let handled = 0;
        try {
          handled = await runOnce();
        } catch (error: unknown) {
          // Reading itself failed (database unreachable). Nothing was
          // claimed; back off one interval rather than spinning.
          logger.error(
            { queue, error: error instanceof Error ? error.name : "unknown" },
            "queue batch failed",
          );
        }
        if (handled === 0 && !signal.aborted) {
          await sleep(options.pollIntervalMs, signal);
        }
      }
      logger.info({ queue }, "queue consumer stopped");
    },
  };
}
