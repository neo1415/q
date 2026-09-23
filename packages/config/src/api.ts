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
  modelProviderConfigStatus,
  modelProviderEnvShape,
  toModelProviderSecrets,
  type ModelProviderConfigStatus,
  type ModelProviderSecrets,
} from "./model-providers.js";
import {
  supabaseAuthEnvShape,
  supabaseSecretKeySchema,
  toSupabaseAuthConfig,
  type SupabaseAuthConfig,
} from "./supabase-auth.js";
import {
  toVideoProviderSecrets,
  videoProviderConfigStatus,
  videoProviderEnvShape,
  type VideoProviderConfigStatus,
  type VideoProviderSecrets,
} from "./video-providers.js";

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
  // Inference credentials (CQ-GATE-002). The API serves the GateQ
  // applicant interview, which is a model-backed conversation. Optional:
  // with no provider configured the applicant surface does not register at
  // all, which is a closed front door rather than a broken one.
  ...modelProviderEnvShape,
  // Where the one Q interviewer runs (QX-004 core gate: one Q). The
  // conversational onboarding turn is delegated to it rather than answered
  // by a second implementation here. Optional: with no URL the /say route
  // closes, which is a closed door rather than a quietly worse Q.
  CQ_Q_API_URL: z.string().url("expected an absolute http(s) URL").optional(),
  // Pitch video (CQ-MEDIA-010). Optional: without it the Media context
  // composes an explicit unconfigured provider that refuses every upload
  // and playback by name, and the rest of the API still serves.
  ...videoProviderEnvShape,
});

/**
 * Server-only credentials. Never logged, never returned, never bundled.
 * Each lands here through the packet that introduces its provider.
 */
export type ApiSecrets = {
  /** Privileged Supabase key for private document storage. */
  readonly supabaseSecretKey: string | undefined;
  /** Inference credentials for the GateQ applicant interview. */
  readonly modelProviders: ModelProviderSecrets;
  /** Cloudflare Stream credentials for pitch video. */
  readonly videoProviders: VideoProviderSecrets;
};

/** Non-secret operational values safe to expose in diagnostics. */
export type ApiPublicConfig = {
  readonly documentUploadMaxBytes: number;
  /** Absolute base URL of the Q service, or undefined when not composed. */
  readonly qApiBaseUrl: string | undefined;
  /** Which providers are configured. Names and booleans, never keys. */
  readonly modelProviders: ModelProviderConfigStatus;
  /** Whether pitch video can be uploaded and played. Names, never keys. */
  readonly videoProviders: VideoProviderConfigStatus;
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
  const videoProviders = toVideoProviderSecrets(parsed);

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
    public: {
      documentUploadMaxBytes: parsed.CQ_DOCUMENT_UPLOAD_MAX_BYTES,
      qApiBaseUrl: parsed.CQ_Q_API_URL?.replace(/\/$/, ""),
      modelProviders: modelProviderConfigStatus(toModelProviderSecrets(parsed)),
      videoProviders: videoProviderConfigStatus(videoProviders),
    },
    secrets: {
      supabaseSecretKey: parsed.SUPABASE_SECRET_KEY,
      modelProviders: toModelProviderSecrets(parsed),
      videoProviders,
    },
  };
}

/** Call once at the composition root, never per request. */
export function loadApiConfig(): ApiConfig {
  return parseApiConfig(process.env);
}
