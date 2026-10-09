import {
  resolveDatabaseUrl,
  type DatabaseConfig,
} from "@capital-q/config/database";

import type { Sql } from "postgres";

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

  const stopWarm = keepWarm(sql, config.warmIntervalSeconds);
  return {
    accessClass: "REQUEST",
    sql,
    transactions: createTransactionManager(sql),
    listen: (channel, onNotify, onListen) =>
      sql.listen(channel, onNotify, onListen),
    close: () => {
      stopWarm();
      return sql.end();
    },
  };
}

/**
 * A warm floor for the pool (see DATABASE_WARM_INTERVAL_SECONDS): a cheap
 * `select 1` on a timer, so the first query after a quiet spell does not pay
 * a fresh connection's TCP + TLS + pooler auth + type fetch. The timer is
 * unref'd (it never keeps a process alive) and a failed ping is ignored: the
 * next real query reconnects as it always did. It runs outside any request,
 * so it is never counted in a request's round trips.
 */
function keepWarm(sql: Sql, intervalSeconds: number): () => void {
  if (intervalSeconds <= 0) return () => undefined;
  const timer = setInterval(() => {
    sql`select 1`.catch(() => undefined);
  }, intervalSeconds * 1_000);
  timer.unref();
  return () => {
    clearInterval(timer);
  };
}
