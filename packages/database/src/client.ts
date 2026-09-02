import {
  resolveDatabaseUrl,
  type DatabaseConfig,
} from "@capital-q/config/database";

import { createPostgresClient } from "./internal/postgres.js";
import { createTransactionManager } from "./transaction.js";
import type { RequestDatabase } from "./types.js";

/**
 * Normal server application database access.
 *
 * Create once per process and share it: a persistent service reuses its pool
 * for every request. Constructing a client per request would open a fresh pool
 * each time and exhaust the database's connection budget.
 *
 * Holding this client is not authority. The request path remains
 *
 *   request → ActorContext → AuthorizationService → use case → repository → DB
 *
 * and a row coming back from the database does not mean the caller was allowed
 * to see it.
 */
export function createRequestDatabaseClient(
  config: DatabaseConfig,
): RequestDatabase {
  const sql = createPostgresClient(
    resolveDatabaseUrl(config, "REQUEST"),
    config,
    "REQUEST",
  );

  return {
    accessClass: "REQUEST",
    sql,
    transactions: createTransactionManager(sql),
    close: () => sql.end(),
  };
}
