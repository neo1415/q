import type { QVoiceChoice } from "@capital-q/contracts";

/**
 * The one-way speech boundary (Q-FIRST-RUN-TTS-001; doc 11 §17.2).
 *
 * `RealtimeVoiceProvider` next door is a conversation: microphone
 * transport, recognition, turn detection, interruption. This is the other
 * half of what a speech vendor sells, and it is a much smaller thing —
 * text in, audio out, nothing listening. Keeping it as its own port is
 * what lets Q read a line aloud without asking anybody for a microphone.
 *
 * No vendor type crosses this file. A caller sees bytes and a media type;
 * which vendor produced them, how it was addressed, and what it said when
 * it refused are the adapter's business and stay there.
 */

/** One line to say, and the voice to say it in. */
export type SpeechSynthesisRequest = {
  /** Already bounded by the contract before it reaches here. */
  readonly text: string;
  readonly voice: QVoiceChoice;
  /** Abandons the request; the caller owns the deadline. */
  readonly signal?: AbortSignal | undefined;
};

export type SynthesisedSpeech = {
  readonly audio: Uint8Array;
  /** An IANA media type the browser can play directly. */
  readonly mediaType: string;
};

export type SpeechSynthesisPort = {
  /** For logs and configuration status; never a secret. */
  readonly name: string;
  readonly voices: readonly QVoiceChoice[];
  synthesise(request: SpeechSynthesisRequest): Promise<SynthesisedSpeech>;
};

/**
 * The only failure a caller above this port ever sees.
 *
 * Deliberately without the provider's status code, body or name: a person
 * who cannot hear a greeting is told that Q cannot speak right now, and
 * nothing about whose quota ran out. `retryable` is for this server's own
 * decisions, not for anything said on screen.
 */
export class SpeechSynthesisError extends Error {
  readonly retryable: boolean;
  constructor(retryable: boolean) {
    super("Q could not speak that line.");
    this.name = "SpeechSynthesisError";
    this.retryable = retryable;
  }
}

/**
 * One voice, then the next when it cannot speak (CQ-VOICE-010).
 *
 * A one-way line follows the same engine order as a conversation:
 * ElevenLabs (which already tries v3 and then turbo inside itself), and
 * Deepgram Aura-2 only when ElevenLabs cannot voice the line at all. A
 * caller that has gone away is not answered by the next voice.
 */
export function speechWithFallback(
  ports: readonly SpeechSynthesisPort[],
): SpeechSynthesisPort | undefined {
  const [primary] = ports;
  if (primary === undefined) return undefined;
  if (ports.length === 1) return primary;
  return {
    name: ports.map((port) => port.name).join("+"),
    voices: primary.voices,
    async synthesise(request) {
      let failure: unknown = new SpeechSynthesisError(true);
      for (const port of ports) {
        if (request.signal?.aborted === true) break;
        try {
          return await port.synthesise(request);
        } catch (error: unknown) {
          failure = error;
        }
      }
      throw failure;
    },
  };
}

/**
 * How often one person may ask Q to speak.
 *
 * Synthesis costs money per character and this endpoint is reachable by
 * anybody with a session, so the bound on one request's size is not on its
 * own a bound on the bill. Keyed on the server-resolved actor, so a caller
 * cannot choose their own bucket, and per process, on purpose: no Redis,
 * no new service, no new credential. A weaker bound than a shared one and
 * a far stronger one than none.
 *
 * The allowance is set from what the first minute actually does — a
 * greeting, a replay, a retry after a refusal — not from a round number.
 */
export const SPEECH_QUOTA = { limit: 30, windowMs: 10 * 60_000 } as const;

/** Beyond this many live buckets the oldest window is dropped. */
const MAX_TRACKED = 10_000;

export type SpeechThrottle = {
  /** Charge one synthesis to this actor. False means the allowance is spent. */
  readonly charge: (actorKey: string) => boolean;
  /** Live bucket count, for a test or a gauge. Never the keys. */
  readonly size: () => number;
};

type Bucket = { count: number; resetAt: number };

export function createSpeechThrottle(options?: {
  readonly quota?: { readonly limit: number; readonly windowMs: number };
  readonly clock?: () => number;
  readonly maxTracked?: number;
}): SpeechThrottle {
  const quota = options?.quota ?? SPEECH_QUOTA;
  const clock = options?.clock ?? (() => Date.now());
  const maxTracked = options?.maxTracked ?? MAX_TRACKED;
  const buckets = new Map<string, Bucket>();

  const sweep = (now: number): void => {
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
    if (buckets.size <= maxTracked) return;
    const byAge = [...buckets.entries()].sort(
      (a, b) => a[1].resetAt - b[1].resetAt,
    );
    for (const [key] of byAge.slice(0, buckets.size - maxTracked)) {
      buckets.delete(key);
    }
  };

  return {
    charge: (actorKey) => {
      const now = clock();
      const bucket = buckets.get(actorKey);
      if (bucket === undefined || bucket.resetAt <= now) {
        if (buckets.size >= maxTracked) sweep(now);
        buckets.set(actorKey, { count: 1, resetAt: now + quota.windowMs });
        return true;
      }
      if (bucket.count >= quota.limit) return false;
      bucket.count += 1;
      return true;
    },
    size: () => buckets.size,
  };
}
