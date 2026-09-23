import type { QVoiceChoice } from "@capital-q/contracts";

import { ASR_KEYWORDS } from "../vocabulary.js";
import type { ElevenLabsSpeechRelay } from "./elevenlabs-speak.js";

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

/**
 * The ElevenLabs model the agent is told it is talking to (QX-004 SPEAK
 * rework). It must match what the relay actually asks ElevenLabs for;
 * both live next to each other on purpose.
 */
const ELEVENLABS_MODEL_ID = "eleven_turbo_v2_5";

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
  /**
   * Where Q's voice actually comes from, when it is not Deepgram's own
   * (QX-004 SPEAK rework). Carried on the transport rather than composed
   * separately because the settings that name the relay and the relay
   * that answers them have to agree, and one object is what makes that
   * impossible to get wrong.
   */
  readonly speakRelay: ElevenLabsSpeechRelay | undefined;
  /** One short-lived browser token for one connection. Never the API key. */
  readonly mintToken: () => Promise<string>;
  /** The agent settings for one session; the think endpoint carries the session's secret. */
  readonly settingsFor: (input: {
    readonly voice: QVoiceChoice;
    readonly greeting: string | undefined;
    readonly thinkToken: string;
    /**
     * Names this person is likely to say that the recogniser has never
     * heard: their organisation, their own name. "NEM Salvage" came back
     * as "name salvage" until the recogniser was told the word existed.
     */
    readonly terms?: readonly string[] | undefined;
  }) => DeepgramAgentSettings;
};

export type DeepgramVoiceProviderOptions = {
  readonly apiKey: string;
  /** This server's public origin, as the provider reaches it. */
  readonly publicUrl: string;
  /** The think route's path on this server. */
  readonly thinkPath: string;
  /**
   * Q's voice (QX-004 SPEAK rework). Present means ElevenLabs: the agent
   * is told to fetch the audio of each sentence from `path` on this
   * server, and `relay` is what answers there. Absent means the agent
   * speaks in its own Aura-2 voice, which is what happens when no
   * ElevenLabs key is configured.
   */
  readonly speak?:
    | { readonly path: string; readonly relay: ElevenLabsSpeechRelay }
    | undefined;
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
  const speak = options.speak;

  /**
   * Where the agent gets Q's voice from.
   *
   * With a relay path this is Deepgram's bring-your-own-TTS pointed at
   * *this server*, not at ElevenLabs. These settings are composed here but
   * sent by the browser, so the vendor key that would normally sit in
   * `endpoint.headers` would be public to the person; the session's own
   * secret goes there instead and the ElevenLabs key never leaves the
   * server. Without a relay path the agent speaks in Aura-2 as before.
   */
  const speakFor = (
    voice: QVoiceChoice,
    thinkToken: string,
  ): Record<string, unknown> =>
    speak === undefined
      ? { provider: { type: "deepgram", model: SPEAK_MODELS[voice] } }
      : {
          provider: {
            type: "eleven_labs",
            model_id: ELEVENLABS_MODEL_ID,
            language: "en",
          },
          endpoint: {
            // No voice in the URL: the relay reads the session's voice
            // from its binding, so a relayed call cannot ask to be spoken
            // in a voice the session was not issued for.
            url: `${publicUrl}${speak.path}`,
            headers: { authorization: `Bearer ${thinkToken}` },
          },
        };

  return {
    name: "deepgram",
    voices: ["FEMALE", "MALE"],
    speakRelay: speak?.relay,
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
    settingsFor: ({ voice, greeting, thinkToken, terms }) => ({
      agent: {
        language: "en",
        ...(greeting === undefined ? {} : { greeting }),
        listen: {
          provider: {
            type: "deepgram",
            version: "v2",
            model: "flux-general-en",
            keyterms: [
              ...new Set([
                ...(terms ?? [])
                  .map((term) => term.trim())
                  .filter((term) => term.length >= 2 && term.length <= 60),
                ...ASR_KEYWORDS,
              ]),
            ].slice(0, 100),
            // When a person has finished. The threshold is how sure the
            // turn model must be; the timeout is how long it waits for
            // that certainty before ending the turn anyway.
            //
            // It was 0.8 with the provider's default timeout of five
            // seconds. A short utterance — "what's up?" — rarely reaches
            // 0.8 on its own, so the turn ended only when the timeout did,
            // and five seconds of silence sat in front of every reply
            // before Q had even begun. The provider's own default is 0.7;
            // three seconds is the longest a person reads as "listening"
            // rather than "not working".
            eot_threshold: 0.7,
            eot_timeout_ms: 3_000,
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
        speak: speakFor(voice, thinkToken),
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
