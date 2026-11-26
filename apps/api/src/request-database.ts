import type { ApiConfig } from "@capital-q/config/api";
import type { DatabaseConfig } from "@capital-q/config/database";
import {
  checkDatabaseReadiness,
  createRequestDatabaseClient,
  type RequestDatabase,
} from "@capital-q/database";
import { createLogger } from "@capital-q/observability";

import { apiServiceIdentity } from "./app.js";

/**
 * The api's request-class database client (one pool per process). W2-C
 * step 3 (ADR 0082): RLS shadow mode logs RLS_WOULD_DENY and
 * RLS_SHADOW_ERROR here; it is off unless DATABASE_RLS_CLAIMS=on and
 * DATABASE_RLS_SHADOW names a schema.
 */
export function requestDatabase(
  databaseConfig: DatabaseConfig,
  config: ApiConfig,
): RequestDatabase {
  return createRequestDatabaseClient(databaseConfig, {
    service: "api",
    logger: createLogger(apiServiceIdentity(config), {
      level: config.observability.logLevel,
    }),
  });
}

/** What /health/ready asks: the database, and the RLS shadow counts. */
export function readinessProbes(database: RequestDatabase) {
  return {
    database: () => checkDatabaseReadiness(database.sql),
    rlsShadow: () => database.rlsShadow?.read() ?? {},
  };
}
