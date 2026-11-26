import {
  resolveDatabaseUrl,
  type DatabaseConfig,
} from "@capital-q/config/database";

import type { Sql } from "postgres";

import {
  createPostgresClient,
  createPostgresListenClient,
  transactionLimitsFor,
} from "./internal/postgres.js";
import { createRlsShadowCounter, type RlsShadowLogger } from "./rls-shadow.js";
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
  options: {
    /** W2-C step 3: the service named in an RLS shadow log line. */
    readonly service?: string | undefined;
    /** W2-C step 3: where RLS_WOULD_DENY / RLS_SHADOW_ERROR are logged. */
    readonly logger?: RlsShadowLogger | undefined;
  } = {},
): RequestDatabase {
  const sql = createPostgresClient(
    resolveDatabaseUrl(config, "REQUEST"),
    config,
    "REQUEST",
  );

  // Transaction-pooler mode: LISTEN needs a session, so it gets its own
  // client on the session URL (one connection, opened at the first listen).
  // Every other mode keeps LISTEN on the request client, unchanged.
  const listenUrl = config.secrets.listenUrl;
  const listener =
    listenUrl === undefined
      ? sql
      : createPostgresListenClient(listenUrl, config, "REQUEST");

  const stopWarm = keepWarm(sql, config.warmIntervalSeconds);
  const shadowCounter = createRlsShadowCounter();
  return {
    accessClass: "REQUEST",
    sql,
    rlsShadow: { read: shadowCounter.read },
    transactions: createTransactionManager(sql, {
      limits: transactionLimitsFor(config, "REQUEST"),
      // W2-C (ADR 0082): off unless DATABASE_RLS_CLAIMS=on.
      rlsClaims: config.rlsClaims,
      // W2-C step 3: off unless DATABASE_RLS_SHADOW names a schema (and
      // claims are on); see rls-shadow.ts.
      rlsShadow:
        config.rlsShadow === undefined
          ? undefined
          : {
              schemas: config.rlsShadow.schemas,
              sample: config.rlsShadow.sample,
              service: options.service,
              logger: options.logger,
              counter: shadowCounter,
            },
    }),
    listen: (channel, onNotify, onListen) =>
      listener.listen(channel, onNotify, onListen),
    close: async () => {
      stopWarm();
      await Promise.all([sql.end(), listener === sql ? null : listener.end()]);
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
