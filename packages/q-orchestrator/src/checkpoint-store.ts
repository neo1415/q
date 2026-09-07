import { MemorySaver, type BaseCheckpointSaver } from "@langchain/langgraph";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";

/**
 * Where the engine keeps its working state (doc 12 §10.4; packet §17-18).
 *
 * The store is an opaque handle: the composition root creates one and
 * hands it to the orchestrator, and nothing else reads or writes it.
 * There is no `getState(threadId)` on this surface, so a thread id can
 * never be turned into a read by anything but the engine itself.
 */
export type QCheckpointStore = {
  /** @internal engine use only */
  readonly saver: BaseCheckpointSaver;
  readonly kind: "POSTGRES" | "MEMORY";
  readonly close: () => Promise<void>;
};

/** The schema doc 12 §10.4 assigns to orchestration infrastructure. */
export const Q_CHECKPOINT_SCHEMA = "q_runtime" as const;

/**
 * Durable checkpoints in `q_runtime.checkpoint*`, created by migration
 * `20260906150000_q_orchestration_checkpoints`. The saver's `setup()` is
 * deliberately not called: the schema is source-controlled, the saver's
 * migration ledger is seeded, and a process must never create tables.
 *
 * The connection string is the request-class server credential, resolved
 * by the composition root through `@capital-q/config/database`. It never
 * reaches the graph state or a log line.
 */
export function createPostgresQCheckpointStore(options: {
  readonly connectionString: string;
}): QCheckpointStore {
  const saver = PostgresSaver.fromConnString(options.connectionString, {
    schema: Q_CHECKPOINT_SCHEMA,
  });
  return {
    saver,
    kind: "POSTGRES",
    close: () => saver.end(),
  };
}

/**
 * Process-memory checkpoints. Lost on restart, therefore NOT acceptable as
 * the sole production persistence (LangGraph's own documentation says so).
 * Provided for unit tests that exercise the graph without a database; the
 * restart/resume acceptance test uses the Postgres store.
 */
export function createInMemoryQCheckpointStore(): QCheckpointStore {
  return {
    saver: new MemorySaver(),
    kind: "MEMORY",
    close: () => Promise.resolve(),
  };
}
