import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LINE_HOLD_MAX_MS } from "../src/features/voice/live/line-hold";
import {
  createVoiceIdle,
  promptMsFor,
  VOICE_IDLE_CLOSE_MS,
  VOICE_IDLE_PROMPT_MS,
  type VoiceIdleStep,
} from "../src/features/voice/live/voice-idle";

/**
 * Decision 112: the person-to-Q call closes a minute after the last spoken
 * turn, and Q asks "Still there?" at 45 s. Driven the way live-call drives
 * it: a 100 ms meter on the clock, here a fake one.
 */
function harness(held: () => boolean = () => false) {
  const steps: { at: number; step: VoiceIdleStep }[] = [];
  const idle = createVoiceIdle({
    closeMs: VOICE_IDLE_CLOSE_MS,
    promptMs: promptMsFor(VOICE_IDLE_CLOSE_MS),
    startedAt: Date.now(),
  });
  const start = Date.now();
  let closed = false;
  const meter = setInterval(() => {
    const step = idle.step(Date.now(), held());
    if (step === null) return;
    steps.push({ at: Date.now() - start, step });
    if (step === "CLOSE") {
      closed = true;
      clearInterval(meter);
    }
  }, 100);
  return {
    idle,
    steps,
    closed: () => closed,
    stop: () => clearInterval(meter),
  };
}

describe("voice idle (decision 112)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("the durations are the decision's: prompt at 45 s, close at 60 s", () => {
    expect(VOICE_IDLE_CLOSE_MS).toBe(60_000);
    expect(VOICE_IDLE_PROMPT_MS).toBe(45_000);
    expect(promptMsFor(VOICE_IDLE_CLOSE_MS)).toBe(45_000);
    // A server-set window keeps the 15 s lead, never under half of it.
    expect(promptMsFor(120_000)).toBe(105_000);
    expect(promptMsFor(20_000)).toBe(10_000);
  });

  it("asks once, then closes a minute after the last turn", () => {
    const h = harness();
    vi.advanceTimersByTime(44_000);
    expect(h.steps).toEqual([]);
    vi.advanceTimersByTime(2_000);
    expect(h.steps.map((s) => s.step)).toEqual(["PROMPT"]);
    // Q saying "Still there?" is not a turn: the close keeps its time.
    h.idle.heard("Q", Date.now());
    vi.advanceTimersByTime(16_000);
    expect(h.steps.map((s) => s.step)).toEqual(["PROMPT", "CLOSE"]);
    const close = h.steps[1]?.at ?? 0;
    expect(close).toBeGreaterThan(60_000);
    expect(close).toBeLessThanOrEqual(60_200);
    expect(h.closed()).toBe(true);
  });

  it("any speech resets the timer, after the prompt too", () => {
    const h = harness();
    vi.advanceTimersByTime(40_000);
    h.idle.heard("PERSON", Date.now());
    vi.advanceTimersByTime(40_000);
    expect(h.steps).toEqual([]);
    // Q's own answer is a turn as well.
    h.idle.heard("Q", Date.now());
    vi.advanceTimersByTime(46_000);
    expect(h.steps.map((s) => s.step)).toEqual(["PROMPT"]);
    // They answer "yes": the call stays, and a later silence asks again.
    h.idle.heard("PERSON", Date.now());
    vi.advanceTimersByTime(30_000);
    expect(h.closed()).toBe(false);
    vi.advanceTimersByTime(16_000);
    expect(h.steps.map((s) => s.step)).toEqual(["PROMPT", "PROMPT"]);
    h.stop();
  });

  it("work promised on the line holds it open, bounded", () => {
    const h = harness(() => true);
    vi.advanceTimersByTime(VOICE_IDLE_CLOSE_MS + 60_000);
    expect(h.steps).toEqual([]);
    vi.advanceTimersByTime(LINE_HOLD_MAX_MS);
    expect(h.steps.map((s) => s.step)).toEqual(["CLOSE"]);
  });

  it("Q in a meeting is untouched: its runtime keeps its own idle rule", () => {
    const meeting = readFileSync(
      join(
        __dirname,
        "..",
        "..",
        "q-api",
        "src",
        "composition",
        "meeting-host-runtime.ts",
      ),
      "utf8",
    );
    expect(meeting).not.toMatch(/voice-idle|VOICE_IDLE/u);
    expect(meeting).toContain("const IDLE_END_MS = 3 * 3_600_000;");
  });
});
