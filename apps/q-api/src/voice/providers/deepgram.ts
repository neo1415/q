import type { QVoiceChoice } from "@capital-q/contracts";

import { ASR_KEYWORDS } from "../vocabulary.js";

/**
 * Deepgram Voice Agent as the speech transport (CQ-Q-VOICE-001 rework).
 *
 * The browser opens the agent websocket with a short-lived token this
 * server mints; the agent settings this server composes point every
 * "think" call back at this server's own endpoint, under a per-session
 * secret, so Q stays the brain. The provider never sees the person's
 * Capital Q token, and the person never sees the Deepgram API key.
 */

const GRANT_URL = "https://api.deepgram.com/v1/auth/grant";
const TOKEN_TTL_SECONDS = 60;

/** Aura-2 voices: a warm professional female default and a steady male alternative. */
const SPEAK_MODELS: Readonly<Record<QVoiceChoice, string>> = {
  FEMALE: "aura-2-thalia-en",
  MALE: "aura-2-orion-en",
};

export type DeepgramAgentSettings = {
  readonly agent: Record<string, unknown>;
  readonly audio: {
    readonly input: {
      readonly encoding: "linear16";
      readonly sample_rate: number;
    };
    readonly output: {
      readonly encoding: "linear16";
      readonly sample_rate: number;
      readonly container: "none";
    };
  };
};

export type DeepgramVoiceProvider = {
  readonly name: "deepgram";
  readonly voices: readonly QVoiceChoice[];
  /** One short-lived browser token for one connection. Never the API key. */
  readonly mintToken: () => Promise<string>;
  /** The agent settings for one session; the think endpoint carries the session's secret. */
  readonly settingsFor: (input: {
    readonly voice: QVoiceChoice;
    readonly greeting: string | undefined;
    readonly thinkToken: string;
  }) => DeepgramAgentSettings;
};

export type DeepgramVoiceProviderOptions = {
  readonly apiKey: string;
  /** This server's public origin, as the provider reaches it. */
  readonly publicUrl: string;
  /** The think route's path on this server. */
  readonly thinkPath: string;
  readonly fetch?: typeof fetch | undefined;
};

/** What Deepgram's orchestrator is told; Q's real instructions live on this server. */
const THINK_PROMPT =
  "You are Q. Every reply is composed by Capital Q's own server; relay it exactly as given.";

export class DeepgramTokenError extends Error {
  readonly status: number;
  constructor(status: number) {
    super("The speech provider refused to issue a session token.");
    this.name = "DeepgramTokenError";
    this.status = status;
  }
}

export function createDeepgramVoiceProvider(
  options: DeepgramVoiceProviderOptions,
): DeepgramVoiceProvider {
  const doFetch = options.fetch ?? fetch;
  const publicUrl = options.publicUrl.replace(/\/$/, "");
  const thinkUrl = `${publicUrl}${options.thinkPath}/chat/completions`;
  return {
    name: "deepgram",
    voices: ["FEMALE", "MALE"],
    mintToken: async () => {
      const response = await doFetch(GRANT_URL, {
        method: "POST",
        headers: {
          authorization: `Token ${options.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ ttl_seconds: TOKEN_TTL_SECONDS }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        throw new DeepgramTokenError(response.status);
      }
      const body = (await response.json()) as { access_token?: unknown };
      if (
        typeof body.access_token !== "string" ||
        body.access_token.length === 0
      ) {
        throw new DeepgramTokenError(response.status);
      }
      return body.access_token;
    },
    settingsFor: ({ voice, greeting, thinkToken }) => ({
      agent: {
        language: "en",
        ...(greeting === undefined ? {} : { greeting }),
        listen: {
          provider: {
            type: "deepgram",
            version: "v2",
            model: "flux-general-en",
            keyterms: [...ASR_KEYWORDS],
            // A person thinking mid-sentence is not a person done: wait for
            // more confidence before ending the turn.
            eot_threshold: 0.8,
          },
        },
        think: {
          provider: { type: "open_ai", model: "capital-q" },
          endpoint: {
            url: thinkUrl,
            headers: { authorization: `Bearer ${thinkToken}` },
          },
          prompt: THINK_PROMPT,
        },
        speak: {
          provider: { type: "deepgram", model: SPEAK_MODELS[voice] },
        },
      },
      audio: {
        input: { encoding: "linear16", sample_rate: 16_000 },
        output: {
          encoding: "linear16",
          sample_rate: 24_000,
          container: "none",
        },
      },
    }),
  };
}
