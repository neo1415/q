import { ModelProviderFailure } from "../errors.js";
import type {
  RealtimePrices,
  RealtimeSessionGrant,
  RealtimeSessionProvider,
} from "./index.js";

/**
 * OpenAI's Realtime API behind the realtime adapter (DUPLEX).
 *
 * The server mints a client secret (`POST /v1/realtime/client_secrets`)
 * with the whole session configured on it: model, instructions, the tools
 * the Tool Registry offered for this plan, the voice, turn detection that
 * interrupts Q when the person speaks, and a per-response output cap. The
 * browser opens WebRTC with that secret against `/v1/realtime/calls` and
 * never sees the API key. Input transcription (a small second model) is
 * requested only when the line listens like a person (BACKCHANNEL): the
 * transcripts give Q's reactions their context and give the memory Write
 * Gate the person's own words to check a spoken preference against. Its
 * usage is reported per item and priced at its own rates.
 *
 * Prompt caching is the provider's automatic prefix cache: the
 * instructions put the stable charter first and the per-line context last,
 * and tools keep the registry's order, so the prefix repeats.
 */
export const OPENAI_REALTIME_MODEL = "gpt-realtime-mini";
const CLIENT_SECRETS_ENDPOINT =
  "https://api.openai.com/v1/realtime/client_secrets";
export const OPENAI_REALTIME_CALLS_URL =
  "https://api.openai.com/v1/realtime/calls";

/** USD per million tokens (developers.openai.com/api/docs/pricing, 2026-10-04). */
export const OPENAI_REALTIME_MINI_PRICES: RealtimePrices = {
  textInput: 0.6,
  cachedTextInput: 0.06,
  textOutput: 2.4,
  audioInput: 10,
  cachedAudioInput: 0.3,
  audioOutput: 20,
};

/** The input transcription model (BACKCHANNEL), and its prices (2026-10-04). */
export const OPENAI_REALTIME_TRANSCRIBE_MODEL = "gpt-4o-mini-transcribe";
export const OPENAI_TRANSCRIBE_MINI_PRICES: RealtimePrices = {
  textInput: 1.25,
  cachedTextInput: 1.25,
  textOutput: 5,
  audioInput: 3,
  cachedAudioInput: 3,
  audioOutput: 0,
};

/** Q's two voices, in the provider's catalogue. */
const VOICES = { FEMALE: "marin", MALE: "cedar" } as const;

export function createOpenAIRealtimeProvider(options: {
  readonly apiKey: string;
  readonly fetch?: typeof fetch | undefined;
  readonly modelCode?: string | undefined;
  readonly prices?: RealtimePrices | undefined;
}): RealtimeSessionProvider {
  const call = options.fetch ?? fetch;
  return {
    code: "openai",
    modelCode: options.modelCode ?? OPENAI_REALTIME_MODEL,
    providerId: "a1000000-0000-4000-8000-000000000003",
    // 20261203090000_model_usage_voice_realtime.sql
    modelId: "a2000000-0000-4000-8000-000000000022",
    prices: options.prices ?? OPENAI_REALTIME_MINI_PRICES,
    transcription: {
      modelCode: OPENAI_REALTIME_TRANSCRIBE_MODEL,
      prices: OPENAI_TRANSCRIBE_MINI_PRICES,
    },
    mint: async (request, context): Promise<RealtimeSessionGrant> => {
      let response: Response;
      try {
        response = await call(CLIENT_SECRETS_ENDPOINT, {
          method: "POST",
          headers: {
            authorization: `Bearer ${options.apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            expires_after: {
              anchor: "created_at",
              seconds: request.secretTtlSeconds,
            },
            session: {
              type: "realtime",
              model: request.modelCode,
              instructions: request.instructions,
              output_modalities: ["audio"],
              max_output_tokens: request.maxOutputTokens,
              tool_choice: "auto",
              tools: request.tools.map((tool) => ({
                type: "function",
                name: tool.name,
                description: tool.description,
                parameters: tool.inputJsonSchema,
              })),
              audio: {
                input: {
                  // The person speaking cancels Q's response at once; the
                  // browser also stops playback and truncates (barge-in).
                  // AUTO waits a little longer on a turn that sounds
                  // unfinished, which is where Q's reactions go.
                  turn_detection: {
                    type: "semantic_vad",
                    eagerness:
                      request.turnEagerness === "AUTO" ? "auto" : "high",
                    create_response: true,
                    interrupt_response: true,
                  },
                  ...(request.transcribeInput === true
                    ? {
                        transcription: {
                          model: OPENAI_REALTIME_TRANSCRIBE_MODEL,
                        },
                      }
                    : {}),
                },
                output: {
                  voice: VOICES[request.voice],
                  ...(request.speechSpeed === undefined
                    ? {}
                    : {
                        speed: Math.min(
                          1.5,
                          Math.max(0.25, request.speechSpeed),
                        ),
                      }),
                },
              },
            },
          }),
          signal: context.signal,
        });
      } catch (error) {
        throw new ModelProviderFailure(
          "openai realtime secret request failed",
          {
            failureClass: "TRANSIENT",
            providerCode: "openai",
            cause: error,
          },
        );
      }
      if (!response.ok) {
        throw new ModelProviderFailure("openai realtime secret refused", {
          failureClass:
            response.status === 429
              ? "RATE_LIMIT"
              : response.status === 401 || response.status === 403
                ? "AUTHENTICATION"
                : response.status === 400
                  ? "INVALID_REQUEST"
                  : "PROVIDER_OUTAGE",
          providerCode: "openai",
          providerStatus: response.status,
        });
      }
      const body: unknown = await response.json().catch(() => null);
      const value: unknown = Reflect.get(Object(body), "value");
      const expiresAt: unknown = Reflect.get(Object(body), "expires_at");
      if (typeof value !== "string" || value.length === 0) {
        throw new ModelProviderFailure("openai realtime secret was empty", {
          failureClass: "INVALID_MODEL_OUTPUT",
          providerCode: "openai",
        });
      }
      return {
        clientSecret: value,
        expiresAt:
          typeof expiresAt === "number" && Number.isFinite(expiresAt)
            ? new Date(expiresAt * 1000)
            : new Date(Date.now() + request.secretTtlSeconds * 1000),
        callsUrl: OPENAI_REALTIME_CALLS_URL,
      };
    },
  };
}
