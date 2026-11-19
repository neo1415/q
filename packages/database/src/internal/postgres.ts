import postgres, { type Sql } from "postgres";

import type {
  DatabaseAccessClass,
  DatabaseConfig,
} from "@capital-q/config/database";

import { instrumentSql } from "../round-trips.js";

/**
 * The only place in the repository that touches the Postgres.js constructor.
 *
 * Domain packages never instantiate the driver: they receive an executor or a
 * transaction context from the factories in this package, so driver options,
 * pooling and timeouts are decided once.
 */

export type PostgresClientOptions = {
  readonly max: number;
  readonly idle_timeout: number;
  readonly connect_timeout: number;
  readonly prepare: boolean;
  /** Set only behind the transaction pooler; the driver default otherwise. */
  readonly max_pipeline?: number;
  readonly connection: {
    readonly application_name: string;
    readonly statement_timeout: number;
    /** Absent for MIGRATION: DDL waits for its locks as it always has. */
    readonly lock_timeout?: number;
  };
};

/**
 * How long a statement may run and wait, and how each limit is applied.
 *
 * Startup parameters alone are not enough: Supavisor (session and
 * transaction mode alike) does not forward them, so on hosted the
 * statement_timeout passed at connect was never in force (pg_stat_activity
 * shows application_name "Supavisor"; app statements ran 84-112 s; a Q run
 * hung on a read nothing timed out, 16 Nov 2026). So, behind a pooler:
 *
 *   - every transaction the app opens starts with the SET LOCAL
 *     equivalents (`setLocal`), which live and die with that transaction
 *     and so are safe under transaction pooling;
 *   - every query, in or out of a transaction, has a client-side deadline
 *     (`queryDeadlineMs`): asked to cancel, then rejected, so an await on
 *     the database always ends even when the server or pooler never
 *     answers.
 *
 * The deadline sits a little past the server's limit so that, where the
 * server enforces it (direct, or SET LOCAL), its own error arrives first.
 */
export type SqlTimeouts = {
  readonly statementTimeoutMs: number;
  readonly lockTimeoutMs: number;
  /** Undefined: no client-side deadline (MIGRATION). */
  readonly queryDeadlineMs: number | undefined;
  /** Issue the SET LOCAL equivalents at the start of each transaction. */
  readonly setLocal: boolean;
};

/** How far past the statement budget the client gives up on its own. */
export const QUERY_DEADLINE_GRACE_MS = 2_000;

/**
 * A lock wait is bounded below the statement it belongs to: a quarter of
 * it, at least 5 s, never more than the statement itself (the 10 s request
 * budget: 5 s; a 120 s worker budget: 30 s).
 */
export function lockTimeoutFor(statementTimeoutMs: number): number {
  return Math.min(
    statementTimeoutMs,
    Math.max(5_000, Math.floor(statementTimeoutMs / 4)),
  );
}

export function resolveSqlTimeouts(
  config: DatabaseConfig,
  accessClass: DatabaseAccessClass,
): SqlTimeouts {
  const migration = accessClass === "MIGRATION";
  return {
    statementTimeoutMs: config.statementTimeoutMs,
    lockTimeoutMs: lockTimeoutFor(config.statementTimeoutMs),
    queryDeadlineMs: migration
      ? undefined
      : config.statementTimeoutMs + QUERY_DEADLINE_GRACE_MS,
    // A direct connection honours the startup parameters already.
    setLocal: !migration && config.connectionMode !== "direct",
  };
}

/** The per-transaction limits for createTransactionManager, or none. */
export function transactionLimitsFor(
  config: DatabaseConfig,
  accessClass: DatabaseAccessClass,
):
  | { readonly statementTimeoutMs: number; readonly lockTimeoutMs: number }
  | undefined {
  const timeouts = resolveSqlTimeouts(config, accessClass);
  return timeouts.setLocal
    ? {
        statementTimeoutMs: timeouts.statementTimeoutMs,
        lockTimeoutMs: timeouts.lockTimeoutMs,
      }
    : undefined;
}

/**
 * Behind the transaction pooler, the most statements and transactions the
 * client hands the driver at once: one per pooled connection, so the
 * driver never writes a query behind another (see ConnectionGate in
 * round-trips.ts). Undefined elsewhere: no gate.
 */
export function connectionSlotsFor(
  config: DatabaseConfig,
  accessClass: DatabaseAccessClass,
): number | undefined {
  return config.connectionMode === "transaction_pooler" &&
    accessClass !== "MIGRATION"
    ? config.poolMax
    : undefined;
}

/**
 * Pure mapping from validated config to driver options. Separated from the
 * constructor so it can be unit-tested without opening a socket.
 */
export function resolvePostgresOptions(
  config: DatabaseConfig,
  accessClass: DatabaseAccessClass,
): PostgresClientOptions {
  return {
    max: config.poolMax,
    idle_timeout: config.idleTimeoutSeconds,
    connect_timeout: config.connectTimeoutSeconds,
    // Supavisor's transaction mode cannot honour prepared statements: a
    // statement prepared on one backend may be executed on another. Prepared
    // statements stay on for direct and session-mode connections.
    prepare: config.connectionMode !== "transaction_pooler",
    // Transaction mode hands the server connection to another client after
    // each transaction. max_pipeline 1 is the driver's least pipelining,
    // but it still writes a query behind one in flight when no connection
    // is free, and Supavisor never answers that second query (17 Nov
    // 2026, scripts/db/pooler-proof). 0 is not an option (BEGIN would
    // never reserve its connection); the request client's connection
    // gate (round-trips.ts, `connectionSlots`) keeps the driver from ever
    // needing to pipeline instead.
    ...(config.connectionMode === "transaction_pooler"
      ? { max_pipeline: 1 }
      : {}),
    connection: {
      // Visible in pg_stat_activity, so an operator can see which access
      // class holds which connections without reading application code.
      application_name: `capital-q:${accessClass.toLowerCase()}`,
      statement_timeout: config.statementTimeoutMs,
      ...(accessClass === "MIGRATION"
        ? {}
        : { lock_timeout: lockTimeoutFor(config.statementTimeoutMs) }),
    },
  };
}

export function createPostgresClient(
  connectionString: string,
  config: DatabaseConfig,
  accessClass: DatabaseAccessClass,
): Sql {
  // Lazy: no socket is opened until the first query. Services that want a
  // startup dependency check call the health helper deliberately.
  // The per-run round-trip counter and run read cache (R5): each query is
  // counted as it is handed to the driver, in its caller's context (no-op
  // outside a run; never keeps parameters).
  const open = () =>
    postgres(connectionString, resolvePostgresOptions(config, accessClass));
  return instrumentSql(open(), {
    queryDeadlineMs: resolveSqlTimeouts(config, accessClass).queryDeadlineMs,
    connectionSlots: connectionSlotsFor(config, accessClass),
    // The pool watchdog's way out of a wedged pool (watchConnectionPool).
    reopen: open,
  });
}

/**
 * A client used only for LISTEN, on a session connection (see
 * DATABASE_LISTEN_URL). postgres.js gives LISTEN one dedicated connection
 * outside the pool, so `max: 1` bounds this client to that one session slot.
 * Not instrumented: it serves no request and carries no request's queries.
 */
export function createPostgresListenClient(
  connectionString: string,
  config: DatabaseConfig,
  accessClass: DatabaseAccessClass,
): Sql {
  const options = resolvePostgresOptions(config, accessClass);
  return postgres(connectionString, {
    ...options,
    max: 1,
    prepare: true,
    connection: {
      ...options.connection,
      application_name: `${options.connection.application_name}:listen`,
    },
  });
}
