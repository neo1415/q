import {
  ActVerifier,
  BeatCueClock,
  STORY_BEATS,
  scheduleBeat,
  spokenWord,
  warmRoutes,
  type BeatAlignment,
  type ScheduledCue,
  type StoryAct,
  type StoryBeat,
  type StoryRoute,
} from "@capital-q/q-pitch";

import type { StoryNarrator } from "./story-narrators";

/**
 * The story's run loop: one beat after another on the narrator's clock.
 * Each animation frame reads the clock, releases the cues that are due,
 * runs their acts, and checks the verifier. Audio is never held for the
 * screen: an act that misses its budget gets the safe fallback while the
 * words go on.
 *
 * Framework-free (the host subscribes like an external store), so tests
 * drive it with a fake clock and fake acts.
 */
export type StoryPhase =
  "READY" | "PLAYING" | "PAUSED" | "INTERRUPTED" | "DONE";

export type StorySnapshot = {
  readonly phase: StoryPhase;
  /** 0-based beat index. */
  readonly index: number;
  readonly beat: StoryBeat;
  /** The word being spoken (-1 before the beat's first word). */
  readonly word: number;
  readonly fallbacks: number;
};

export type StoryActs = {
  /** Runs one act; resolves true once the screen shows it. */
  readonly run: (
    act: StoryAct,
    cue: ScheduledCue,
    signal: AbortSignal,
  ) => Promise<boolean>;
  /** The safe fallback for an act that missed its budget. */
  readonly fallback: (act: StoryAct, cue: ScheduledCue) => void;
  /** Keep a route warm (router.prefetch). */
  readonly warm: (route: StoryRoute) => void;
  /** Put the screen where beat `index` starts (a jump or a restart). */
  readonly settle: (index: number) => void;
};

export type CueSample = {
  readonly cueId: string;
  readonly kind: StoryAct["kind"];
  /** Acknowledged at this beat time minus the word's start: < 0 = before the word. */
  readonly offsetMs: number;
};

type Scheduler = {
  readonly frame: (callback: () => void) => number;
  readonly cancel: (handle: number) => void;
  readonly now: () => number;
};

const browserScheduler: Scheduler = {
  frame: (callback) => requestAnimationFrame(callback),
  cancel: (handle) => cancelAnimationFrame(handle),
  now: () => performance.now(),
};

export class StoryPlayer {
  readonly #beats: readonly StoryBeat[];
  readonly #alignments: ReadonlyMap<number, BeatAlignment>;
  readonly #narrator: StoryNarrator;
  readonly #acts: StoryActs;
  readonly #scheduler: Scheduler;
  readonly #listeners = new Set<() => void>();
  readonly #verifier = new ActVerifier();
  readonly #samples: CueSample[] = [];
  #snapshot: StorySnapshot;
  #beatAbort: AbortController | null = null;
  #frame: number | null = null;
  #clock: BeatCueClock | null = null;
  #cues: readonly ScheduledCue[] = [];
  #generation = 0;
  #fallbacks = 0;
  readonly #fallbackCues: string[] = [];
  #frames = { count: 0, long: 0, last: 0 };

  constructor(input: {
    readonly alignments: ReadonlyMap<number, BeatAlignment>;
    readonly narrator: StoryNarrator;
    readonly acts: StoryActs;
    readonly beats?: readonly StoryBeat[];
    readonly scheduler?: Scheduler;
  }) {
    this.#beats = input.beats ?? STORY_BEATS;
    this.#alignments = input.alignments;
    this.#narrator = input.narrator;
    this.#acts = input.acts;
    this.#scheduler = input.scheduler ?? browserScheduler;
    const first = this.#beats[0];
    if (first === undefined) throw new Error("Q Story: no beats");
    this.#snapshot = {
      phase: "READY",
      index: 0,
      beat: first,
      word: -1,
      fallbacks: 0,
    };
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  snapshot = (): StorySnapshot => this.#snapshot;

  get total(): number {
    return this.#beats.length;
  }

  /** Cue-to-word offsets, for the evidence (median, p95). */
  get samples(): readonly CueSample[] {
    return this.#samples;
  }

  /** Which acts took the safe fallback (evidence). */
  get fallbackCues(): readonly string[] {
    return this.#fallbackCues;
  }

  /** Frames seen and frames over 50 ms (dropped), while playing. */
  get frames(): { readonly count: number; readonly long: number } {
    return { count: this.#frames.count, long: this.#frames.long };
  }

  #set(patch: Partial<StorySnapshot>): void {
    this.#snapshot = {
      ...this.#snapshot,
      ...patch,
      fallbacks: this.#fallbacks,
    };
    for (const listener of this.#listeners) listener();
  }

  setMuted(on: boolean): void {
    this.#narrator.setMuted(on);
  }

  start(index = 0): void {
    this.goTo(index);
  }

  /** Jump to beat `index` (0-based) and play from its first word. */
  goTo(index: number): void {
    const beat = this.#beats[index];
    if (beat === undefined) return;
    this.#stopBeat();
    this.#acts.settle(index);
    void this.#run(index);
  }

