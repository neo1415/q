import { describe, expect, it } from "vitest";

import {
  ACT_BUDGET_MS,
  CUE_LEAD_MS,
  FIXTURE_ALIGNMENTS,
  STORY_BEATS,
  type BeatAlignment,
  type StoryAct,
  type StoryBeat,
} from "@capital-q/q-pitch";

import type { StoryNarrator } from "@/features/q-pitch/story/story-narrators";
import { silentNarrator } from "@/features/q-pitch/story/story-narrators";
import {
  StoryPlayer,
  type StoryActs,
} from "@/features/q-pitch/story/story-player";
import {
  isOnStoryRoute,
  storyPath,
} from "@/features/q-pitch/story/story-pages";
import { routeMatchesPattern, STORY_ROUTES } from "@capital-q/q-pitch";
import { APP_ROUTE_PATTERNS } from "@/features/q/control/app-routes";

/**
 * Q Story's run loop on a hand-driven clock: frames are flushed by the
 * test, the narrator's clock is set by the test, and acts are fakes that
 * acknowledge (or not) on demand.
 */
function harness(
  options: {
    readonly beats?: readonly StoryBeat[];
    readonly ack?: (act: StoryAct) => boolean | "never";
    readonly resumesInPlace?: boolean;
  } = {},
) {
  let now = 0;
  let clockMs = -1;
  let frames: (() => void)[] = [];
  let finish: (() => void) | null = null;
  const played: number[] = [];
  const narrator: StoryNarrator = {
    kind: "SILENT",
    resumesInPlace: options.resumesInPlace ?? true,
    play: (beat, _alignment, signal) =>
      new Promise<void>((resolve) => {
        played.push(beat.n);
        clockMs = 0;
        finish = resolve;
        signal.addEventListener("abort", () => resolve(), { once: true });
      }),
    clock: () => clockMs,
    pause: () => undefined,
    resume: () => undefined,
    setMuted: () => undefined,
    dispose: () => undefined,
  };
  const ran: StoryAct[] = [];
  const fellBack: StoryAct[] = [];
  const settled: number[] = [];
  const acts: StoryActs = {
    run: (act) => {
      ran.push(act);
      const ack = options.ack?.(act) ?? true;
      return ack === "never"
        ? new Promise<boolean>(() => undefined)
        : Promise.resolve(ack);
    },
    fallback: (act) => fellBack.push(act),
    warm: () => undefined,
    settle: (index) => settled.push(index),
  };
  const alignments = new Map<number, BeatAlignment>(
    FIXTURE_ALIGNMENTS.map((a) => [a.beat, a]),
  );
  const player = new StoryPlayer({
    alignments,
    narrator,
    acts,
    ...(options.beats === undefined ? {} : { beats: options.beats }),
    scheduler: {
      frame: (callback) => {
        frames.push(callback);
        return frames.length;
      },
      cancel: () => undefined,
      now: () => now,
    },
  });
  const flush = async () => {
    const pending = frames;
    frames = [];
    for (const callback of pending) callback();
    await Promise.resolve();
    await Promise.resolve();
  };
  return {
    player,
    ran,
    fellBack,
    settled,
    played,
    at: async (ms: number, wall = ms) => {
      clockMs = ms;
      now = wall;
      await flush();
    },
    endBeat: async () => {
      finish?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await flush();
    },
  };
}

const beat = (n: number) => {
  const found = STORY_BEATS[n - 1];
  if (found === undefined) throw new Error("no beat");
  return found;
};

