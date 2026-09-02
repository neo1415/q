import postgres, { type Sql } from "postgres";

import type {
  DatabaseAccessClass,
  DatabaseConfig,
} from "@capital-q/config/database";

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
  readonly connection: {
    readonly application_name: string;
    readonly statement_timeout: number;
  };
};

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
    connection: {
      // Visible in pg_stat_activity, so an operator can see which access
      // class holds which connections without reading application code.
      application_name: `capital-q:${accessClass.toLowerCase()}`,
      statement_timeout: config.statementTimeoutMs,
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
  return postgres(
    connectionString,
    resolvePostgresOptions(config, accessClass),
  );
}
