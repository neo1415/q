import { cachedInRun, type DatabaseExecutor } from "@capital-q/database";
import type { QRuntimeRepositories } from "@capital-q/q-runtime";

/**
 * R5: the run's own messages and latest stage, read once per run
 * (`cachedInRun`). The conversation history readers share one read in the
 * repository itself (`runCacheRoot`).
 *
 * Only reads on the request client itself are cached: a read inside a
 * transaction (where it may hold a lock or must see that transaction's own
 * writes) always goes to the database. Ownership and access reads — the
 * run and conversation lookups that decide whether the person may see
 * them — are not wrapped, so they stay fresh every time. A write this run
 * sends to any table an entry read drops that entry.
 */

const MESSAGE_TABLES = [
  "q_runtime.conversation_messages",
  "q_runtime.conversation_message_marks",
  // Superseded runs' lines are left out of the history read.
  "q_runtime.runs",
] as const;
const EVENT_TABLES = ["q_runtime.run_events"] as const;

export function withRunReadCache(
  repositories: QRuntimeRepositories,
  root: DatabaseExecutor,
): QRuntimeRepositories {
  const { messages, runEvents } = repositories;
  return {
    ...repositories,
    messages: {
      ...messages,
      listForRun: (executor, tenantId, runId, limit) => {
        const read = () =>
          messages.listForRun(executor, tenantId, runId, limit);
        return executor !== root
          ? read()
          : cachedInRun(
              {
                aggregate: "run-messages",
                tables: MESSAGE_TABLES,
                actor: tenantId,
                fingerprint: JSON.stringify([runId, limit]),
              },
              read,
            );
      },
    },
    runEvents: {
      ...runEvents,
      latestVisibleStage: (executor, tenantId, runId) => {
        const read = () =>
          runEvents.latestVisibleStage(executor, tenantId, runId);
        return executor !== root
          ? read()
          : cachedInRun(
              {
                aggregate: "run-stage",
                tables: EVENT_TABLES,
                actor: tenantId,
                fingerprint: runId,
              },
              read,
            );
      },
    },
  };
}
