import type { QVoiceChoice } from "@capital-q/contracts";
import type { SceneLine } from "@capital-q/q-pitch";

/**
 * The Q Pitch narrator: Q's own voice, with captions always (owner 15 Oct).
 *
 * - **Live line open:** the line is said verbatim on the person's existing
 *   GPT-Live call (one voice, one session, that session's caps).
 * - **Otherwise:** Q's standard TTS voice (`/api/q-speech`, the same Q API
 *   voice gateway and caps as every other line Q reads aloud).
 * - **No audio at all** (muted, autoplay refused, provider down): the
 *   caption stays up for its reading time, exactly as before.
 *
 * Ordering is the runner's: it hands over one line at a time, AFTER_ACK
 * lines only after the DONE receipt, so speech never runs ahead of what
 * the screen shows. Pause, Skip and Back abort `signal`, and the line stops
 * being heard at once. A device speech engine is never used: it would be a
 * different voice, and some engines send the text to a vendor.
 */
const WORDS_PER_MINUTE = 150;
const MIN_MS = 1_500;
const MAX_MS = 14_000;

export function readingMs(text: string): number {
  const words = text.trim().split(/\s+/u).filter(Boolean).length;
  const ms = Math.round((words / WORDS_PER_MINUTE) * 60_000);
  return Math.min(MAX_MS, Math.max(MIN_MS, ms));
}

export function abortableWait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted || ms <= 0) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

/** Caption only: each line stays up for its reading time. */
export function captionSpeak(
  lines: readonly SceneLine[],
  signal: AbortSignal,
): Promise<void> {
  const total = lines.reduce((sum, line) => sum + readingMs(line.text), 0);
  return abortableWait(total, signal);
}

/** The open GPT-Live line, as the narrator needs it. */
export type LiveNarration = {
  /** Send the line; false when nothing could be sent. */
  readonly say: (text: string) => boolean;
  /** Q's voice is audible now (the player's level, not generation). */
  readonly speaking: () => boolean;
  /** Silence or restore the line's output at once. */
  readonly hush: (on: boolean) => void;
};

export type NarratorDeps = {
  /** The live line when one is open and can speak now, else null. */
  readonly live: () => LiveNarration | null;
  /**
   * Q's standard voice. Resolves true once the line has played (or was
   * stopped by `signal`), false when it could not play at all.
   */
  readonly tts: (text: string, signal: AbortSignal) => Promise<boolean>;
  readonly now: () => number;
  /** Resolves after `ms`, or at once when `signal` aborts. */
  readonly wait: (ms: number, signal: AbortSignal) => Promise<void>;
};

export type NarrationChannel = "LIVE" | "TTS" | "CAPTION";

export type Narrator = {
  readonly speak: (
    lines: readonly SceneLine[],
    signal: AbortSignal,
  ) => Promise<void>;
  /** How the last line went out, for receipts. */
  readonly lastChannel: () => NarrationChannel | null;
};

/** How long the live line may take to start speaking a sent line. */
export const LIVE_START_MS = 5_000;
/** Silence that counts as the end of a live line. */
export const LIVE_QUIET_MS = 800;
/** A cancelled line not heard yet, sent this recently, may still start. */
export const LIVE_LATE_START_MS = 3_000;
const POLL_MS = 100;
const HUSH_MAX_MS = 20_000;

export function createNarrator(deps: NarratorDeps): Narrator {
  let last: NarrationChannel | null = null;
  const never = new AbortController().signal;

  /**
   * After a cancel: keep the line silent until what was sent has played
   * out, then give the person their volume back. Only when Q is audible
   * now, or the line was sent so recently it may still start. Otherwise
   * (an audience barge-in, which the provider has already cut off) nothing
   * is hushed, so Q's answer to the person is heard.
   */
  const hushRest = async (live: LiveNarration, sentAt: number) => {
    const from = deps.now();
    const audible = live.speaking();
    if (!audible && from - sentAt > LIVE_LATE_START_MS) return;
    live.hush(true);
    let heard = audible;
    let lastSound = from;
    while (deps.now() - from < HUSH_MAX_MS) {
      if (live.speaking()) {
        heard = true;
        lastSound = deps.now();
      } else if (heard && deps.now() - lastSound > LIVE_QUIET_MS) break;
      else if (!heard && deps.now() - sentAt > LIVE_START_MS) break;
      await deps.wait(POLL_MS, never);
    }
    live.hush(false);
  };

  /** Live lines sent but never heard in a row; two mean the line is mute. */
  let unheard = 0;
  const UNHEARD_LIMIT = 2;

  const speakLive = async (
    live: LiveNarration,
    text: string,
    signal: AbortSignal,
  ): Promise<"HEARD" | "UNHEARD" | "NOT_SENT"> => {
    const sentAt = deps.now();
    if (!live.say(text)) return "NOT_SENT";
    last = "LIVE";
    const onAbort = () => void hushRest(live, sentAt);
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      while (!live.speaking() && deps.now() - sentAt < LIVE_START_MS) {
        if (signal.aborted) return "HEARD";
        await deps.wait(POLL_MS, signal);
      }
      if (!live.speaking()) return signal.aborted ? "HEARD" : "UNHEARD";
      const cap = sentAt + readingMs(text) * 3 + 8_000;
      let lastSound = deps.now();
      while (!signal.aborted && deps.now() < cap) {
        if (live.speaking()) lastSound = deps.now();
        else if (deps.now() - lastSound > LIVE_QUIET_MS) break;
        await deps.wait(POLL_MS, signal);
      }
      return "HEARD";
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
  };

  const speakStandard = async (text: string, signal: AbortSignal) => {
    const started = deps.now();
    last = "TTS";
    if (await deps.tts(text, signal)) return;
    // No audio at all: the caption keeps its reading time, so the scene
    // never rushes past unread words.
    last = "CAPTION";
    await deps.wait(readingMs(text) - (deps.now() - started), signal);
  };

  const speakOne = async (text: string, signal: AbortSignal) => {
    const live = unheard >= UNHEARD_LIMIT ? null : deps.live();
    if (live !== null) {
      const outcome = await speakLive(live, text, signal);
      if (outcome === "HEARD") {
        unheard = 0;
        return;
      }
      if (outcome === "UNHEARD") {
        // A line that reports open but plays nothing (seen 15 Oct: media
        // never connected): this line in the standard voice, with the live
        // output silenced so a late start cannot talk over it.
        unheard += 1;
        if (signal.aborted) return;
        live.hush(true);
        try {
          await speakStandard(text, signal);
        } finally {
          live.hush(false);
        }
        return;
      }
    }
    if (signal.aborted) return;
    await speakStandard(text, signal);
  };

  return {
    speak: async (lines, signal) => {
      for (const line of lines) {
        if (signal.aborted) return;
        await speakOne(line.text, signal);
      }
    },
    lastChannel: () => last,
  };
}

