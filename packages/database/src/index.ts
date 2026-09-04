/**
 * @capital-q/database
 *
 * Owns: the server-only PostgreSQL client, the three access classes, the
 * transaction boundary and low-level query safety (doc 23, 91; ERA-031).
 *
 * Does not own, and must never become: the home of domain queries. There is no
 * `company.ts` here and there will be no generic `Repository<T>`. A domain's
 * repository lives with the domain, maps rows to its own types, and receives
 * an executor or transaction context from this package.
 *
 * Server-only. This package holds connection strings and opens sockets; it is
 * never imported by browser code, the UI package or the API client, and lint
 * enforces that. Q and the models it drives never receive a client, a
 * credential or a way to run SQL.
 *
 * PostgreSQL is the authoritative application state. Q interprets it, pgvector
 * retrieves from it, caches accelerate it, models reason over it. None of them
 * replaces it, and this package is the one path to it.
 *
 * Privileged and migration access are deliberately not exported from here.
 * Import them from `@capital-q/database/privileged` and
 * `@capital-q/database/migration`, so the intent is visible at every call site.
 */

export { createRequestDatabaseClient } from "./client.js";
export {
  createSavepointTransactionManager,
  createTransactionManager,
} from "./transaction.js";
export { checkDatabaseHealth, type DatabaseHealth } from "./health.js";
export {
  DATABASE_FAILURE_KINDS,
  DatabaseError,
  toDatabaseError,
  type DatabaseFailureKind,
} from "./errors.js";
export type {
  DatabaseExecutor,
  MigrationDatabase,
  PrivilegedDatabase,
  RequestDatabase,
  TransactionContext,
  TransactionManager,
} from "./types.js";

/**
 * Schema types generated from the local database by `pnpm db:types`. An
 * authoritative artifact of the migrations, not a hand-maintained interface.
 */
export type { Database, Json } from "./generated/database.types.js";

export const PACKAGE_NAME = "@capital-q/database" as const;
