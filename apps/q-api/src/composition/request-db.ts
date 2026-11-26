import type { DatabaseConfig } from "@capital-q/config/database";
import type { QApiConfig } from "@capital-q/config/q-api";
import {
  checkDatabaseReadiness,
  createRequestDatabaseClient,
  type RequestDatabase,
} from "@capital-q/database";
import { createLogger } from "@capital-q/observability";

import { SERVICE_NAME } from "../app.js";

/**
 * q-api's request-class database client (one pool per process). W2-C
 * step 3 (ADR 0082): RLS shadow mode logs RLS_WOULD_DENY and
 * RLS_SHADOW_ERROR here; it is off unless DATABASE_RLS_CLAIMS=on and
 * DATABASE_RLS_SHADOW names a schema.
 */
export function requestDatabase(
  databaseConfig: DatabaseConfig,
  config: QApiConfig,
): RequestDatabase {
  return createRequestDatabaseClient(databaseConfig, {
    service: SERVICE_NAME,
    logger: createLogger(
      {
        serviceName: SERVICE_NAME,
        environment: config.runtime.deploymentEnvironment,
        serviceVersion: config.observability.serviceVersion,
        region: config.observability.region,
      },
      { level: config.observability.logLevel },
    ),
  });
}

/** What /health/ready asks: the database, and the RLS shadow counts. */
export function readinessProbes(database: RequestDatabase) {
  return {
    database: () => checkDatabaseReadiness(database.sql),
    rlsShadow: () => database.rlsShadow?.read() ?? {},
  };
}
