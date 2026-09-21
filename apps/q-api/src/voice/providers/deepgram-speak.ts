import {
  Q_SPEECH_MAX_BYTES,
  Q_SPEECH_MEDIA_TYPE,
  type QVoiceChoice,
} from "@capital-q/contracts";

import {
  SpeechSynthesisError,
  type SpeechSynthesisPort,
  type SpeechSynthesisRequest,
  type SynthesisedSpeech,
} from "../synthesis.js";

/**
 * Deepgram as a one-way synthesiser (Q-FIRST-RUN-TTS-001).
 *
 * The same account and the same key the Voice Agent transport already
 * uses, against the plain `/v1/speak` endpoint rather than the agent
 * websocket. That is the whole of the change this needed: Deepgram has
 * always sold standalone text-to-speech, and only the bidirectional path
 * was wired. No new provider, no new account, no new credential — and
 * ElevenLabs is deliberately untouched while its credits are spent.
 *
 * The key stays here. It is never in a response, a log line, a metric
 * label or anything the browser can reach; the browser asks this server
 * for audio and gets audio.
 *
 * Aura-2 voices, matching the agent transport's, so Q sounds like the same
 * Q whether it is reading a line or holding a conversation.
 */
const SPEAK_URL = "https://api.deepgram.com/v1/speak";

const SPEAK_MODELS: Readonly<Record<QVoiceChoice, string>> = {
  FEMALE: "aura-2-thalia-en",
  MALE: "aura-2-orion-en",
};

/** A synthesis that has not answered by now is not going to help anybody. */
const DEFAULT_TIMEOUT_MS = 10_000;

export type DeepgramSpeechSynthesisOptions = {
  readonly apiKey: string;
  readonly fetch?: typeof fetch | undefined;
  readonly timeoutMs?: number | undefined;
  readonly maxBytes?: number | undefined;
};

/**
 * Whether it is worth asking again.
 *
 * A refusal about the request itself never is; the provider being busy,
 * rate-limited or briefly broken is. Neither answer reaches a person: this
 * decides only whether this server retries or gives up.
 */
function retryable(status: number): boolean {
  return status === 429 || status >= 500;
}

export function createDeepgramSpeechSynthesis(
  options: DeepgramSpeechSynthesisOptions,
): SpeechSynthesisPort {
  const doFetch = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? Q_SPEECH_MAX_BYTES;

  return {
    name: "deepgram",
    voices: ["FEMALE", "MALE"],
    async synthesise(
      request: SpeechSynthesisRequest,
    ): Promise<SynthesisedSpeech> {
      const url = new URL(SPEAK_URL);
      url.searchParams.set("model", SPEAK_MODELS[request.voice]);
      // Asked for explicitly rather than taken from the default, because
      // the browser is handed the bytes and has to know what they are.
      url.searchParams.set("encoding", "mp3");

      const timeout = AbortSignal.timeout(timeoutMs);
      const signal =
        request.signal === undefined
          ? timeout
          : AbortSignal.any([timeout, request.signal]);

      let response: Response;
      try {
        response = await doFetch(url, {
          method: "POST",
          headers: {
            Authorization: `Token ${options.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ text: request.text }),
          signal,
        });
      } catch {
        // A timeout or a transport failure. Worth another attempt later;
        // nothing about it is worth saying out loud.
        throw new SpeechSynthesisError(true);
      }

      if (!response.ok) {
        throw new SpeechSynthesisError(retryable(response.status));
      }

      const mediaType = (response.headers.get("content-type") ?? "")
        .split(";")[0]
        ?.trim()
        .toLowerCase();
      if (mediaType !== Q_SPEECH_MEDIA_TYPE) {
        // Asked for audio and given something else. Whatever it is, it is
        // not going to an audio element.
        throw new SpeechSynthesisError(false);
      }

      const buffer = await response.arrayBuffer().catch(() => {
        throw new SpeechSynthesisError(true);
      });
      if (buffer.byteLength === 0 || buffer.byteLength > maxBytes) {
        throw new SpeechSynthesisError(false);
      }

      return { audio: new Uint8Array(buffer), mediaType: Q_SPEECH_MEDIA_TYPE };
    },
  };
}
