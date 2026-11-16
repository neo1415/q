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
  // Where LISTEN connects when queries go through the transaction pooler.
  // LISTEN holds a session open to receive notifications; a transaction-mode
  // pooler hands the server connection to another client after every
  // transaction, so notifications are never delivered there. Unset with a
  // :6543 DATABASE_URL, it is that URL on Supavisor's session port (5432):
  // same host, user and password, so no second secret has to be managed.
  DATABASE_LISTEN_URL: optionalPostgresUrl,
  DATABASE_CONNECTION_MODE: z.enum(DATABASE_CONNECTION_MODES).default("direct"),
  // Bounded so a misconfiguration cannot open fifty connections per replica.
  // Total load is replicas × pool, and that product is what the database sees.
  DATABASE_POOL_MAX: boundedInt(5, 1, 20),
  // Sized against Supavisor session mode (port 5432): every open client
  // connection pins one of the pool's server connections (15 on this tier,
  // max_connections 60) for as long as it stays open. 60 s lets a page's burst
  // of parallel queries reuse its connections across the next navigation
  // instead of reconnecting (~5-6 round trips each: TCP, TLS, Supavisor auth,
  // type fetch; R4 measured 9.4 ms per round trip), while still handing burst
  // connections back within a minute.
  DATABASE_IDLE_TIMEOUT_SECONDS: boundedInt(60, 1, 300),
  // Warm floor: one `select 1` every N seconds. The driver hands queries to
  // open connections first-in-first-out, so a ping every W seconds keeps k
  // connections alive while k * W < idle timeout: 25 s against 60 s keeps two
  // warm per process. Three services hold ~6 of 15 slots at rest (+1 LISTEN),
  // leaving the rest for bursts. 0 turns it off.
  DATABASE_WARM_INTERVAL_SECONDS: boundedInt(25, 0, 240),
  DATABASE_CONNECT_TIMEOUT_SECONDS: boundedInt(10, 1, 60),
  // Interactive request budget. Long rebuilds belong in workers with their own
  // limits, not in a request-path query allowed to run for minutes. A
  // service whose work is batch (workers) passes its own default to
  // loadDatabaseConfig; the variable still overrides it. Enforced on every
  // connection mode (packages/database: startup parameter, SET LOCAL per
  // transaction behind a pooler, and a client-side deadline per query),
  // because Supavisor drops startup parameters (16 Nov 2026).
  DATABASE_STATEMENT_TIMEOUT_MS: boundedInt(10_000, 100, 300_000),
});

export type DatabaseConfig = {
  readonly runtime: RuntimeConfig;
  readonly connectionMode: DatabaseConnectionMode;
  readonly poolMax: number;
  readonly idleTimeoutSeconds: number;
  /** 0 = no warm ping. Always below idleTimeoutSeconds when set. */
  readonly warmIntervalSeconds: number;
  readonly connectTimeoutSeconds: number;
  readonly statementTimeoutMs: number;
  readonly secrets: {
    readonly url: string;
    readonly privilegedUrl: string | undefined;
    readonly migrationUrl: string | undefined;
    /**
     * The session connection LISTEN uses, set only in transaction_pooler
     * mode (explicit or derived). Undefined: LISTEN rides the request pool's
     * own dedicated connection, as it always has.
     */
    readonly listenUrl: string | undefined;
  };
};

/** Supavisor's ports on one host: transaction mode and session mode. */
const SUPAVISOR_TRANSACTION_PORT = "6543";
const SUPAVISOR_SESSION_PORT = "5432";
const HOST_PORT = /(@[^/?#@]+):(\d+)(?=[/?#]|$)/;

/**
 * The same connection string on Supavisor's session port, or undefined when
 * the URL is not on the transaction port. Only the port changes; nothing of
 * the URL is ever logged or returned in an error.
 */
export function supavisorSessionUrl(url: string): string | undefined {
  const match = HOST_PORT.exec(url);
  if (match?.[2] !== SUPAVISOR_TRANSACTION_PORT) return undefined;
  return url.replace(HOST_PORT, `$1:${SUPAVISOR_SESSION_PORT}`);
}

/** Per-service defaults; an explicit environment variable still wins. */
export type DatabaseConfigDefaults = {
  /** The statement budget when DATABASE_STATEMENT_TIMEOUT_MS is unset. */
  readonly statementTimeoutMs?: number | undefined;
};

export function parseDatabaseConfig(
  env: EnvironmentInput,
  defaults: DatabaseConfigDefaults = {},
): DatabaseConfig {
  const statementDefault = defaults.statementTimeoutMs;
  const input =
    statementDefault !== undefined &&
    (env["DATABASE_STATEMENT_TIMEOUT_MS"] ?? "") === ""
      ? { ...env, DATABASE_STATEMENT_TIMEOUT_MS: String(statementDefault) }
      : env;
  const parsed = parseConfig("database", databaseEnvSchema, input);
  if (
    parsed.DATABASE_WARM_INTERVAL_SECONDS !== 0 &&
    parsed.DATABASE_WARM_INTERVAL_SECONDS >=
      parsed.DATABASE_IDLE_TIMEOUT_SECONDS
  ) {
    // A ping slower than the idle timeout keeps nothing warm; say so at boot.
    throw new ConfigurationError("database", [
      {
        variable: "DATABASE_WARM_INTERVAL_SECONDS",
        reason: "expected 0 or a value below DATABASE_IDLE_TIMEOUT_SECONDS",
      },
    ]);
  }

  let listenUrl: string | undefined;
  if (parsed.DATABASE_CONNECTION_MODE === "transaction_pooler") {
    listenUrl =
      parsed.DATABASE_LISTEN_URL ?? supavisorSessionUrl(parsed.DATABASE_URL);
    if (listenUrl === undefined) {
      // Fail at boot rather than run with wake-ups that silently never come.
      throw new ConfigurationError("database", [
        {
          variable: "DATABASE_LISTEN_URL",
          reason:
            "required with DATABASE_CONNECTION_MODE=transaction_pooler unless DATABASE_URL is on port 6543",
        },
      ]);
    }
  }

  return {
    runtime: toRuntimeConfig(parsed),
    connectionMode: parsed.DATABASE_CONNECTION_MODE,
    poolMax: parsed.DATABASE_POOL_MAX,
    idleTimeoutSeconds: parsed.DATABASE_IDLE_TIMEOUT_SECONDS,
    warmIntervalSeconds: parsed.DATABASE_WARM_INTERVAL_SECONDS,
    connectTimeoutSeconds: parsed.DATABASE_CONNECT_TIMEOUT_SECONDS,
    statementTimeoutMs: parsed.DATABASE_STATEMENT_TIMEOUT_MS,
    secrets: {
      url: parsed.DATABASE_URL,
      privilegedUrl: parsed.DATABASE_PRIVILEGED_URL,
      migrationUrl: parsed.DATABASE_MIGRATION_URL,
      listenUrl,
    },
  };
}

/** Call once at a composition root, never per request. */
export function loadDatabaseConfig(
  defaults: DatabaseConfigDefaults = {},
): DatabaseConfig {
  return parseDatabaseConfig(process.env, defaults);
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
