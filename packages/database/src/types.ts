import type { ISql, TransactionSql } from "postgres";

import type { DatabaseAccessClass } from "@capital-q/config/database";

/**
 * The typed, parameterised query surface an infrastructure repository uses.
 *
 * It is the driver's tagged template: values interpolated with `${...}` are
 * always bound parameters, never concatenated text. There is no
 * `query(sql: string, params)` on purpose -- that shape invites string
 * assembly. `.unsafe()` exists on the driver but is forbidden by lint outside
 * this package's own adapter.
 */
/*
 * Deliberately the driver's shared query surface (ISql) rather than the full
 * client: both a pooled client and a transaction satisfy it, so a repository
 * written against DatabaseExecutor runs unchanged inside or outside a
 * transaction, and it cannot reach `begin`, `end` or pool lifecycle.
 */
export type DatabaseExecutor = ISql;

/**
 * A transaction in progress.
 *
 * Every repository handed the same context executes on the same reserved
 * connection inside the same BEGIN...COMMIT, which is what lets a domain
 * write, its outbox row and its audit record commit or roll back together.
 *
 * It exposes the transaction-scoped executor and nothing else. In particular
 * there is no TransactionManager here: a repository cannot quietly open a
 * second top-level transaction from inside one. Savepoints can be added later
 * if a real use case needs them.
 */
export type TransactionContext = {
  readonly sql: TransactionSql;
};

/**
 * The application service owns the transaction boundary. It decides what
 * belongs in one atomic unit and calls `run` once; repositories participate
 * through the context they are given.
 *
 * The callback must not call anything outside the database -- no model, email,
 * calendar, video provider, web fetch or OAuth exchange. A transaction that
 * waits on the network holds a connection and locks for the duration of
 * someone else's latency. Persist state and an intent row, commit, and let a
 * worker do the external work afterwards.
 */
export type TransactionManager = {
  readonly run: <T>(work: (tx: TransactionContext) => Promise<T>) => Promise<T>;
};

type DatabaseClientBase = {
  readonly sql: DatabaseExecutor;
  readonly transactions: TransactionManager;
  /** Drain the pool. Persistent services call this on graceful shutdown. */
  readonly close: () => Promise<void>;
};

/** Normal server application access. The least-privileged viable identity. */
export type RequestDatabase = DatabaseClientBase & {
  readonly accessClass: Extract<DatabaseAccessClass, "REQUEST">;
};

/**
 * Elevated access for narrowly scoped server processes.
 *
 * Elevated at the database is not authorised at the application. A privileged
 * client that bypasses row-level security still passes every operation through
 * ActorContext and AuthorizationService where business authorization applies.
 */
export type PrivilegedDatabase = DatabaseClientBase & {
  readonly accessClass: Extract<DatabaseAccessClass, "PRIVILEGED_SERVICE">;
};

/** Schema administration. Tooling only; never imported by runtime code. */
export type MigrationDatabase = DatabaseClientBase & {
  readonly accessClass: Extract<DatabaseAccessClass, "MIGRATION">;
};
