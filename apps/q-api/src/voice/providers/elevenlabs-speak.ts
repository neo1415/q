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
import type { DeepgramSpeakStream } from "./deepgram-speak.js";
import {
  AURA_MARKUP,
  renderSpeech,
  SPEECH_MARKUP,
  withoutMarkup,
  type ElevenLabsSpeechModel,
  type SpeechMarkup,
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
 *
 * Which voice renders an utterance (CQ-VOICE-010):
 *
 *   1. `eleven_v3_conversational`: the voice chosen by listening. It is the
 *      only one measured to laugh or sigh without reading the tag aloud.
 *   2. `eleven_turbo_v2_5`, same voice, for that one utterance, when v3
 *      errors or has not produced a byte of audio within
 *      `FIRST_AUDIO_DEADLINE_MS`. Only what turbo can render goes with it:
 *      pauses and pace. A reaction is dropped, never spoken as a word.
 *   3. Deepgram Aura-2, pauses only, when ElevenLabs cannot voice the
 *      utterance at all.
 *
 * The person hears one Q either way. The only thing a fallback can lose
 * is a laugh. The turn's timing line records which engine served each
 * utterance.
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

/**
 * REHEARSE: the voices a person Q plays in a rehearsal speaks with --
 * ElevenLabs premade voices, none of them Q's own, so the other person
 * never sounds like Q. One is chosen per counterpart, steadily, from the
 * voice the person picked in the lobby. Public voice ids, not secrets.
 */
export const PERSONA_VOICE_IDS: Readonly<
  Record<QVoiceChoice, readonly string[]>
> = {
  MALE: [
    "JBFqnCBsd6RMkjVDRZzb", // George
    "nPczCjzI2devNBz1zQrb", // Brian
    "CwhRBWXzGAHq8TQ4Fs17", // Roger
  ],
  FEMALE: [
    "XB0fDUnXU5powFXDhCwa", // Charlotte
    "Xb7hH8MSUJpSbSDYk0k2", // Alice
    "cgSgspJ2msm6clMCkdW9", // Jessica
  ],
};

/** The same counterpart keeps the same voice, rehearsal after rehearsal. */
export function personaVoiceId(voice: QVoiceChoice, seed: string): string {
  const ids = PERSONA_VOICE_IDS[voice];
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return ids[hash % ids.length] ?? VOICE_IDS[voice];
}

const ALL_VOICE_IDS: ReadonlySet<string> = new Set([
  ...Object.values(VOICE_IDS),
  ...PERSONA_VOICE_IDS.MALE,
  ...PERSONA_VOICE_IDS.FEMALE,
]);

const API_ORIGIN = "https://api.elevenlabs.io";

/**
 * v3 conversational, chosen by the person who listened to the comparison
 * (design/voice-comparison, 2026-09-24). A deployment may still pin
 * turbo with `Q_VOICE_TTS_MODEL`.
 *
 * v3 refuses `optimize_streaming_latency` with a 400, so that parameter is
 * never sent to any model. Nothing here adds it, and the relay's allow-list
 * passes through only the output format.
 */
const DEFAULT_MODEL: ElevenLabsSpeechModel = "eleven_v3_conversational";

/** The same voice, faster and plainer, for an utterance v3 did not deliver. */
const SAME_VENDOR_FALLBACK: ElevenLabsSpeechModel = "eleven_turbo_v2_5";

/**
 * How long v3 has to produce its first byte of audio before the utterance
 * is handed to turbo instead.
 *
 * Measured from Lagos, which is further from ElevenLabs than Railway's EU
 * region:
 * - v3 TTFA p95 was 301 to 563 ms across eight sentence-length cases × 5
 *   runs and three interleaved re-runs;
 * - the slowest single request was 615 ms, a cold first call;
 * - a 700-character block reached p95 737 ms.
 *
 * 1.2 s is about twice the worst sentence-length p95, so a healthy v3 is
 * never cut off. It is also early enough that turbo's own ~300 ms still
 * lands the first sound at about 1.5 s, which a person still hears as Q
 * answering rather than Q failing.
 */
export const FIRST_AUDIO_DEADLINE_MS = 1_200;

/**
 * After ElevenLabs refuses our key, or fails several utterances running,
 * its engines are skipped for this long and Aura-2 speaks. Paying two
 * failing round trips on every sentence of an outage is its own outage.
 */
const ELEVENLABS_REST_MS = 60_000;
const ELEVENLABS_FAILURES_BEFORE_REST = 3;

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
  /** Absent means v3 conversational. */
  readonly model?: ElevenLabsSpeechModel | undefined;
  readonly fetch?: typeof fetch | undefined;
  readonly timeoutMs?: number | undefined;
  readonly maxBytes?: number | undefined;
  /** Absent means `FIRST_AUDIO_DEADLINE_MS`. */
  readonly firstAudioDeadlineMs?: number | undefined;
};

