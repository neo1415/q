import {
  renderText,
  type BeatAlignment,
  type StoryBeat,
} from "@capital-q/q-pitch";

import type { LiveNarration } from "../narrator";

/**
 * Q Story narrators (plan §1, Narrator). Whichever plays, its clock is the
 * story's master clock: `clock()` is milliseconds into the current beat's
 * audio as the listener hears it, and the cue engine follows it.
 *
 * - RENDERED: the pre-rendered ElevenLabs beats, decoded in memory before
 *   the story starts, on one AudioContext (its `currentTime` is the clock).
 * - LIVE: Q's live voice line speaks each beat verbatim, briefed with the
 *   beat's delivery. The clock starts when Q is heard and follows the beat's
 *   timing (less precise, as the plan accepts).
 * - SILENT: no audio at all (captions only, or no voice): the clock is a
 *   timer over the beat's fixture timings.
 *
 * Audio never waits for a visual: nothing here knows about the screen.
 */
export type NarratorKind = "RENDERED" | "LIVE" | "SILENT";

export type StoryNarrator = {
  readonly kind: NarratorKind;
  /** Plays one beat; resolves when it has finished or `signal` aborted. */
  readonly play: (
    beat: StoryBeat,
    alignment: BeatAlignment,
    signal: AbortSignal,
  ) => Promise<void>;
  /**
   * Milliseconds into the playing beat, as heard: negative during the short
   * lead before its audio starts, NaN when no beat is playing.
   */
  readonly clock: () => number;
  /** Freezes the clock (and the audio, where it can be held). */
  readonly pause: () => void;
  readonly resume: () => void;
  /** Whether resume continues mid-beat (else the beat restarts). */
  readonly resumesInPlace: boolean;
  readonly setMuted: (on: boolean) => void;
  readonly dispose: () => void;
};

/** A beat's audio starts this far ahead, so the first word's cue leads it too. */
const START_LEAD_S = 0.16;

export function renderedNarrator(
  context: AudioContext,
  buffers: ReadonlyMap<number, AudioBuffer>,
): StoryNarrator {
  const gain = context.createGain();
  gain.connect(context.destination);
  let startAt = -1;
  let source: AudioBufferSourceNode | null = null;
  const latency = () =>
    (context.outputLatency || 0) + (context.baseLatency || 0);
  return {
    kind: "RENDERED",
    resumesInPlace: true,
    play: (beat, alignment, signal) =>
      new Promise<void>((resolve) => {
        const buffer = buffers.get(beat.n);
        if (buffer === undefined || signal.aborted) {
          resolve();
          return;
        }
        const node = context.createBufferSource();
        node.buffer = buffer;
        node.connect(gain);
        source = node;
        startAt = context.currentTime + START_LEAD_S;
        const done = () => {
          if (source === node) source = null;
          resolve();
        };
        node.onended = done;
        signal.addEventListener(
          "abort",
          () => {
            node.onended = null;
            try {
              node.stop();
            } catch {
              // Already stopped.
            }
            done();
          },
          { once: true },
        );
        node.start(startAt);
        void alignment;
      }),
    clock: () =>
      startAt < 0
        ? Number.NaN
        : Math.round((context.currentTime - startAt - latency()) * 1000),
    pause: () => void context.suspend(),
    resume: () => void context.resume(),
    setMuted: (on) => {
      gain.gain.value = on ? 0 : 1;
    },
    dispose: () => {
      try {
        source?.stop();
      } catch {
        // Nothing playing.
      }
      void context.close().catch(() => undefined);
    },
  };
}

/** A pausable timer clock over fixture timings. */
export function silentNarrator(
  now: () => number = () => performance.now(),
): StoryNarrator {
  let startedAt = -1;
  let pausedAt: number | null = null;
  let held = 0;
  let wake: (() => void) | null = null;
  const clock = () => {
    if (startedAt < 0) return Number.NaN;
    const at = pausedAt ?? now();
    return Math.round(at - startedAt - held);
  };
  return {
    kind: "SILENT",
    resumesInPlace: true,
    play: async (_beat, alignment, signal) => {
      // The same lead the rendered audio has, so first cues land on time.
      startedAt = now() + START_LEAD_S * 1000;
      held = 0;
      pausedAt = null;
      while (!signal.aborted && clock() < alignment.durationMs) {
        await new Promise<void>((resolve) => {
          wake = resolve;
          const timer = setTimeout(resolve, 50);
          signal.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              resolve();
            },
            { once: true },
          );
        });
        wake = null;
      }
    },
    clock,
    pause: () => {
      if (pausedAt === null) pausedAt = now();
    },
    resume: () => {
      if (pausedAt !== null) held += now() - pausedAt;
      pausedAt = null;
      wake?.();
    },
    setMuted: () => undefined,
    dispose: () => undefined,
  };
}

/** How long the live line may take to start a beat before it is skipped silently. */
const LIVE_START_MS = 5_000;
const LIVE_QUIET_MS = 800;

/**
 * GPT-Live fallback: each beat is said verbatim by Q's open live line,
 * after a one-line delivery brief. Pausing cuts the line (it cannot be
 * held), so resume restarts the beat, as an interruption does.
 */
export function liveNarrator(
  live: () =>
    (LiveNarration & { readonly brief: (text: string) => void }) | null,
  now: () => number = () => performance.now(),
): StoryNarrator {
  let heardAt = -1;
  let pausedAt: number | null = null;
  const wait = (ms: number, signal: AbortSignal) =>
    new Promise<void>((resolve) => {
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
  return {
    kind: "LIVE",
    resumesInPlace: false,
    play: async (beat, alignment, signal) => {
      heardAt = -1;
      const line = live();
      const text = renderText(beat)
        .replace(/\[[^\]]+\]\s*/gu, "")
        .trim();
      if (line === null) {
        // The line dropped: keep the beat's time so the screen stays honest.
        heardAt = now();
        await wait(alignment.durationMs, signal);
        return;
      }
      line.brief(
        `For the next line only, deliver it like this: ${beat.delivery}`,
      );
      const sentAt = now();
      if (!line.say(text)) {
        heardAt = now();
        await wait(alignment.durationMs, signal);
        return;
      }
      while (
        !signal.aborted &&
        !line.speaking() &&
        now() - sentAt < LIVE_START_MS
      ) {
        await wait(40, signal);
      }
      heardAt = now();
      let lastSound = now();
      const cap = heardAt + alignment.durationMs * 2 + 4_000;
      while (!signal.aborted && now() < cap) {
        if (line.speaking()) lastSound = now();
        else if (now() - lastSound > LIVE_QUIET_MS) break;
        await wait(60, signal);
      }
      if (signal.aborted) line.hush(true);
      setTimeout(() => line.hush(false), 1_500);
    },
    clock: () =>
      heardAt < 0 ? Number.NaN : Math.round((pausedAt ?? now()) - heardAt),
    pause: () => {
      pausedAt = now();
    },
    resume: () => {
      pausedAt = null;
    },
    setMuted: () => undefined,
    dispose: () => undefined,
  };
}
