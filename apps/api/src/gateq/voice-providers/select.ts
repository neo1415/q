/**
 * Which speech provider carries the GateQ voice interview (owner
 * directive 2026-11-14). Pure: names in, a choice out; no value is ever
 * logged or returned beyond what the composition hands the adapter.
 *
 * - ElevenLabs (Q's own voice, already configured for q-api) is the
 *   default: ELEVENLABS_API_KEY and ELEVENLABS_GATEQ_SPEECH_ENGINE_ID.
 * - Deepgram is a fallback ONLY when CQ_GATEQ_VOICE_PROVIDER=deepgram is
 *   set explicitly (with DEEPGRAM_API_KEY and API_PUBLIC_URL). A Deepgram
 *   key alone never selects it.
 *
 * A disabled placeholder (tests and local stacks set provider keys to
 * `disabled-…`) counts as absent, so no test can reach a live provider.
 */

export type GateqVoiceProviderChoice =
  | {
      readonly kind: "elevenlabs";
      readonly apiKey: string;
      readonly speechEngineId: string;
    }
  | {
      readonly kind: "deepgram";
      readonly apiKey: string;
      readonly publicBaseUrl: string;
    }
  | {
      readonly kind: "none";
      /** For the startup log only; names, never values. */
      readonly missing: readonly string[];
    };

const SPEECH_ENGINE_ID = /^[A-Za-z0-9_-]{1,128}$/u;

function configured(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
): string {
  const value = env[name]?.trim() ?? "";
  return value === "" || value.startsWith("disabled") ? "" : value;
}

export function selectGateqVoiceProvider(
  env: Readonly<Record<string, string | undefined>>,
): GateqVoiceProviderChoice {
  const preference = env["CQ_GATEQ_VOICE_PROVIDER"]?.trim().toLowerCase();
  if (preference === "deepgram") {
    const apiKey = configured(env, "DEEPGRAM_API_KEY");
    const publicBaseUrl = configured(env, "API_PUBLIC_URL").replace(
      /\/+$/u,
      "",
    );
    const missing = [
      ...(apiKey === "" ? ["DEEPGRAM_API_KEY"] : []),
      ...(publicBaseUrl === "" ? ["API_PUBLIC_URL"] : []),
    ];
    return missing.length === 0
      ? { kind: "deepgram", apiKey, publicBaseUrl }
      : { kind: "none", missing };
  }
  if (
    preference !== undefined &&
    preference !== "" &&
    preference !== "elevenlabs"
  )
    return { kind: "none", missing: ["CQ_GATEQ_VOICE_PROVIDER"] };
  const apiKey =
    configured(env, "ELEVENLABS_API_KEY") ||
    configured(env, "ELEVEN_LABS_API_KEY");
  const engine = configured(env, "ELEVENLABS_GATEQ_SPEECH_ENGINE_ID");
  const speechEngineId = SPEECH_ENGINE_ID.test(engine) ? engine : "";
  const missing = [
    ...(apiKey === "" ? ["ELEVENLABS_API_KEY"] : []),
    ...(speechEngineId === "" ? ["ELEVENLABS_GATEQ_SPEECH_ENGINE_ID"] : []),
  ];
  return missing.length === 0
    ? { kind: "elevenlabs", apiKey, speechEngineId }
    : { kind: "none", missing };
}
