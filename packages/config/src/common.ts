import { z } from "zod";
import { ConfigurationError, type ConfigurationIssue } from "./errors.js";

/**
 * The raw process environment at the trust boundary. Every value is a string or
 * absent -- numbers and booleans do not exist here and must be parsed
 * explicitly, never inferred from JavaScript truthiness (ERA-017).
 */
export type EnvironmentInput = Readonly<Record<string, string | undefined>>;

/** Node's runtime mode. Set by tooling, not by Capital Q. */
export const NODE_ENVS = ["development", "test", "production"] as const;

/**
 * Capital Q's deployment class. A different concept from NODE_ENV: a preview
 * deployment runs with `NODE_ENV=production` but is not the production
 * environment.
 *
 * This is operational metadata. It is not an authorization or security
 * boundary, and no permission decision may depend on it.
 */
export const DEPLOYMENT_ENVIRONMENTS = [
  "local",
  "preview",
  "staging",
  "production",
] as const;

export type NodeEnv = (typeof NODE_ENVS)[number];
export type DeploymentEnvironment = (typeof DEPLOYMENT_ENVIRONMENTS)[number];

export type RuntimeConfig = {
  readonly nodeEnv: NodeEnv;
  readonly deploymentEnvironment: DeploymentEnvironment;
};

export type NetworkConfig = {
  readonly host: string;
  readonly port: number;
};

/** Runtime variables every deployable shares. */
export const runtimeEnvShape = {
  NODE_ENV: z.enum(NODE_ENVS).default("development"),
  CAPITAL_Q_ENV: z.enum(DEPLOYMENT_ENVIRONMENTS).default("local"),
};

/**
 * Network variables for deployables that listen. `PORT` is commonly injected by
 * the hosting platform.
 *
 * An absent PORT falls back to the service default; an explicitly invalid PORT
 * fails rather than silently becoming the default, so a typo cannot quietly
 * move a service to another port.
 */
const PORT_EXPECTATION = "expected an integer between 1 and 65535";

export function networkEnvShape(defaultPort: number) {
  return {
    HOST: z.string().min(1, "expected a non-empty host").default("0.0.0.0"),
    PORT: z.preprocess(
      (value) => (value === undefined || value === "" ? defaultPort : value),
      z.coerce
        .number(PORT_EXPECTATION)
        .int(PORT_EXPECTATION)
        .min(1, PORT_EXPECTATION)
        .max(65535, PORT_EXPECTATION),
    ),
  };
}

/**
 * Log levels. `silent` exists so test runs are not noisy; it is not a
 * production setting.
 */
export const LOG_LEVELS = ["debug", "info", "warn", "error", "silent"] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

export type ObservabilityConfig = {
  readonly logLevel: LogLevel;
  /**
   * Injected by CI/deployment as a git SHA or release id. Genuinely absent
   * locally -- a hardcoded "1.0.0" would be a lie in telemetry.
   */
  readonly serviceVersion: string | undefined;
  readonly region: string | undefined;
};

export const observabilityEnvShape = {
  LOG_LEVEL: z.enum(LOG_LEVELS).optional(),
  SERVICE_VERSION: z.string().min(1).optional(),
  REGION: z.string().min(1).optional(),
};

/**
 * Verbose logging is useful locally and wasteful in production. Tests stay
 * silent so a passing suite is readable.
 */
function defaultLogLevel(
  nodeEnv: NodeEnv,
  deploymentEnvironment: DeploymentEnvironment,
): LogLevel {
  if (nodeEnv === "test") {
    return "silent";
  }

  return deploymentEnvironment === "local" ? "debug" : "info";
}

export function toObservabilityConfig(
  parsed: {
    readonly LOG_LEVEL?: LogLevel | undefined;
    readonly SERVICE_VERSION?: string | undefined;
    readonly REGION?: string | undefined;
  },
  runtime: RuntimeConfig,
): ObservabilityConfig {
  return {
    logLevel:
      parsed.LOG_LEVEL ??
      defaultLogLevel(runtime.nodeEnv, runtime.deploymentEnvironment),
    serviceVersion: parsed.SERVICE_VERSION,
    region: parsed.REGION,
  };
}

type ZodIssue = z.ZodError["issues"][number];

/**
 * Values shorter than this are not redacted, so that legitimate short tokens in
 * a message -- enum options such as "test" -- are not mangled. Secrets are long.
 */
const MIN_REDACTABLE_LENGTH = 6;

/**
 * Remove any supplied environment value that appears in a message.
 *
 * Zod 4's built-in messages describe what was expected rather than echoing the
 * input, so this is defence in depth rather than the primary control: it holds
 * even if a future Zod version, a custom refinement, or a third-party check
 * starts including received values.
 */
function redactValues(message: string, env: EnvironmentInput): string {
  let safe = message;

  for (const value of Object.values(env)) {
    if (value !== undefined && value.length >= MIN_REDACTABLE_LENGTH) {
      safe = safe.split(value).join("[redacted]");
    }
  }

  return safe;
}

function toIssues(
  error: z.ZodError,
  env: EnvironmentInput,
): readonly ConfigurationIssue[] {
  return error.issues.map((issue: ZodIssue) => ({
    variable: issue.path.map(String).join(".") || "(root)",
    reason: redactValues(issue.message, env),
  }));
}

/**
 * Validate an environment against a service schema, or throw a safe error.
 *
 * Unknown keys are ignored rather than rejected: the process environment
 * legitimately contains PATH, HOME, CI and platform variables that are not
 * Capital Q's to validate. Each schema owns only its own variables.
 */
export function parseConfig<TSchema extends z.ZodType>(
  service: string,
  schema: TSchema,
  env: EnvironmentInput,
): z.infer<TSchema> {
  const result = schema.safeParse(env);

  if (!result.success) {
    throw new ConfigurationError(service, toIssues(result.error, env));
  }

  return result.data;
}

export function toRuntimeConfig(parsed: {
  readonly NODE_ENV: NodeEnv;
  readonly CAPITAL_Q_ENV: DeploymentEnvironment;
}): RuntimeConfig {
  return {
    nodeEnv: parsed.NODE_ENV,
    deploymentEnvironment: parsed.CAPITAL_Q_ENV,
  };
}
