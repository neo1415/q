import {
  Q_SPEECH_MAX_BYTES,
  Q_SPEECH_MEDIA_TYPE,
  type QVoiceChoice,
} from "@capital-q/contracts";

import type { SpeechPerformanceBoard } from "../speech-performance.js";
import {
  SpeechSynthesisError,
  type SpeechSynthesisPort,
  type SpeechSynthesisRequest,
  type SynthesisedSpeech,
} from "../synthesis.js";
import type { VoiceTurnTimings } from "../turn-timing.js";
import {
  renderSpeech,
  SPEECH_MARKUP,
  withoutMarkup,
  type ElevenLabsSpeechModel,
} from "./speech-markup.js";

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
 * The model Q is voiced by, unless a deployment chooses the other.
 *
 * Turbo v2.5 remains the default. `eleven_v3_conversational` is a plain
 * text-to-speech model on this account too (the old note here, that it was
 * a Speech Engine feature, was measured wrong on 2026-09-24). It is the
 * only one of the two that renders a laugh or a sigh without reading the
 * tag aloud, and its time to first audio is no worse
 * (design/voice-comparison). Which one runs is a deployment decision
 * (`Q_VOICE_TTS_MODEL`), taken on that evidence and on a listening check.
 */
const DEFAULT_MODEL: ElevenLabsSpeechModel = "eleven_turbo_v2_5";

/**
 * The voice's own settings, restated when a request has to carry a speed.
 * A request's `voice_settings` replaces the stored ones for that request,
 * so a pace cue must not silently reset the rest. These are the values
 * read from both voices on 2026-09-24.
 */
const VOICE_DEFAULTS = {
  stability: 0.5,
  similarity_boost: 0.75,
  style: 0,
  use_speaker_boost: true,
} as const;

/** A synthesis that has not answered by now is not going to help anybody. */
const DEFAULT_TIMEOUT_MS = 10_000;

/** What the browser is handed for a one-way line: mp3, per the contract. */
const ONE_WAY_OUTPUT_FORMAT = "mp3_44100_128";

export type ElevenLabsSpeechOptions = {
  /** Revealed once at composition; never in a response, a log or a metric. */
  readonly apiKey: string;
  /** Absent means turbo v2.5. */
  readonly model?: ElevenLabsSpeechModel | undefined;
  readonly fetch?: typeof fetch | undefined;
  readonly timeoutMs?: number | undefined;
  readonly maxBytes?: number | undefined;
};

export type ElevenLabsSpeechRelayOptions = ElevenLabsSpeechOptions & {
  /** Where the delivery cues for each session's sentences wait. */
  readonly performance?: SpeechPerformanceBoard | undefined;
  /** Where each turn's speech request and first audio byte are noted. */
  readonly timings?: VoiceTurnTimings | undefined;
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
  const model = options.model ?? DEFAULT_MODEL;

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
            // One-way lines carry no delivery cues, and stage directions a
            // model left in the text are not read out.
            body: JSON.stringify({
              text: withoutMarkup(request.text),
              model_id: model,
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
    /**
     * The voice session the sentence belongs to, from the caller's
     * binding. It keys that sentence's delivery cues and its timing. It
     * never selects anything the binding did not.
     */
    readonly session?: string | undefined;
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
  options: ElevenLabsSpeechRelayOptions,
): ElevenLabsSpeechRelay {
  const doFetch = options.fetch ?? fetch;
  const model = options.model ?? DEFAULT_MODEL;
  const markup = SPEECH_MARKUP[model];
  return {
    stream: async ({ voice, text, outputFormat, signal, session }) => {
      // An allow-list rather than a passthrough: the query string arrives
      // from outside this server, and a vendor URL is not the place to
      // relay a stranger's parameters.
      const format =
        outputFormat !== undefined && RELAYABLE_FORMATS.has(outputFormat)
          ? outputFormat
          : AGENT_OUTPUT_FORMAT;
      // The text arrives exactly as Q said it. Cues for it, if Q asked for
      // any, come from the board and are rendered only as far as this
      // model can render them. Whatever it cannot render is dropped.
      const cues =
        session === undefined || options.performance === undefined
          ? []
          : options.performance.take(session, text);
      const speech = renderSpeech(text, cues, markup);
      const timing =
        session === undefined
          ? undefined
          : options.timings?.speech(session, text.length);
      timing?.rendered(speech.rendered);
      const response = await doFetch(streamUrl(voice, format), {
        method: "POST",
        headers: {
          "xi-api-key": options.apiKey,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          text: speech.text,
          model_id: model,
          ...(speech.speed === undefined
            ? {}
            : { voice_settings: { ...VOICE_DEFAULTS, speed: speech.speed } }),
        }),
        ...(signal === undefined ? {} : { signal }),
      });
      timing?.headers();
      if (timing === undefined || !response.ok || response.body === null) {
        return response;
      }
      // The bytes pass through untouched. The only thing noted is when the
      // first one arrived, because that is when Q starts to be heard.
      let first = true;
      const noted = response.body.pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            if (first && chunk.byteLength > 0) {
              first = false;
              timing.firstByte();
            }
            controller.enqueue(chunk);
          },
        }),
      );
      return new Response(noted, {
        status: response.status,
        headers: response.headers,
      });
    },
  };
}
