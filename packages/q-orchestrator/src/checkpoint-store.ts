import { MemorySaver, type BaseCheckpointSaver } from "@langchain/langgraph";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import pg from "pg";

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
 *
 * The pool is built here rather than by `fromConnString` so that it is
 * bounded by the same budget as the rest of the service. It is a SECOND
 * pool against the same database: left at the driver's default of ten it
 * is not the engine's own limit that matters but the server's, and on a
 * hosted session-mode pooler capped at fifteen clients the two pools
 * together reached it. The write that could not get a client rejected
 * from inside the saver, where nothing was awaiting it, and took the
 * whole service down mid-conversation (hosted, 2026-09-22). A checkpoint
 * is infrastructure: it may fail a run, never the process.
 */
export function createPostgresQCheckpointStore(options: {
  readonly connectionString: string;
  /** Clients this store may hold. Counted against the same server as every other pool. */
  readonly poolMax?: number | undefined;
  readonly connectTimeoutSeconds?: number | undefined;
  readonly idleTimeoutSeconds?: number | undefined;
}): QCheckpointStore {
  const pool = new pg.Pool({
    connectionString: options.connectionString,
    max: options.poolMax ?? 3,
    ...(options.connectTimeoutSeconds === undefined
      ? {}
      : { connectionTimeoutMillis: options.connectTimeoutSeconds * 1_000 }),
    ...(options.idleTimeoutSeconds === undefined
      ? {}
      : { idleTimeoutMillis: options.idleTimeoutSeconds * 1_000 }),
  });
  // A pooled client erroring while idle is an infrastructure event, not a
  // program fault: pg emits it on the pool, and an unhandled 'error' event
  // is fatal to the process. It is swallowed here for that reason alone —
  // the query that needed the client still rejects to its own caller.
  pool.on("error", () => undefined);
  const saver = new PostgresSaver(pool, undefined, {
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
