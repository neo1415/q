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
  supabaseSecretKeySchema,
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
  // Storage authority (CQ-EVD-002). Optional: without it the document
  // upload boundary is closed rather than open, and the rest of the API
  // still serves. It never reaches a browser.
  SUPABASE_SECRET_KEY: supabaseSecretKeySchema.optional(),
  // Adjustable implementation limit, not a locked product decision. Bounded
  // by the 50 MiB ceiling a document version may ever carry.
  CQ_DOCUMENT_UPLOAD_MAX_BYTES: z.coerce
    .number()
    .int()
    .min(1024)
    .max(52428800)
    .default(26214400),
});

/**
 * Server-only credentials. Never logged, never returned, never bundled.
 * Each lands here through the packet that introduces its provider.
 */
export type ApiSecrets = {
  /** Privileged Supabase key for private document storage. */
  readonly supabaseSecretKey: string | undefined;
};

/** Non-secret operational values safe to expose in diagnostics. */
export type ApiPublicConfig = {
  readonly documentUploadMaxBytes: number;
};

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
    public: { documentUploadMaxBytes: parsed.CQ_DOCUMENT_UPLOAD_MAX_BYTES },
    secrets: { supabaseSecretKey: parsed.SUPABASE_SECRET_KEY },
  };
}

/** Call once at the composition root, never per request. */
export function loadApiConfig(): ApiConfig {
  return parseApiConfig(process.env);
}
