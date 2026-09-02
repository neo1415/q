import { z } from "zod";
import {
  networkEnvShape,
  observabilityEnvShape,
  parseConfig,
  runtimeEnvShape,
  toObservabilityConfig,
  toRuntimeConfig,
  type EnvironmentInput,
  type ObservabilityConfig,
  type NetworkConfig,
  type RuntimeConfig,
} from "./common.js";

/** Local default. Distinct from the API so both can run concurrently. */
export const Q_API_DEFAULT_PORT = 3002;

const qApiEnvSchema = z.object({
  ...runtimeEnvShape,
  ...observabilityEnvShape,
  ...networkEnvShape(Q_API_DEFAULT_PORT),
});

/**
 * Q configuration is kept separate from the application API even though the
 * two currently hold identical fields. Q will acquire model-provider routing,
 * run budgets and checkpoint settings; none of that belongs in the normal API's
 * configuration surface.
 */
export type QApiSecrets = Readonly<Record<string, never>>;

export type QApiPublicConfig = Readonly<Record<string, never>>;

export type QApiConfig = {
  readonly runtime: RuntimeConfig;
  readonly observability: ObservabilityConfig;
  readonly network: NetworkConfig;
  readonly public: QApiPublicConfig;
  readonly secrets: QApiSecrets;
};

export function parseQApiConfig(env: EnvironmentInput): QApiConfig {
  const parsed = parseConfig("q-api", qApiEnvSchema, env);
  const runtime = toRuntimeConfig(parsed);

  return {
    runtime,
    observability: toObservabilityConfig(parsed, runtime),
    network: { host: parsed.HOST, port: parsed.PORT },
    public: {},
    secrets: {},
  };
}

/** Call once at the composition root, never per Q run. */
export function loadQApiConfig(): QApiConfig {
  return parseQApiConfig(process.env);
}
