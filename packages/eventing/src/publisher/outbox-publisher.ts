import { z } from "zod";

import type { EventRegistry } from "@capital-q/contracts";
import type {
  TransactionContext,
  TransactionManager,
} from "@capital-q/database";

import type { EventDispatcher } from "./dispatcher.js";
import {
  createOutboxRetryPolicy,
  type OutboxRetryPolicy,
} from "./retry-policy.js";

/**
 * Moves pending outbox rows onto the queue.
 *
 * One short transaction per batch:
 *
 *   claim   SELECT ... WHERE published_at IS NULL AND available_at <= now()
 *           AND attempt_count < max ORDER BY id FOR UPDATE SKIP LOCKED LIMIT n
 *   each    validate payload through the canonical registry
 *           → dispatcher.publish inside a savepoint
 *           → published_at, or attempt_count + backoff + bounded last_error
 *   commit
 *
 * SKIP LOCKED lets several publisher instances run against one table without
 * ever claiming the same row, and because pgmq lives in the same database the
 * send and the published_at mark are one atomic step: there is no window in
 * which the queue has the message but the row still looks pending. None of
 * this makes consumers exactly-once; a consumer still dedupes by EventId.
 *
 * No external call happens while the claim transaction is open. If the
 * dispatcher ever targets a broker outside this database, this publisher
 * needs leases and a different commit order -- do not paper over that.
 */

export const OUTBOX_DEFAULT_BATCH_SIZE = 25;
export const OUTBOX_MAX_BATCH_SIZE = 100;

export type OutboxPublishOutcome = "PUBLISHED" | "FAILED" | "INVALID";

/** Safe to log: identifiers and counters, never payload. */
export type OutboxPublishRecord = {
  readonly eventId: string;
  readonly eventType: string;
  readonly eventVersion: number;
  readonly tenantId: string | null;
  readonly attempt: number;
  readonly outcome: OutboxPublishOutcome;
  readonly exhausted: boolean;
  readonly error: string | undefined;
  readonly durationMs: number;
};

export type PublishBatchResult = {
  readonly claimed: number;
  readonly published: number;
  readonly failed: number;
  readonly exhausted: number;
  readonly records: readonly OutboxPublishRecord[];
};

export type OutboxPublisher = {
  readonly publishAvailable: (options?: {
    readonly limit?: number | undefined;
  }) => Promise<PublishBatchResult>;
};

export type OutboxPublisherOptions = {
  readonly transactions: TransactionManager;
  readonly registry: EventRegistry;
  readonly dispatcher: EventDispatcher;
  readonly retryPolicy?: OutboxRetryPolicy | undefined;
};

const ClaimedRowSchema = z.object({
  id: z.coerce.number().int(),
  event_id: z.string(),
  tenant_id: z.string().nullable(),
  event_type: z.string(),
  event_version: z.number().int(),
  attempt_count: z.number().int(),
  payload: z.unknown(),
});
type ClaimedRow = z.infer<typeof ClaimedRowSchema>;

const LAST_ERROR_MAX = 500;

/**
 * A bounded failure description. Codes are fixed; the detail is a short
 * classification, never a driver message (which can embed SQL or values).
 */
function safeError(code: string, detail: string | undefined): string {
  const text = detail === undefined ? code : `${code}: ${detail}`;
  return text.length > LAST_ERROR_MAX ? text.slice(0, LAST_ERROR_MAX) : text;
}

function classifyDispatchFailure(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    const { code } = error;
    if (typeof code === "string") {
      return `sqlstate ${code}`;
    }
  }
  return error instanceof Error ? error.name : "unknown";
}

export function createOutboxPublisher(
  options: OutboxPublisherOptions,
): OutboxPublisher {
  const { transactions, registry, dispatcher } = options;
  const policy = options.retryPolicy ?? createOutboxRetryPolicy();

  async function markPublished(tx: TransactionContext, row: ClaimedRow) {
    await tx.sql`
      update events.outbox
         set published_at = now(),
             attempt_count = attempt_count + 1,
             last_error = null
       where id = ${row.id}`;
  }

  async function recordFailure(
    tx: TransactionContext,
    row: ClaimedRow,
    error: string,
  ): Promise<{ attempt: number; exhausted: boolean }> {
    const attempt = row.attempt_count + 1;
    const backoff = policy.backoffSeconds(attempt);
    await tx.sql`
      update events.outbox
         set attempt_count = ${attempt},
             last_error = ${error},
             available_at = now() + make_interval(secs => ${backoff})
       where id = ${row.id}`;
    return { attempt, exhausted: attempt >= policy.maxAttempts };
  }

  return {
    publishAvailable: async (publishOptions = {}) => {
      const limit = Math.min(
        Math.max(1, publishOptions.limit ?? OUTBOX_DEFAULT_BATCH_SIZE),
        OUTBOX_MAX_BATCH_SIZE,
      );

      return transactions.run(async (tx) => {
        const rawRows = await tx.sql`
          select o.id, o.event_id, o.tenant_id, o.event_type, o.event_version,
                 o.attempt_count, o.payload
            from events.outbox o
           where o.published_at is null
             and o.available_at <= now()
             and o.attempt_count < ${policy.maxAttempts}
           order by o.id
           for update skip locked
           limit ${limit}`;

        const records: OutboxPublishRecord[] = [];

        for (const raw of rawRows) {
          const started = Date.now();
          const row = ClaimedRowSchema.parse(raw);
          const base = {
            eventId: row.event_id,
            eventType: row.event_type,
            eventVersion: row.event_version,
            tenantId: row.tenant_id,
          };

          // A row that no longer validates against the supported registry is
          // a contract defect, not something to guess at. It follows the
          // same bounded retry path and then stays visible as stuck work.
          const parsed = registry.parse(row.payload);
          if (!parsed.ok) {
            const failure = await recordFailure(
              tx,
              row,
              safeError("EVENT_SCHEMA_INVALID", parsed.rejection),
            );
            records.push({
              ...base,
              ...failure,
              outcome: "INVALID",
              error: parsed.rejection,
              durationMs: Date.now() - started,
            });
            continue;
          }

          // The savepoint confines a failed send to its own row: the batch
          // transaction stays usable to record the failure and go on.
          try {
            await tx.sql.savepoint((inner) =>
              dispatcher.publish({ sql: inner }, parsed.message),
            );
          } catch (error) {
            const detail = classifyDispatchFailure(error);
            const failure = await recordFailure(
              tx,
              row,
              safeError("QUEUE_PUBLISH_FAILED", detail),
            );
            records.push({
              ...base,
              ...failure,
              outcome: "FAILED",
              error: detail,
              durationMs: Date.now() - started,
            });
            continue;
          }

          await markPublished(tx, row);
          records.push({
            ...base,
            attempt: row.attempt_count + 1,
            exhausted: false,
            outcome: "PUBLISHED",
            error: undefined,
            durationMs: Date.now() - started,
          });
        }

        return {
          claimed: records.length,
          published: records.filter((r) => r.outcome === "PUBLISHED").length,
          failed: records.filter((r) => r.outcome !== "PUBLISHED").length,
          exhausted: records.filter((r) => r.exhausted).length,
          records,
        };
      });
    },
  };
}