export type ElevenLabsSpeechRelayOptions = ElevenLabsSpeechOptions & {
  /** Where the delivery cues for each session's sentences wait. */
  readonly performance?: SpeechPerformanceBoard | undefined;
  /** Where each turn's speech request and first audio byte are noted. */
  readonly timings?: VoiceTurnTimings | undefined;
  /** Aura-2, for an utterance ElevenLabs could not voice at all. */
  readonly aura?: DeepgramSpeakStream | undefined;
  readonly now?: (() => number) | undefined;
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

function streamUrl(
  voice: QVoiceChoice,
  outputFormat: string,
  voiceId?: string,
): URL {
  // Only a voice this module names: an id is never taken from outside.
  const id =
    voiceId !== undefined && ALL_VOICE_IDS.has(voiceId)
      ? voiceId
      : VOICE_IDS[voice];
  const url = new URL(`/v1/text-to-speech/${id}/stream`, API_ORIGIN);
  url.searchParams.set("output_format", outputFormat);
  return url;
}

/** The ElevenLabs models to try for one utterance, best first. */
function modelsFor(model: ElevenLabsSpeechModel): ElevenLabsSpeechModel[] {
  return model === SAME_VENDOR_FALLBACK
    ? [model]
    : [model, SAME_VENDOR_FALLBACK];
}

function elevenLabsRequest(
  apiKey: string,
  model: ElevenLabsSpeechModel,
  text: string,
  speed: number | undefined,
  signal: AbortSignal,
  stability?: number,
): RequestInit {
  return {
    method: "POST",
    headers: { "xi-api-key": apiKey, "content-type": "application/json" },
    body: JSON.stringify({
      text,
      model_id: model,
      ...(speed === undefined && stability === undefined
        ? {}
        : {
            voice_settings: {
              ...VOICE_DEFAULTS,
              ...(speed === undefined ? {} : { speed }),
              ...(stability === undefined ? {} : { stability }),
            },
          }),
    }),
    signal,
  };
}

type Attempt =
  | {
      readonly ok: true;
      readonly response: Response;
      readonly first: Uint8Array;
      readonly reader: ReadableStreamDefaultReader<Uint8Array>;
    }
  | {
      readonly ok: false;
      readonly status: number | undefined;
      readonly reason: "REFUSED" | "UNREACHABLE" | "SLOW" | "EMPTY";
    };

/**
 * Ask one engine and wait, at most `deadlineMs` when given, for its first
 * byte of audio. The request is abandoned if that byte does not come, and
 * whatever it would have cost is not waited for.
 */
async function firstAudio(
  request: (signal: AbortSignal) => Promise<Response>,
  callerSignal: AbortSignal | undefined,
  deadlineMs: number | undefined,
): Promise<Attempt> {
  const own = new AbortController();
  const signal =
    callerSignal === undefined
      ? own.signal
      : AbortSignal.any([own.signal, callerSignal]);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const slow = new Promise<"SLOW">((resolve) => {
    if (deadlineMs !== undefined) {
      timer = setTimeout(() => resolve("SLOW"), deadlineMs);
    }
  });
  const work = (async (): Promise<Attempt> => {
    let response: Response;
    try {
      response = await request(signal);
    } catch {
      return { ok: false, status: undefined, reason: "UNREACHABLE" };
    }
    if (!response.ok || response.body === null) {
      await response.body?.cancel().catch(() => undefined);
      return { ok: false, status: response.status, reason: "REFUSED" };
    }
    const reader: ReadableStreamDefaultReader<Uint8Array> =
      response.body.getReader();
    for (;;) {
      const chunk = await reader.read().then(
        (read) => read,
        () => null,
      );
      if (chunk === null) {
        return { ok: false, status: undefined, reason: "UNREACHABLE" };
      }
      if (chunk.done) {
        return { ok: false, status: response.status, reason: "EMPTY" };
      }
      if (chunk.value.byteLength > 0) {
        return { ok: true, response, first: chunk.value, reader };
      }
    }
  })();
  try {
    const outcome = await Promise.race([work, slow]);
    if (outcome === "SLOW") {
      own.abort();
      // Whatever the abandoned request does next is not waited for, and
      // a stream it may still open is released.
      void work.then((late) => {
        if (late.ok) void late.reader.cancel().catch(() => undefined);
      });
      return { ok: false, status: undefined, reason: "SLOW" };
    }
    return outcome;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** The first chunk, already read, then the rest as it comes. */
function resumed(attempt: Extract<Attempt, { ok: true }>): Response {
  const { first, reader, response } = attempt;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(first);
    },
    async pull(controller) {
      const next = await reader.read();
      if (next.done) controller.close();
      else controller.enqueue(next.value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
  return new Response(body, {
    status: response.status,
    headers: response.headers,
  });
}

export function createElevenLabsSpeechSynthesis(
  options: ElevenLabsSpeechOptions,
): SpeechSynthesisPort {
  const doFetch = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? Q_SPEECH_MAX_BYTES;
  const deadline = options.firstAudioDeadlineMs ?? FIRST_AUDIO_DEADLINE_MS;
  const models = modelsFor(options.model ?? DEFAULT_MODEL);

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
      // One-way lines carry no delivery cues, and stage directions a model
      // left in the text are not read out.
      const text = withoutMarkup(request.text);
      let failure = new SpeechSynthesisError(true);

      // The same engine order as the relay: v3, then turbo for this line
      // if v3 fails or is slow to start.
      for (const [index, model] of models.entries()) {
        const attempt = await firstAudio(
          (s) =>
            doFetch(
              streamUrl(request.voice, ONE_WAY_OUTPUT_FORMAT),
              elevenLabsRequest(options.apiKey, model, text, undefined, s),
            ),
          signal,
          index < models.length - 1 ? deadline : undefined,
        );
        if (signal.aborted) throw new SpeechSynthesisError(true);
        if (!attempt.ok) {
          failure = new SpeechSynthesisError(
            attempt.status === undefined ? true : retryable(attempt.status),
          );
          continue;
        }
        const mediaType = (attempt.response.headers.get("content-type") ?? "")
          .split(";")[0]
          ?.trim()
          .toLowerCase();
        if (mediaType !== Q_SPEECH_MEDIA_TYPE) {
          // Asked for audio and given something else. Whatever it is, it
          // is not going to an audio element.
          await attempt.reader.cancel().catch(() => undefined);
          throw new SpeechSynthesisError(false);
        }
        const buffer = await resumed(attempt)
          .arrayBuffer()
          .catch(() => {
            throw new SpeechSynthesisError(true);
          });
        if (buffer.byteLength === 0 || buffer.byteLength > maxBytes) {
          throw new SpeechSynthesisError(false);
        }
        return {
          audio: new Uint8Array(buffer),
          mediaType: Q_SPEECH_MEDIA_TYPE,
        };
      }
      throw failure;
    },
  };
}

/**
 * The Voice Agent's text-to-speech, relayed.
 *
 * Deepgram addresses this the way it would address ElevenLabs — the
 * sentence to say in the body, the audio format in the query — and this
 * forwards that to ElevenLabs under the real key and streams the bytes
 * straight back. Nothing is buffered beyond the first chunk: the agent
 * starts playing while the rest is still arriving, which is the whole
 * point of asking for a stream.
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
    /** REHEARSE: a persona's own voice (PERSONA_VOICE_IDS), from the binding. */
    readonly voiceId?: string | undefined;
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

type Engine = {
  readonly name: ElevenLabsSpeechModel | "aura-2";
  readonly markup: SpeechMarkup;
  readonly elevenLabs: boolean;
  readonly request: (input: {
    readonly voice: QVoiceChoice;
    readonly voiceId?: string | undefined;
    readonly format: string;
    readonly text: string;
    readonly speed: number | undefined;
    readonly stability?: number | undefined;
    readonly signal: AbortSignal;
  }) => Promise<Response>;
};

export function createElevenLabsSpeechRelay(
  options: ElevenLabsSpeechRelayOptions,
): ElevenLabsSpeechRelay {
  const doFetch = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const deadline = options.firstAudioDeadlineMs ?? FIRST_AUDIO_DEADLINE_MS;
  const elevenLabsEngines: Engine[] = modelsFor(
    options.model ?? DEFAULT_MODEL,
  ).map((model) => ({
    name: model,
    markup: SPEECH_MARKUP[model],
    elevenLabs: true,
    request: ({ voice, voiceId, format, text, speed, stability, signal }) =>
      doFetch(
        streamUrl(voice, format, voiceId),
        elevenLabsRequest(
          options.apiKey,
          model,
          text,
          speed,
          signal,
          stability,
        ),
      ),
  }));
  const auraStream = options.aura;
  const aura: Engine | undefined =
    auraStream === undefined
      ? undefined
      : {
          name: "aura-2",
          markup: AURA_MARKUP,
          elevenLabs: false,
          request: ({ voice, format, text, signal }) =>
            auraStream({ voice, text, outputFormat: format, signal }),
        };
  /** ElevenLabs is skipped until then, when Aura-2 is there to speak. */
  let restingUntil = 0;
  let failuresRunning = 0;

  return {
    stream: async ({ voice, text, outputFormat, signal, session, voiceId }) => {
      // An allow-list rather than a passthrough: the query string arrives
      // from outside this server, and a vendor URL is not the place to
      // relay a stranger's parameters.
      const format =
        outputFormat !== undefined && RELAYABLE_FORMATS.has(outputFormat)
          ? outputFormat
          : AGENT_OUTPUT_FORMAT;
      // The text arrives exactly as Q said it. Cues for it, if Q asked for
      // any, come from the board and are rendered by each engine only as
      // far as that engine can render them. The rest is dropped.
      const cues =
        session === undefined || options.performance === undefined
          ? []
          : options.performance.take(session, text);
      const timing =
        session === undefined
          ? undefined
          : options.timings?.speech(session, text.length);

      const resting = aura !== undefined && now() < restingUntil;
      const engines = [
        ...(resting ? [] : elevenLabsEngines),
        ...(aura === undefined ? [] : [aura]),
      ];
      let last: Attempt | undefined;
      for (const [index, engine] of engines.entries()) {
        const speech = renderSpeech(text, cues, engine.markup);
        // Only a first choice with a same-vendor voice behind it is held to
        // the deadline. A last resort is waited for.
        const nextIsElevenLabs = engines[index + 1]?.elevenLabs === true;
        const attempt = await firstAudio(
          (s) =>
            engine.request({
              voice,
              voiceId,
              format,
              text: speech.text,
              speed: speech.speed,
              ...(speech.stability === undefined
                ? {}
                : { stability: speech.stability }),
              signal: s,
            }),
          signal,
          engine.elevenLabs && nextIsElevenLabs ? deadline : undefined,
        );
        timing?.headers();
        if (signal?.aborted === true) {
          // The agent hung up because the person spoke. The route knows
          // this for what it is and answers nobody.
          throw new DOMException("The agent stopped listening.", "AbortError");
        }
        if (attempt.ok) {
          if (engine.elevenLabs) failuresRunning = 0;
          timing?.firstByte();
          timing?.served(engine.name, index > 0 || resting);
          timing?.rendered(speech.rendered);
          return resumed(attempt);
        }
        last = attempt;
        if (engine.elevenLabs) {
          const refusedKey = attempt.status === 401 || attempt.status === 403;
          const lastElevenLabs = !nextIsElevenLabs;
          if (lastElevenLabs) failuresRunning += 1;
          if (
            refusedKey ||
            failuresRunning >= ELEVENLABS_FAILURES_BEFORE_REST
          ) {
            restingUntil = now() + ELEVENLABS_REST_MS;
            failuresRunning = 0;
          }
        }
      }
      // Nothing could voice it. The route tells the agent the audio did not
      // come, and never why.
      return new Response(null, {
        status:
          last !== undefined && !last.ok && last.status !== undefined
            ? last.status
            : 502,
      });
    },
  };
}
