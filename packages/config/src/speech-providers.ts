import { z } from "zod";

import { ProviderCredential } from "./model-providers.js";

/**
 * Realtime speech provider configuration (CQ-Q-VOICE-001 C §29-§31, rework).
 *
 * Two transports, both with Q as the brain on this server:
 *
 *   - Deepgram Voice Agent: speech in, speech out, and every "think" call
 *     made back to this server's own endpoint. Needs one key and this
 *     server's public URL (the one the tunnel exposes in development).
 *   - ElevenLabs Speech Engine: the original transport; needs the key and
 *     two Speech Engine resources.
 *
 * `Q_VOICE_PROVIDER` picks; unset, Deepgram is used when its key exists,
 * else ElevenLabs when its engines exist, else there is no voice. Keys are
 * server-only and revealed once at composition.
 */

export const SPEECH_PROVIDER_ENV_NAMES = [
  "ELEVENLABS_API_KEY",
  "ELEVENLABS_SPEECH_ENGINE_ID",
  "ELEVENLABS_SPEECH_ENGINE_ID_MALE",
  "DEEPGRAM_API_KEY",
] as const;

export const VOICE_PROVIDER_CODES = ["deepgram", "elevenlabs"] as const;
export type VoiceProviderCode = (typeof VOICE_PROVIDER_CODES)[number];

const apiKey = z
  .string()
  .trim()
  .min(16, "expected a provider API key")
  .max(512, "expected a provider API key");

const engineId = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{4,128}$/, "expected a Speech Engine id");

export const speechProviderEnvShape = {
  ELEVENLABS_API_KEY: apiKey.optional(),
  ELEVENLABS_SPEECH_ENGINE_ID: engineId.optional(),
  ELEVENLABS_SPEECH_ENGINE_ID_MALE: engineId.optional(),
  DEEPGRAM_API_KEY: apiKey.optional(),
  /** Which transport carries the voice; see the module note for the default. */
  Q_VOICE_PROVIDER: z.enum(VOICE_PROVIDER_CODES).optional(),
  /**
   * This server's public origin, reachable by the speech provider (the
   * tunnel in development). Deepgram calls the think endpoint through it.
   */
  Q_API_PUBLIC_URL: z
    .string()
    .url("expected an absolute http(s) URL")
    .optional(),
};

export type SpeechProviderSecrets = {
  /** ElevenLabs; absent means the Speech Engine transport is not composed. */
  readonly elevenLabs: ProviderCredential | undefined;
  /** Deepgram; absent means the Voice Agent transport is not composed. */
  readonly deepgram: ProviderCredential | undefined;
};

export type SpeechEngineIds = {
  /** The default voice (female, warm, professional). Required for voice. */
  readonly default: string;
  /** The male alternative; absent means the picker offers one voice. */
  readonly male: string | undefined;
};

export type SpeechProviderConfigStatus = {
  readonly elevenLabs: "configured" | "unconfigured";
  readonly deepgram: "configured" | "unconfigured";
  readonly speechEngines: "configured" | "unconfigured";
  readonly provider: VoiceProviderCode | "none";
  readonly voices: readonly ("FEMALE" | "MALE")[];
};

export function toSpeechProviderSecrets(parsed: {
  readonly ELEVENLABS_API_KEY?: string | undefined;
  readonly DEEPGRAM_API_KEY?: string | undefined;
}): SpeechProviderSecrets {
  return {
    elevenLabs:
      parsed.ELEVENLABS_API_KEY === undefined
        ? undefined
        : new ProviderCredential(parsed.ELEVENLABS_API_KEY),
    deepgram:
      parsed.DEEPGRAM_API_KEY === undefined
        ? undefined
        : new ProviderCredential(parsed.DEEPGRAM_API_KEY),
  };
}

export function toSpeechEngineIds(parsed: {
  readonly ELEVENLABS_SPEECH_ENGINE_ID?: string | undefined;
  readonly ELEVENLABS_SPEECH_ENGINE_ID_MALE?: string | undefined;
}): SpeechEngineIds | undefined {
  return parsed.ELEVENLABS_SPEECH_ENGINE_ID === undefined
    ? undefined
    : {
        default: parsed.ELEVENLABS_SPEECH_ENGINE_ID,
        male: parsed.ELEVENLABS_SPEECH_ENGINE_ID_MALE,
      };
}

/** Which transport the environment speaks through, if any. */
export function resolveVoiceProvider(
  secrets: SpeechProviderSecrets,
  engines: SpeechEngineIds | undefined,
  preference: VoiceProviderCode | undefined,
): VoiceProviderCode | undefined {
  const deepgram = secrets.deepgram !== undefined;
  const elevenLabs = secrets.elevenLabs !== undefined && engines !== undefined;
  if (preference === "deepgram") return deepgram ? "deepgram" : undefined;
  if (preference === "elevenlabs") return elevenLabs ? "elevenlabs" : undefined;
  if (deepgram) return "deepgram";
  if (elevenLabs) return "elevenlabs";
  return undefined;
}

export function speechProviderConfigStatus(
  secrets: SpeechProviderSecrets,
  engines: SpeechEngineIds | undefined,
  preference?: VoiceProviderCode,
): SpeechProviderConfigStatus {
  const provider = resolveVoiceProvider(secrets, engines, preference);
  return {
    elevenLabs:
      secrets.elevenLabs === undefined ? "unconfigured" : "configured",
    deepgram: secrets.deepgram === undefined ? "unconfigured" : "configured",
    speechEngines: engines === undefined ? "unconfigured" : "configured",
    provider: provider ?? "none",
    voices:
      provider === "deepgram"
        ? ["FEMALE", "MALE"]
        : provider === "elevenlabs" && engines !== undefined
          ? engines.male === undefined
            ? ["FEMALE"]
            : ["FEMALE", "MALE"]
          : [],
  };
}