/** "Without voice" at the tour start: captions only, for this tab. */
let voiceOn = true;

export function setNarrationVoice(on: boolean): void {
  voiceOn = on;
}

export function narrationVoiceOn(): boolean {
  return voiceOn;
}

const MUTED_KEY = "cq.q.speech.muted";

/** Standard-voice narration audio playing in this tab now. */
let standardPlaying = 0;

/**
 * Echo gating: the narrator's standard-voice audio is synthetic audio, like
 * the live line's own (which the voice session reports as Q_SPEAKING).
 */
export function standardVoicePlaying(): boolean {
  return standardPlaying > 0;
}

function speechMuted(): boolean {
  try {
    return window.localStorage.getItem(MUTED_KEY) === "1";
  } catch {
    return false;
  }
}

const speechCache = new Map<string, Promise<Blob | null>>();
const SPEECH_CACHE_MAX = 32;

function fetchSpeech(text: string, voice: QVoiceChoice): Promise<Blob | null> {
  return fetch("/api/q-speech", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text, voice }),
  })
    .then(async (response) => {
      if (!response.ok) return null;
      const blob = await response.blob();
      return blob.size === 0 ? null : blob;
    })
    .catch(() => null);
}

/**
 * Synthesise a coming line ahead of time (production 15 Oct: 2-7.5 s per
 * line at the voice gateway), so it plays as soon as its turn comes. Only
 * lines the tour is about to say, in the same request a play would make.
 */
export function prefetchStandardVoice(text: string, voice: QVoiceChoice): void {
  if (!voiceOn || speechMuted()) return;
  const key = `${voice}|${text}`;
  if (speechCache.has(key)) return;
  speechCache.set(key, fetchSpeech(text, voice));
  while (speechCache.size > SPEECH_CACHE_MAX) {
    const oldest = speechCache.keys().next().value;
    if (oldest === undefined) break;
    speechCache.delete(oldest);
  }
}

/**
 * Q's standard voice for one line, through the existing `/api/q-speech`
 * route (Q API voice gateway and its caps). Honours the person's Q speech
 * mute. False when it could not play; the caption then carries the line.
 */
export async function standardVoiceLine(
  text: string,
  voice: QVoiceChoice,
  signal: AbortSignal,
): Promise<boolean> {
  if (!voiceOn || speechMuted() || signal.aborted) return false;
  const key = `${voice}|${text}`;
  const pending = speechCache.get(key) ?? fetchSpeech(text, voice);
  speechCache.delete(key);
  const blob = await Promise.race([
    pending,
    new Promise<"aborted">((resolve) => {
      signal.addEventListener("abort", () => resolve("aborted"), {
        once: true,
      });
    }),
  ]);
  if (blob === "aborted") return true;
  if (blob === null) return false;
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  standardPlaying += 1;
  try {
    return await new Promise<boolean>((resolve) => {
      const finish = (played: boolean) => {
        audio.pause();
        signal.removeEventListener("abort", onAbort);
        resolve(played);
      };
      const onAbort = () => finish(true);
      if (signal.aborted) {
        finish(true);
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
      audio.onended = () => finish(true);
      audio.onerror = () => finish(false);
      // Refused without a gesture (autoplay): the caption carries it.
      audio.play().catch(() => finish(false));
    });
  } finally {
    standardPlaying -= 1;
    URL.revokeObjectURL(url);
  }
}
