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
 * ElevenLabs as the voice Q is heard in (QX-004 SPEAK rework).
 *
 * Deepgram keeps LISTEN and Q keeps THINK; only the voice changes. Two
 * surfaces speak and both are served from here, because both are the same
 * request to the same vendor and splitting them is how they drift apart:
 *
 *   - one-way synthesis behind `SpeechSynthesisPort`, for a line Q reads
 *     aloud with nothing listening (`POST /v1/q/voice/speech`);
 *   - a relay for the Deepgram Voice Agent's bring-your-own-TTS, which
 *     asks an endpoint of our choosing for the audio of each sentence.
 *
 * Why the agent is pointed at this server rather than straight at
 * ElevenLabs: the agent settings are composed here but *sent by the
 * browser*, so anything inside them is public to the person. Deepgram's
 * own `endpoint.headers` is where the vendor key would go, and putting an
 * account key there would hand every visitor our ElevenLabs credential.
 * The agent is therefore given this server's origin and the session's own
 * secret — exactly what the think endpoint already carries — and the real
 * key never leaves this process.
 */

/**
 * The account voices Q speaks in. Public ElevenLabs voice ids, not
 * secrets, and the same two the Speech Engine resources were built from
 * (`voice-setup`), so Q sounds like the same Q on every surface.
 */
const VOICE_IDS: Readonly<Record<QVoiceChoice, string>> = {
  /** "Sarah" — warm, professional female. */
  FEMALE: "EXAVITQu4vr4xnSDxMaL",
  /** "Daniel" — calm, professional male. */
  MALE: "onwK4e9ZLuTAKqWW03F9",
};

const API_ORIGIN = "https://api.elevenlabs.io";

/**
 * Turbo v2.5 for both surfaces. The Speech Engine resources were tuned to
 * `eleven_v3_conversational`, which is a Speech Engine feature and not a
 * plain text-to-speech model; on this path the choice is between latency
 * and expressiveness, and a conversation that answers late reads as
 * broken long before it reads as flat.
 */
const MODEL_ID = "eleven_turbo_v2_5";

/** A synthesis that has not answered by now is not going to help anybody. */
const DEFAULT_TIMEOUT_MS = 10_000;

/** What the browser is handed for a one-way line: mp3, per the contract. */
const ONE_WAY_OUTPUT_FORMAT = "mp3_44100_128";

export type ElevenLabsSpeechOptions = {
  /** Revealed once at composition; never in a response, a log or a metric. */
  readonly apiKey: string;
  readonly fetch?: typeof fetch | undefined;
  readonly timeoutMs?: number | undefined;
  readonly maxBytes?: number | undefined;
};

/**
 * Whether it is worth asking again.
 *
 * A refusal about the request itself never is; the provider being busy,
 * rate-limited or briefly broken is. Neither answer reaches a person.
 */
function retryable(status: number): boolean {
  return status === 429 || status >= 500;
}

function streamUrl(voice: QVoiceChoice, outputFormat: string): URL {
  const url = new URL(
    `/v1/text-to-speech/${VOICE_IDS[voice]}/stream`,
    API_ORIGIN,
  );
  url.searchParams.set("output_format", outputFormat);
  return url;
}

export function createElevenLabsSpeechSynthesis(
  options: ElevenLabsSpeechOptions,
): SpeechSynthesisPort {
  const doFetch = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? Q_SPEECH_MAX_BYTES;

  return {
    name: "elevenlabs",
    voices: ["FEMALE", "MALE"],
    async synthesise(
      request: SpeechSynthesisRequest,
    ): Promise<SynthesisedSpeech> {
      const timeout = AbortSignal.timeout(timeoutMs);
      const signal =
        request.signal === undefined
          ? timeout
          : AbortSignal.any([timeout, request.signal]);

      let response: Response;
      try {
        response = await doFetch(
          streamUrl(request.voice, ONE_WAY_OUTPUT_FORMAT),
          {
            method: "POST",
            headers: {
              "xi-api-key": options.apiKey,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              text: request.text,
              model_id: MODEL_ID,
            }),
            signal,
          },
        );
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

/**
 * The Voice Agent's text-to-speech, relayed.
 *
 * Deepgram addresses this the way it would address ElevenLabs — the
 * sentence to say in the body, the audio format in the query — and this
 * forwards that to ElevenLabs under the real key and streams the bytes
 * straight back. Nothing is buffered: the agent starts playing the first
 * chunk while the rest is still arriving, which is the whole point of
 * asking for a stream.
 *
 * The voice is decided by the caller from the session's binding, never by
 * anything in the request, so a relayed call cannot select a voice the
 * session was not issued for.
 */
export type ElevenLabsSpeechRelay = {
  /** Text in, the vendor's own streaming response out. Never throws for a refusal. */
  readonly stream: (input: {
    readonly voice: QVoiceChoice;
    readonly text: string;
    /** Passed through from the agent; an unknown one falls back to 24k PCM. */
    readonly outputFormat?: string | undefined;
    readonly signal?: AbortSignal | undefined;
  }) => Promise<Response>;
};

/**
 * What the agent is played when it asks for no format.
 *
 * Signed 16-bit PCM at 24kHz, which is exactly the agent socket's declared
 * audio output (`linear16`, 24000). Anything else would need transcoding
 * in the middle of a conversation.
 */
const AGENT_OUTPUT_FORMAT = "pcm_24000";

/** Formats we will ask ElevenLabs for on the agent's behalf, and nothing else. */
const RELAYABLE_FORMATS = new Set([
  "pcm_8000",
  "pcm_16000",
  "pcm_22050",
  "pcm_24000",
  "pcm_44100",
  "mp3_22050_32",
  "mp3_44100_32",
  "mp3_44100_64",
  "mp3_44100_96",
  "mp3_44100_128",
  "ulaw_8000",
]);

export function createElevenLabsSpeechRelay(
  options: ElevenLabsSpeechOptions,
): ElevenLabsSpeechRelay {
  const doFetch = options.fetch ?? fetch;
  return {
    stream: ({ voice, text, outputFormat, signal }) => {
      // An allow-list rather than a passthrough: the query string arrives
      // from outside this server, and a vendor URL is not the place to
      // relay a stranger's parameters.
      const format =
        outputFormat !== undefined && RELAYABLE_FORMATS.has(outputFormat)
          ? outputFormat
          : AGENT_OUTPUT_FORMAT;
      return doFetch(streamUrl(voice, format), {
        method: "POST",
        headers: {
          "xi-api-key": options.apiKey,
          "content-type": "application/json",
        },
        body: JSON.stringify({ text, model_id: MODEL_ID }),
        ...(signal === undefined ? {} : { signal }),
      });
    },
  };
}
