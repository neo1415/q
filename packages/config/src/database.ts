import { z } from "zod";

import {
  parseConfig,
  runtimeEnvShape,
  toRuntimeConfig,
  type EnvironmentInput,
  type RuntimeConfig,
} from "./common.js";
import { ConfigurationError } from "./errors.js";

/**
 * Server-only PostgreSQL configuration.
 *
 * DATABASE_URL is a secret. It never carries a NEXT_PUBLIC_ prefix, never
 * reaches a browser, a model prompt, a log line or an error response. It lives
 * under `secrets` so the type system keeps it apart from operational values.
 *
 * This is a standalone loader rather than part of the api/q-api/worker
 * schemas: no deployable has a repository yet, and a service should not require
 * a database URL at startup before it has anything to query.
 */

/**
 * How the driver reaches Postgres. Controls driver behaviour only -- no
 * security policy is inferred from it.
 *
 *   direct               a plain Postgres connection; local default
 *   session_pooler       Supabase Supavisor in session mode
 *   transaction_pooler   Supavisor in transaction mode; prepared statements
 *                        are unsupported there and are disabled by the client
 */
export const DATABASE_CONNECTION_MODES = [
  "direct",
  "session_pooler",
  "transaction_pooler",
] as const;

export type DatabaseConnectionMode = (typeof DATABASE_CONNECTION_MODES)[number];

/** Which logical class of access a client is for. Never interchangeable. */
export const DATABASE_ACCESS_CLASSES = [
  "REQUEST",
  "PRIVILEGED_SERVICE",
  "MIGRATION",
] as const;

export type DatabaseAccessClass = (typeof DATABASE_ACCESS_CLASSES)[number];

const POSTGRES_URL = /^postgres(?:ql)?:\/\/\S+$/;

const optionalPostgresUrl = z
  .string()
  .regex(POSTGRES_URL, "expected a postgresql:// connection string")
  .optional();

function boundedInt(defaultValue: number, min: number, max: number) {
  const expectation = `expected an integer between ${String(min)} and ${String(max)}`;
  return z.preprocess(
    (value) => (value === undefined || value === "" ? defaultValue : value),
    z.coerce
      .number(expectation)
      .int(expectation)
      .min(min, expectation)
      .max(max, expectation),
  );
}

const databaseEnvSchema = z.object({
  ...runtimeEnvShape,
  DATABASE_URL: z
    .string()
    .regex(POSTGRES_URL, "expected a postgresql:// connection string"),
  DATABASE_PRIVILEGED_URL: optionalPostgresUrl,
  DATABASE_MIGRATION_URL: optionalPostgresUrl,
  DATABASE_CONNECTION_MODE: z.enum(DATABASE_CONNECTION_MODES).default("direct"),
  // Bounded so a misconfiguration cannot open fifty connections per replica.
  // Total load is replicas × pool, and that product is what the database sees.
  DATABASE_POOL_MAX: boundedInt(5, 1, 20),
  DATABASE_IDLE_TIMEOUT_SECONDS: boundedInt(20, 1, 300),
  DATABASE_CONNECT_TIMEOUT_SECONDS: boundedInt(10, 1, 60),
  // Interactive request budget. Long rebuilds belong in workers with their own
  // limits, not in a request-path query allowed to run for minutes.
  DATABASE_STATEMENT_TIMEOUT_MS: boundedInt(10_000, 100, 60_000),
});

export type DatabaseConfig = {
  readonly runtime: RuntimeConfig;
  readonly connectionMode: DatabaseConnectionMode;
  readonly poolMax: number;
  readonly idleTimeoutSeconds: number;
  readonly connectTimeoutSeconds: number;
  readonly statementTimeoutMs: number;
  readonly secrets: {
    readonly url: string;
    readonly privilegedUrl: string | undefined;
    readonly migrationUrl: string | undefined;
  };
};

export function parseDatabaseConfig(env: EnvironmentInput): DatabaseConfig {
  const parsed = parseConfig("database", databaseEnvSchema, env);

  return {
    runtime: toRuntimeConfig(parsed),
    connectionMode: parsed.DATABASE_CONNECTION_MODE,
    poolMax: parsed.DATABASE_POOL_MAX,
    idleTimeoutSeconds: parsed.DATABASE_IDLE_TIMEOUT_SECONDS,
    connectTimeoutSeconds: parsed.DATABASE_CONNECT_TIMEOUT_SECONDS,
    statementTimeoutMs: parsed.DATABASE_STATEMENT_TIMEOUT_MS,
    secrets: {
      url: parsed.DATABASE_URL,
      privilegedUrl: parsed.DATABASE_PRIVILEGED_URL,
      migrationUrl: parsed.DATABASE_MIGRATION_URL,
    },
  };
}

/** Call once at a composition root, never per request. */
export function loadDatabaseConfig(): DatabaseConfig {
  return parseDatabaseConfig(process.env);
}

/**
 * The connection string for a given access class.
 *
 * The three classes are logically distinct even where they physically share an
 * endpoint. Locally and under test they may all resolve to DATABASE_URL, because
 * the local stack has no dedicated runtime roles yet. In any deployed
 * environment a missing privileged or migration URL is a hard failure: falling
 * back to the request credential there would silently change what authority a
 * process runs with, which is exactly the substitution this must prevent.
 *
 * Resolution is lazy -- at client creation, not config load -- so a deployment
 * that never creates a privileged client needs only DATABASE_URL.
 */
export function resolveDatabaseUrl(
  config: DatabaseConfig,
  accessClass: DatabaseAccessClass,
): string {
  const { deploymentEnvironment } = config.runtime;
  const mayShareLocalCredential =
    deploymentEnvironment === "local" || config.runtime.nodeEnv === "test";

  const dedicated =
    accessClass === "PRIVILEGED_SERVICE"
      ? config.secrets.privilegedUrl
      : accessClass === "MIGRATION"
        ? config.secrets.migrationUrl
        : config.secrets.url;

  if (dedicated !== undefined) {
    return dedicated;
  }

  if (mayShareLocalCredential) {
    return config.secrets.url;
  }

  const variable =
    accessClass === "PRIVILEGED_SERVICE"
      ? "DATABASE_PRIVILEGED_URL"
      : "DATABASE_MIGRATION_URL";

  throw new ConfigurationError("database", [
    {
      variable,
      reason: `required in ${deploymentEnvironment}; ${accessClass} access does not fall back to the request credential`,
    },
  ]);
}
