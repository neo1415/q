import type { RunnableConfig } from "@langchain/core/runnables";
import { MemorySaver, type BaseCheckpointSaver } from "@langchain/langgraph";
import {
  WRITES_IDX_MAP,
  type ChannelVersions,
  type Checkpoint,
  type CheckpointMetadata,
  type PendingWrite,
} from "@langchain/langgraph-checkpoint";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import pg from "pg";

import { countRoundTrip } from "@capital-q/database";

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
  // SUB-SECOND: checkpoint queries count toward the run's round trips.
  // Counted when sent, in the caller's async context (no-op outside one).
  pool.on("connect", (client) => {
    const query = client.query.bind(client) as (...args: unknown[]) => unknown;
    (client as { query: (...args: unknown[]) => unknown }).query = (
      ...args: unknown[]
    ) => {
      countRoundTrip("checkpoint");
      return query(...args);
    };
  });
  const saver = new BatchedPostgresSaver(pool);
  return {
    saver,
    kind: "POSTGRES",
    close: () => saver.end(),
  };
}

/** `($1, $2, …), ($n+1, …)` for `rows` rows of `width` parameters each. */
function valuesList(rows: number, width: number, offset = 0): string {
  return Array.from({ length: rows }, (_, row) => {
    const cells = Array.from(
      { length: width },
      (_, cell) => `$${String(offset + row * width + cell + 1)}`,
    );
    return `(${cells.join(", ")})`;
  }).join(", ");
}

/**
 * R5: the library saver writes a checkpoint as BEGIN, one INSERT per
 * channel blob, the checkpoint row and COMMIT, and a task's writes as
 * BEGIN, one INSERT per write and COMMIT — each statement a round trip.
 * Here each is ONE statement (a data-modifying CTE or a multi-row
 * INSERT): the same rows, the same conflict rules, and a single statement
 * is atomic on its own, so nothing is lost by dropping BEGIN/COMMIT.
 * Reads and deletes are the library's own.
 */
class BatchedPostgresSaver extends PostgresSaver {
  readonly #pool: pg.Pool;

  constructor(pool: pg.Pool) {
    super(pool, undefined, { schema: Q_CHECKPOINT_SCHEMA });
    this.#pool = pool;
  }

  override async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
    newVersions: ChannelVersions,
  ): Promise<RunnableConfig> {
    const configurable = config.configurable;
    if (configurable === undefined) {
      throw new Error(`Missing "configurable" field in "config" param`);
    }
    const threadId = String(configurable["thread_id"]);
    const checkpointNs = String(configurable["checkpoint_ns"] ?? "");
    const parentId =
      (configurable["checkpoint_id"] as string | undefined) ?? null;
    // The library types the dumped metadata as `any`; it is a JSON value.
    const metadataDump: Promise<unknown> = this._dumpMetadata(metadata);
    const [blobs, serializedMetadata] = await Promise.all([
      this._dumpBlobs(
        threadId,
        checkpointNs,
        checkpoint.channel_values,
        newVersions,
      ),
      metadataDump,
    ]);
    const blobParams = blobs.flatMap(
      ([t, ns, channel, version, type, blob]) => [
        t,
        ns,
        channel,
        version,
        type,
        blob === undefined ? null : Buffer.from(blob),
      ],
    );
    const checkpointParams = [
      threadId,
      checkpointNs,
      checkpoint.id,
      parentId,
      this._dumpCheckpoint(checkpoint),
      serializedMetadata,
    ];
    const upsertCheckpoint = `insert into ${Q_CHECKPOINT_SCHEMA}.checkpoints
        (thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, checkpoint, metadata)
      values ${valuesList(1, 6, blobParams.length)}
      on conflict (thread_id, checkpoint_ns, checkpoint_id)
      do update set checkpoint = excluded.checkpoint, metadata = excluded.metadata`;
    const text =
      blobs.length === 0
        ? upsertCheckpoint
        : `with blobs as (
             insert into ${Q_CHECKPOINT_SCHEMA}.checkpoint_blobs
               (thread_id, checkpoint_ns, channel, version, type, blob)
             values ${valuesList(blobs.length, 6)}
             on conflict (thread_id, checkpoint_ns, channel, version) do nothing
           )
           ${upsertCheckpoint}`;
    await this.#pool.query(text, [...blobParams, ...checkpointParams]);
    return {
      configurable: {
        thread_id: threadId,
        checkpoint_ns: checkpointNs,
        checkpoint_id: checkpoint.id,
      },
    };
  }

  override async putWrites(
    config: RunnableConfig,
    writes: PendingWrite[],
    taskId: string,
  ): Promise<void> {
    if (writes.length === 0) return;
    const configurable = config.configurable ?? {};
    // The library's rule: special channels overwrite, ordinary ones keep
    // the first write.
    const overwrite = writes.every(([channel]) => channel in WRITES_IDX_MAP);
    const dumped = await this._dumpWrites(
      String(configurable["thread_id"]),
      String(configurable["checkpoint_ns"] ?? ""),
      String(configurable["checkpoint_id"]),
      taskId,
      writes,
    );
    // One statement may not touch a row twice: where the library would
    // have written the same index twice in turn, keep what it would have
    // left (the last on overwrite, the first otherwise).
    const byIdx = new Map<number, (typeof dumped)[number]>();
    for (const row of dumped) {
      if (overwrite || !byIdx.has(row[4])) byIdx.set(row[4], row);
    }
    const rows = [...byIdx.values()];
    const params = rows.flatMap((row) => {
      const blob = row[7];
      return [...row.slice(0, 7), Buffer.from(blob)];
    });
    await this.#pool.query(
      `insert into ${Q_CHECKPOINT_SCHEMA}.checkpoint_writes
         (thread_id, checkpoint_ns, checkpoint_id, task_id, idx, channel, type, blob)
       values ${valuesList(rows.length, 8)}
       on conflict (thread_id, checkpoint_ns, checkpoint_id, task_id, idx) ${
         overwrite
           ? "do update set channel = excluded.channel, type = excluded.type, blob = excluded.blob"
           : "do nothing"
       }`,
      params,
    );
  }
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
