import { z } from "zod";

import { ProviderCredential } from "./model-providers.js";

/**
 * Realtime speech provider configuration (CQ-Q-VOICE-001 C §29-§31).
 *
 * ElevenLabs is Capital Q's Speech Engine: microphone transport, speech
 * recognition, turn detection, interruption and text-to-speech. It is not
 * Q. The API key is server-only — never NEXT_PUBLIC_, never a log field,
 * never a prompt, never a database row — wrapped so that stringifying
 * configuration yields "[redacted]"; the adapter reads it once at
 * composition through reveal(). Configuration reports presence only.
 *
 * The Speech Engine resources are account objects created once per
 * environment by the setup script and named here by id. Two are expected:
 * the default (female) voice and the male alternative. Both point at the
 * same WebSocket route, so switching voice never changes which Q answers.
 * Optional: q-api starts without them and the voice routes are simply not
 * registered.
 */

export const SPEECH_PROVIDER_ENV_NAMES = [
  "ELEVENLABS_API_KEY",
  "ELEVENLABS_SPEECH_ENGINE_ID",
  "ELEVENLABS_SPEECH_ENGINE_ID_MALE",
] as const;

const apiKey = z
  .string()
  .trim()
  .min(16, "expected a provider API key")
  .max(512, "expected a provider API key");

/** `seng_…` as ElevenLabs issues them; bounded, never free text. */
const engineId = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{4,128}$/, "expected a Speech Engine id");

export const speechProviderEnvShape = {
  ELEVENLABS_API_KEY: apiKey.optional(),
  ELEVENLABS_SPEECH_ENGINE_ID: engineId.optional(),
  ELEVENLABS_SPEECH_ENGINE_ID_MALE: engineId.optional(),
};

export type SpeechProviderSecrets = {
  /** ElevenLabs; absent means the voice channel is not composed. */
  readonly elevenLabs: ProviderCredential | undefined;
};

export type SpeechEngineIds = {
  /** The default voice (female, warm, professional). Required for voice. */
  readonly default: string;
  /** The male alternative; absent means the picker offers one voice. */
  readonly male: string | undefined;
};

export type SpeechProviderConfigStatus = {
  readonly elevenLabs: "configured" | "unconfigured";
  readonly speechEngines: "configured" | "unconfigured";
  readonly voices: readonly ("FEMALE" | "MALE")[];
};

export function toSpeechProviderSecrets(parsed: {
  readonly ELEVENLABS_API_KEY?: string | undefined;
}): SpeechProviderSecrets {
  return {
    elevenLabs:
      parsed.ELEVENLABS_API_KEY === undefined
        ? undefined
        : new ProviderCredential(parsed.ELEVENLABS_API_KEY),
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

/** Safe to log: whether the channel exists and which voices, never what it holds. */
export function speechProviderConfigStatus(
  secrets: SpeechProviderSecrets,
  engines: SpeechEngineIds | undefined,
): SpeechProviderConfigStatus {
  return {
    elevenLabs:
      secrets.elevenLabs === undefined ? "unconfigured" : "configured",
    speechEngines: engines === undefined ? "unconfigured" : "configured",
    voices:
      engines === undefined
        ? []
        : engines.male === undefined
          ? ["FEMALE"]
          : ["FEMALE", "MALE"],
  };
}
