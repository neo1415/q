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
import {
  supabaseAuthEnvShape,
  toSupabaseAuthConfig,
  type SupabaseAuthConfig,
} from "./supabase-auth.js";

/** Local default. Hosting platforms inject PORT. */
export const API_DEFAULT_PORT = 3001;

const apiEnvSchema = z.object({
  ...runtimeEnvShape,
  ...observabilityEnvShape,
  ...networkEnvShape(API_DEFAULT_PORT),
  // Optional at parse time so tooling and tests can build a config without an
  // Auth server. The composition root refuses to start without it: a service
  // that cannot verify sessions must not serve protected routes.
  SUPABASE_URL: supabaseAuthEnvShape.SUPABASE_URL.optional(),
  SUPABASE_PUBLISHABLE_KEY:
    supabaseAuthEnvShape.SUPABASE_PUBLISHABLE_KEY.optional(),
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
  /** Supabase Auth verification settings; absent means "not configured". */
  readonly supabaseAuth: SupabaseAuthConfig | undefined;
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
    supabaseAuth:
      parsed.SUPABASE_URL !== undefined &&
      parsed.SUPABASE_PUBLISHABLE_KEY !== undefined
        ? toSupabaseAuthConfig({
            SUPABASE_URL: parsed.SUPABASE_URL,
            SUPABASE_PUBLISHABLE_KEY: parsed.SUPABASE_PUBLISHABLE_KEY,
          })
        : undefined,
    public: {},
    secrets: {},
  };
}

/** Call once at the composition root, never per request. */
export function loadApiConfig(): ApiConfig {
  return parseApiConfig(process.env);
}
