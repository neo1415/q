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
  modelProviderEnvShape,
  toModelProviderSecrets,
  type ModelProviderSecrets,
} from "./model-providers.js";
import {
  researchProviderEnvShape,
  toResearchProviderSecrets,
  type ResearchProviderSecrets,
} from "./research-providers.js";
import {
  speechProviderEnvShape,
  toSpeechEngineIds,
  toSpeechProviderSecrets,
  type SpeechEngineIds,
  type SpeechProviderSecrets,
} from "./speech-providers.js";
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
  // Model provider keys (CQ-Q-005). Each optional: the Model Gateway routes
  // around an unconfigured provider, and a service with neither still
  // starts — model-capable tasks then fail safely as "unavailable".
  ...modelProviderEnvShape,
  // Public-web research provider key (CQ-Q-RESEARCH-001). Optional: without
  // it the research tools are not composed and Q answers from Capital Q alone.
  ...researchProviderEnvShape,
  // Realtime speech provider (CQ-Q-VOICE-001 C). Optional: without the key
  // and a Speech Engine id the voice routes are not registered.
  ...speechProviderEnvShape,
  // Where the application API is, so a spoken interview answer reaches the
  // same onboarding session a typed one does. Optional: without it voice
  // carries Q conversations only.
  CQ_API_URL: z.string().url("expected an absolute http(s) URL").optional(),
});

/**
 * Q configuration is kept separate from the application API even though the
 * two currently hold identical fields. Q will acquire model-provider routing,
 * run budgets and checkpoint settings; none of that belongs in the normal API's
 * configuration surface.
 */
export type QApiSecrets = {
  /** Server-only. Never serialised, logged, or handed to a client or a prompt. */
  readonly modelProviders: ModelProviderSecrets;
  /** Server-only. Read once by the research adapter at composition. */
  readonly researchProviders: ResearchProviderSecrets;
  /** Server-only. Read once by the speech adapter at composition. */
  readonly speechProviders: SpeechProviderSecrets;
};

export type QApiVoiceConfig = {
  /** The Speech Engine resources this environment speaks through; absent means no voice. */
  readonly speechEngines: SpeechEngineIds | undefined;
  /** The application API origin for spoken interview turns; absent means Q conversations only. */
  readonly apiBaseUrl: string | undefined;
};

export type QApiPublicConfig = Readonly<Record<string, never>>;

export type QApiConfig = {
  readonly runtime: RuntimeConfig;
  readonly observability: ObservabilityConfig;
  readonly network: NetworkConfig;
  /** Supabase Auth verification settings; absent means "not configured". */
  readonly supabaseAuth: SupabaseAuthConfig | undefined;
  readonly public: QApiPublicConfig;
  readonly voice: QApiVoiceConfig;
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
    voice: {
      speechEngines: toSpeechEngineIds(parsed),
      apiBaseUrl: parsed.CQ_API_URL?.replace(/\/$/, ""),
    },
    secrets: {
      modelProviders: toModelProviderSecrets(parsed),
      researchProviders: toResearchProviderSecrets(parsed),
      speechProviders: toSpeechProviderSecrets(parsed),
    },
  };
}

/** Call once at the composition root, never per Q run. */
export function loadQApiConfig(): QApiConfig {
  return parseQApiConfig(process.env);
}