  pause(): void {
    if (this.#snapshot.phase !== "PLAYING") return;
    if (this.#narrator.resumesInPlace) this.#narrator.pause();
    else this.#stopBeat();
    this.#verifier.clear();
    this.#set({ phase: "PAUSED" });
  }

  /** A question: the story stops; "carry on" restarts the beat (plan §4). */
  interrupt(): void {
    if (this.#snapshot.phase !== "PLAYING" && this.#snapshot.phase !== "PAUSED")
      return;
    this.#stopBeat();
    this.#set({ phase: "INTERRUPTED" });
  }

  resume(): void {
    const { phase, index } = this.#snapshot;
    if (phase === "PAUSED" && this.#narrator.resumesInPlace) {
      this.#narrator.resume();
      this.#set({ phase: "PLAYING" });
      this.#loop();
      return;
    }
    if (phase === "PAUSED" || phase === "INTERRUPTED") this.goTo(index);
  }

  end(): void {
    this.#stopBeat();
    this.#set({ phase: "DONE" });
  }

  dispose(): void {
    this.#stopBeat();
    this.#narrator.dispose();
    this.#listeners.clear();
  }

  #stopBeat(): void {
    this.#generation += 1;
    this.#beatAbort?.abort();
    this.#beatAbort = null;
    if (this.#frame !== null) this.#scheduler.cancel(this.#frame);
    this.#frame = null;
    this.#verifier.clear();
    this.#narrator.resume();
  }

  async #run(from: number): Promise<void> {
    const generation = this.#generation;
    for (let index = from; index < this.#beats.length; index += 1) {
      if (generation !== this.#generation) return;
      const beat = this.#beats[index];
      const alignment =
        beat === undefined ? undefined : this.#alignments.get(beat.n);
      if (beat === undefined || alignment === undefined) continue;
      for (const route of warmRoutes(index)) this.#acts.warm(route);
      this.#cues = scheduleBeat(beat, alignment);
      this.#clock = new BeatCueClock(this.#cues);
      const controller = new AbortController();
      this.#beatAbort = controller;
      this.#set({ phase: "PLAYING", index, beat, word: -1 });
      this.#loop();
      await this.#narrator.play(beat, alignment, controller.signal);
      if (generation !== this.#generation) return;
      // Whatever the audio passed without a frame (a background tab) runs now.
      this.#tick(Number.POSITIVE_INFINITY);
      if (beat.silenceAfterMs > 0) {
        await new Promise((resolve) =>
          setTimeout(resolve, beat.silenceAfterMs),
        );
      }
      while (
        this.#snapshot.phase === "PAUSED" &&
        generation === this.#generation
      ) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    if (generation !== this.#generation) return;
    if (this.#frame !== null) this.#scheduler.cancel(this.#frame);
    this.#frame = null;
    this.#set({ phase: "DONE", word: -1 });
  }

  #loop(): void {
    if (this.#frame !== null) this.#scheduler.cancel(this.#frame);
    const step = () => {
      this.#frame = null;
      if (this.#snapshot.phase !== "PLAYING") return;
      const now = this.#scheduler.now();
      if (this.#frames.last > 0) {
        this.#frames.count += 1;
        if (now - this.#frames.last > 50) this.#frames.long += 1;
      }
      this.#frames.last = now;
      this.#tick(this.#narrator.clock());
      this.#frame = this.#scheduler.frame(step);
    };
    this.#frames.last = 0;
    this.#frame = this.#scheduler.frame(step);
  }

  #tick(ms: number): void {
    const clock = this.#clock;
    const signal = this.#beatAbort?.signal;
    const alignment = this.#alignments.get(this.#snapshot.beat.n);
    if (clock === null || signal === undefined || alignment === undefined)
      return;
    if (Number.isNaN(ms)) return;
    const now = this.#scheduler.now();
    for (const cue of clock.due(ms)) {
      this.#verifier.begin(cue, now);
      void this.#acts.run(cue.act, cue, signal).then((ok) => {
        if (!ok || signal.aborted) return;
        const outcome = this.#verifier.acknowledge(
          cue.cueId,
          this.#scheduler.now(),
        );
        if (outcome === null) return;
        const heard = this.#narrator.clock();
        this.#samples.push({
          cueId: cue.cueId,
          kind: cue.act.kind,
          offsetMs: Math.round(heard - cue.wordMs),
        });
      });
    }
    for (const outcome of this.#verifier.expire(now)) {
      if (outcome.kind !== "SAFE_FALLBACK") continue;
      const cue = this.#cues.find((c) => c.cueId === outcome.cueId);
      if (cue === undefined) continue;
      this.#fallbacks += 1;
      this.#fallbackCues.push(
        `${cue.cueId} ${cue.act.kind}${"anchor" in cue.act ? ` ${cue.act.anchor}` : "route" in cue.act ? ` ${cue.act.route}` : ""}`,
      );
      this.#acts.fallback(outcome.act, cue);
      this.#set({});
    }
    const word = Number.isFinite(ms)
      ? spokenWord(alignment, ms)
      : this.#snapshot.beat.words.length - 1;
    if (word !== this.#snapshot.word) this.#set({ word });
  }
}
