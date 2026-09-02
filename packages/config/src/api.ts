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

/** Local default. Hosting platforms inject PORT. */
export const API_DEFAULT_PORT = 3001;

const apiEnvSchema = z.object({
  ...runtimeEnvShape,
  ...observabilityEnvShape,
  ...networkEnvShape(API_DEFAULT_PORT),
});

/**
 * No API secrets exist yet. Database, provider and signing credentials land
 * here through the packet that introduces each provider -- they are not
 * declared in advance.
 */
export type ApiSecrets = Readonly<Record<string, never>>;

/** Non-secret operational values safe to expose in diagnostics. None yet. */
export type ApiPublicConfig = Readonly<Record<string, never>>;

export type ApiConfig = {
  readonly runtime: RuntimeConfig;
  readonly observability: ObservabilityConfig;
  readonly network: NetworkConfig;
  readonly public: ApiPublicConfig;
  readonly secrets: ApiSecrets;
};

export function parseApiConfig(env: EnvironmentInput): ApiConfig {
  const parsed = parseConfig("api", apiEnvSchema, env);
  const runtime = toRuntimeConfig(parsed);

  return {
    runtime,
    observability: toObservabilityConfig(parsed, runtime),
    network: { host: parsed.HOST, port: parsed.PORT },
    public: {},
    secrets: {},
  };
}

/** Call once at the composition root, never per request. */
export function loadApiConfig(): ApiConfig {
  return parseApiConfig(process.env);
}