describe("Q Story player", () => {
  it("runs each cue on its word, 120 ms ahead, on the narrator's clock", async () => {
    const h = harness({ beats: [beat(6)] });
    h.player.start();
    const words = FIXTURE_ALIGNMENTS[5]?.words ?? [];
    await h.at(0);
    expect(h.ran).toHaveLength(1);
    const second = words[1]?.startMs ?? 0;
    await h.at(second - CUE_LEAD_MS - 1);
    expect(h.ran).toHaveLength(1);
    await h.at(second - CUE_LEAD_MS);
    expect(h.ran).toEqual([
      { kind: "stage", visual: "inbox", step: 1 },
      { kind: "stage", visual: "inbox", step: 2 },
    ]);
    // Acknowledged on the next frame, before the word starts.
    await h.at(second - CUE_LEAD_MS + 16);
    const sample = h.player.samples.at(-1);
    expect(sample?.offsetMs).toBeLessThan(0);
    expect(h.player.snapshot().word).toBe(0);
    await h.at(second);
    expect(h.player.snapshot().word).toBe(1);
  });

  it("never waits for a visual: a missed act gets the safe fallback, the beat goes on", async () => {
    const h = harness({
      beats: [beat(36), beat(37)],
      ack: (act) => (act.kind === "navigate" ? "never" : true),
    });
    h.player.start();
    await h.at(0, 0);
    expect(h.ran[0]).toEqual({ kind: "navigate", route: "capital-mandate" });
    await h.at(100, ACT_BUDGET_MS.navigate + 1);
    expect(h.fellBack).toEqual([
      { kind: "navigate", route: "capital-mandate" },
    ]);
    expect(h.player.snapshot().fallbacks).toBe(1);
    await h.endBeat();
    expect(h.played).toEqual([36, 37]);
  });

  it("finishes a beat's remaining cues when its audio ends between frames", async () => {
    const h = harness({ beats: [beat(6), beat(7)] });
    h.player.start();
    await h.at(0);
    await h.endBeat();
    expect(
      h.ran
        .filter((a) => a.kind === "stage" && a.visual === "inbox")
        .map((a) => (a.kind === "stage" ? a.step : 0)),
    ).toEqual([1, 2, 3, 4]);
    expect(h.played).toEqual([6, 7]);
  });

  it("pauses and resumes in place; an interruption restarts the beat", async () => {
    const h = harness({ beats: [beat(6), beat(7)] });
    h.player.start();
    await h.at(0);
    h.player.pause();
    expect(h.player.snapshot().phase).toBe("PAUSED");
    h.player.resume();
    expect(h.player.snapshot().phase).toBe("PLAYING");
    expect(h.played).toEqual([6]);
    h.player.interrupt();
    expect(h.player.snapshot().phase).toBe("INTERRUPTED");
    h.player.resume();
    await h.at(0);
    expect(h.played).toEqual([6, 6]);
    expect(h.settled).toEqual([0, 0]);
  });

  it("jumps by beat: go to N settles the screen and plays N", async () => {
    const h = harness();
    h.player.goTo(39);
    await h.at(0);
    expect(h.settled).toEqual([39]);
    expect(h.played).toEqual([40]);
    expect(h.player.snapshot().index).toBe(39);
  });

  it("the silent narrator's clock freezes while paused", async () => {
    let t = 0;
    const narrator = silentNarrator(() => t);
    const controller = new AbortController();
    const done = narrator.play(
      beat(1),
      FIXTURE_ALIGNMENTS[0] as BeatAlignment,
      controller.signal,
    );
    t = 300;
    expect(narrator.clock()).toBe(300);
    narrator.pause();
    t = 900;
    expect(narrator.clock()).toBe(300);
    narrator.resume();
    t = 1_000;
    expect(narrator.clock()).toBe(400);
    controller.abort();
    await done;
  });
});

describe("Q Story pages", () => {
  it("every story route is an app route, opened directly", () => {
    for (const route of STORY_ROUTES) {
      const path = storyPath(route);
      expect(path).not.toBeNull();
      const pathname = (path ?? "").split(/[?#]/u)[0] ?? "";
      expect(
        APP_ROUTE_PATTERNS.some((pattern) =>
          routeMatchesPattern(pattern, pathname),
        ),
      ).toBe(true);
    }
  });

  it("acknowledges a route only when the address is that page", () => {
    expect(
      isOnStoryRoute("gateq-gate", { pathname: "/gateq", search: "?tab=gate" }),
    ).toBe(true);
    expect(
      isOnStoryRoute("gateq-gate", {
        pathname: "/gateq",
        search: "?tab=inbox",
      }),
    ).toBe(false);
    expect(
      isOnStoryRoute("home", { pathname: "/home", search: "?qpitch=story" }),
    ).toBe(true);
    expect(isOnStoryRoute("discover", { pathname: "/home", search: "" })).toBe(
      false,
    );
  });
});
