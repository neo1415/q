import type { GateqVoiceProvider } from "@capital-q/gateq-intake";
import { isEnglish, languageChannels } from "@capital-q/q-core/language";

/**
 * The GateQ voice interview's speech adapter: Deepgram's Voice Agent as
 * ears, turn-taking and a voice only (the same transport Q's own standard
 * line uses in q-api). The browser opens the agent socket with a
 * short-lived token minted here; the agent settings composed here point
 * every "think" at this API's GateQ voice bridge under the line's own
 * bearer, so the reply is always the canonical GateQ interviewer's. The
 * Deepgram key never leaves this server; the guest credential never
 * reaches the provider.
 *
 * Slice 1 speaks in the provider's own voice (Aura-2); Q's ElevenLabs
 * voice relay lives in q-api behind a signed-in binding and is a later
 * slice for guests.
 */

const GRANT_URL = "https://api.deepgram.com/v1/auth/grant";
/** Long enough to open the socket; the session's clock is ours. */
const TOKEN_TTL_SECONDS = 60;
const SPEAK_MODEL = "aura-2-thalia-en";
const THINK_PROMPT =
  "You are Q, an AI interviewer. Every reply is composed by Capital Q's own server; relay it exactly as given.";

export class GateqVoiceTokenError extends Error {
  readonly status: number;
  constructor(status: number) {
    super("The speech provider refused to issue a session token.");
    this.name = "GateqVoiceTokenError";
    this.status = status;
  }
}

export function createDeepgramGateqVoiceProvider(options: {
  readonly apiKey: string;
  /** This API's public origin, as the provider reaches it. */
  readonly publicBaseUrl: string;
  readonly fetch?: typeof fetch | undefined;
}): GateqVoiceProvider {
  const doFetch = options.fetch ?? fetch;
  const origin = options.publicBaseUrl.replace(/\/+$/u, "");
  return {
    openLine: async ({ greeting, bridge, locale }) => {
      const response = await doFetch(GRANT_URL, {
        method: "POST",
        headers: {
          authorization: `Token ${options.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ ttl_seconds: TOKEN_TTL_SECONDS }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new GateqVoiceTokenError(response.status);
      // The provider's grant is external data: narrowed before use.
      const body: unknown = await response.json();
      const token =
        typeof body === "object" &&
        body !== null &&
        "access_token" in body &&
        typeof body.access_token === "string"
          ? body.access_token
          : "";
      if (token.length === 0 || token.length > 8192)
        throw new GateqVoiceTokenError(response.status);
      const english = locale === undefined || isEnglish(locale);
      const plan = english
        ? { model: "flux-general-en" as const }
        : (languageChannels(locale).listen ?? {
            model: "flux-general-multi" as const,
          });
      return {
        provider: "deepgram",
        token,
        agent: {
          ...(english ? { language: "en" } : {}),
          greeting: greeting.slice(0, 1000),
          listen: {
            provider:
              plan.model === "nova-3"
                ? {
                    type: "deepgram",
                    version: "v1",
                    model: "nova-3",
                    language: plan.language,
                  }
                : {
                    type: "deepgram",
                    version: "v2",
                    model: plan.model,
                    // Q's own measured end-of-turn tuning (q-api deepgram.ts).
                    eot_threshold: 0.85,
                    eot_timeout_ms: 4_000,
                  },
          },
          think: {
            provider: { type: "open_ai", model: "capital-q-gateq" },
            endpoint: {
              url: `${origin}${bridge.path}/chat/completions`,
              headers: { authorization: `Bearer ${bridge.bearer}` },
            },
            prompt: THINK_PROMPT,
          },
          speak: { provider: { type: "deepgram", model: SPEAK_MODEL } },
        },
      };
    },
  };
}
