import type { DatabaseExecutor } from "@capital-q/database";

import type { ModelUsageEntry, ModelUsageRepository } from "../ports.js";

/**
 * The append-only usage ledger (doc 13 §56.5; packet §41-42). One row per
 * real provider attempt, success or failure, with tokens, latency, cost
 * and the failure class. Nothing about what was said.
 *
 * Writes are autonomous (their own statement, never the caller's
 * transaction): a run that later fails must still have paid for what it
 * used, and a ledger row must never be rolled back with a domain write.
 */
export function createPostgresModelUsageRepository(options: {
  readonly sql: DatabaseExecutor;
}): ModelUsageRepository {
  return {
    record: async (entry: ModelUsageEntry) => {
      await options.sql`
        insert into ai_ops.model_usage
          (tenant_id, user_id, q_run_id, task_class, provider_id, model_id, routing_policy_id, attempt,
           input_tokens, cached_input_tokens, output_tokens, latency_ms, cost_usd, cost_basis,
           success, error_code, correlation_id)
        values
          (${entry.tenantId}, ${entry.userId ?? null}, ${entry.qRunId ?? null}, ${entry.taskClass},
           ${entry.providerId}, ${entry.modelId}, ${entry.routingPolicyId ?? null}, ${entry.attempt},
           ${entry.inputTokens}, ${entry.cachedInputTokens}, ${entry.outputTokens}, ${entry.latencyMs},
           ${entry.costUsd === undefined ? null : entry.costUsd.toFixed(8)}::text::numeric, ${entry.costBasis},
           ${entry.success}, ${entry.errorCode ?? null}, ${entry.correlationId ?? null})`;
    },
  };
}

/** Collects entries in memory; for tests. */
export function createInMemoryModelUsageRepository(): ModelUsageRepository & {
  readonly entries: readonly ModelUsageEntry[];
} {
  const entries: ModelUsageEntry[] = [];
  return {
    entries,
    record: (entry) => {
      entries.push(entry);
      return Promise.resolve();
    },
  };
}
