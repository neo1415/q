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

/** Local default. Distinct from the API so both can run concurrently. */
export const Q_API_DEFAULT_PORT = 3002;

const qApiEnvSchema = z.object({
  ...runtimeEnvShape,
  ...observabilityEnvShape,
  ...networkEnvShape(Q_API_DEFAULT_PORT),
  // Optional at parse time so tooling and tests can build a config without an
  // Auth server. The composition root refuses to start without it: a service
  // that cannot verify sessions must not serve protected routes.
  SUPABASE_URL: supabaseAuthEnvShape.SUPABASE_URL.optional(),
  SUPABASE_PUBLISHABLE_KEY:
    supabaseAuthEnvShape.SUPABASE_PUBLISHABLE_KEY.optional(),
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
  /** Supabase Auth verification settings; absent means "not configured". */
  readonly supabaseAuth: SupabaseAuthConfig | undefined;
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

/** Call once at the composition root, never per Q run. */
export function loadQApiConfig(): QApiConfig {
  return parseQApiConfig(process.env);
}
