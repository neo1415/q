// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/discover" }));

const startWakeEngine = vi.fn(() =>
  Promise.resolve({ stop: () => Promise.resolve() }),
);
vi.mock("../src/features/wake/engine", () => ({ startWakeEngine }));

import {
  DEFAULT_GATE_CONFIG,
  initialGate,
  stepGate,
  type GateEffect,
  type GateEvent,
  type GateState,
} from "../src/features/wake/gate";
import { matchWakePhrase, WAKE_PHRASES } from "../src/features/wake/phrases";
import {
  createSpeechDetector,
  wakeInResults,
} from "../src/features/wake/speech-detector";
import { wakeIndicatorText } from "../src/features/wake/wake-indicator";
import {
  readWakePreference,
  storeWakePreference,
  WAKE_PREFERENCE_KEY,
} from "../src/features/wake/wake-preference";
import { WakeSetting } from "../src/features/wake/wake-setting";
import { resetWakeStatus } from "../src/features/wake/wake-status";
import { WakeWord, wakeDecision } from "../src/features/wake/wake-word";

const C = DEFAULT_GATE_CONFIG;
const QUIET = 0.002;
const SPEECH = 0.2;

/** Feed events in order; collect every effect with its time. */
function run(
  events: readonly GateEvent[],
  start: GateState = initialGate(),
): { state: GateState; effects: { at: number; effect: GateEffect }[] } {
  let state = start;
  const effects: { at: number; effect: GateEffect }[] = [];
  for (const event of events) {
    const step = stepGate(state, event, C);
    state = step.state;
    for (const effect of step.effects) effects.push({ at: event.at, effect });
  }
  return { state, effects };
}

function frames(from: number, count: number, rms: number): GateEvent[] {
  return Array.from({ length: count }, (_, i) => ({
    type: "frame" as const,
    at: from + i * 32,
    rms,
  }));
}

describe("D1 · wake phrases (the only fixed phrase list)", () => {
  it("is exactly Hey Q, Hello Q, Hi Q and OK Q", () => {
    expect(WAKE_PHRASES.map((p) => p.label)).toEqual([
      "Hey Q",
      "Hello Q",
      "Hi Q",
      "OK Q",
    ]);
  });

  it.each([
    ["Hey Q", "HEY_Q"],
    ["hey cue", "HEY_Q"],
    ["Hey queue.", "HEY_Q"],
    ["Hey, Q!", "HEY_Q"],
    ["heyq", "HEY_Q"],
    ["Hello Q", "HELLO_Q"],
    ["hello cue", "HELLO_Q"],
    ["Hi Q", "HI_Q"],
    ["hi queue", "HI_Q"],
    ["OK Q", "OK_Q"],
    ["okay Q", "OK_Q"],
    ["okay cue", "OK_Q"],
    ["O.K. Q", "OK_Q"],
    ["Hey Q, show me the top three", "HEY_Q"],
    ["so um hey Q what's new", "HEY_Q"],
  ])("hears %j", (transcript, phrase) => {
    expect(matchWakePhrase(transcript)).toBe(phrase);
  });

  it.each([
    "hey you",
    "OK cool",
    "hike you",
    "hey cute",
    "okay google",
    "high view",
    "hey queen",
    "hi everyone",
    "the queue is long",
    "Q",
    "hey",
    "",
  ])("ignores the hard negative %j", (transcript) => {
    expect(matchWakePhrase(transcript)).toBeNull();
  });
});

describe("D2 · the local voice-activity gate", () => {
  it("keeps the detector off while the room is quiet", () => {
    const { state, effects } = run(frames(0, 200, QUIET));
    expect(effects).toEqual([]);
    expect(state.kind).toBe("idle");
  });

  it("opens only after consecutive speech frames, not a single click", () => {
    const click = run([
      ...frames(0, 50, QUIET),
      { type: "frame", at: 1600, rms: SPEECH },
      ...frames(1632, 10, QUIET),
    ]);
    expect(click.effects).toEqual([]);

    const speech = run([...frames(0, 50, QUIET), ...frames(1600, 3, SPEECH)]);
    expect(speech.effects).toEqual([
      { at: 1600 + 2 * 32, effect: "detector-start" },
    ]);
  });

  it("closes the window after silence and spaces the next one", () => {
    const open = run([...frames(0, 10, QUIET), ...frames(320, 3, SPEECH)]);
    const openedAt = 320 + 64;
    const closed = run(
      frames(openedAt + 32, Math.ceil(C.windowMs / 32) + 1, QUIET),
      open.state,
    );
    expect(closed.effects.map((e) => e.effect)).toEqual(["detector-stop"]);
    const stopAt = closed.effects[0]?.at ?? 0;
    expect(stopAt - openedAt).toBeGreaterThanOrEqual(C.windowMs);
    // Speech inside the rest does not reopen at once.
    const soon = run(frames(stopAt + 32, 3, SPEECH), closed.state);
    expect(soon.effects).toEqual([]);
  });

  it("never keeps a window open past the cap, even in steady speech", () => {
    const { effects } = run(
      frames(0, Math.ceil(C.maxOpenMs / 32) + 10, SPEECH),
    );
    const start = effects.find((e) => e.effect === "detector-start");
    const stop = effects.find((e) => e.effect === "detector-stop");
    expect(start).toBeDefined();
    expect((stop?.at ?? Infinity) - (start?.at ?? 0)).toBeLessThanOrEqual(
      C.maxOpenMs + 32,
    );
  });

  it("opens at most the per-minute budget of windows in a noisy minute", () => {
    // Bursts of speech then silence, for a minute.
    const events: GateEvent[] = [];
    for (let t = 0; t < 60_000; t += 6000) {
      events.push(...frames(t, 10, SPEECH), ...frames(t + 320, 160, QUIET));
    }
    const starts = run(events).effects.filter(
      (e) => e.effect === "detector-start",
    );
    expect(starts.length).toBe(C.maxWindowsPerMinute);
  });

  it("wakes once on a match, then cools down", () => {
    const open = run([...frames(0, 10, QUIET), ...frames(320, 3, SPEECH)]);
    const matched = stepGate(open.state, { type: "match", at: 800 }, C);
    expect(matched.effects).toEqual(["detector-stop", "wake"]);
    expect(matched.state.kind).toBe("cooldown");

    // A second match and speech during the cooldown do nothing.
    const again = stepGate(matched.state, { type: "match", at: 900 }, C);
    expect(again.effects).toEqual([]);
    const during = run(frames(900, 20, SPEECH), matched.state);
    expect(during.effects).toEqual([]);

    // After it, the gate listens again.
    const after = run(
      frames(800 + C.cooldownMs + 32, 4, SPEECH),
      matched.state,
    );
    expect(after.effects.map((e) => e.effect)).toEqual(["detector-start"]);
  });

  it("ignores a late match when no window is open", () => {
    const step = stepGate(initialGate(), { type: "match", at: 10 }, C);
    expect(step.effects).toEqual([]);
  });
});

describe("D2 · when Hey Q may listen", () => {
  const base = {
    enabled: true,
    supported: true,
    visible: true,
    inCall: false,
    lowBattery: false,
    pausedByYou: false,
  };
  it.each([
    [{}, "LISTEN"],
    [{ enabled: false }, "OFF"],
    [{ supported: false }, "UNAVAILABLE"],
    [{ visible: false }, "HIDDEN"],
    [{ inCall: true }, "IN_CALL"],
    [{ lowBattery: true }, "BATTERY"],
    [{ pausedByYou: true }, "BY_YOU"],
  ])("%j → %s", (change, decision) => {
    expect(wakeDecision({ ...base, ...change })).toBe(decision);
  });

  it("shows a visible indicator whenever the microphone is in use", () => {
    expect(wakeIndicatorText({ kind: "LISTENING" })).toMatch(/Listening/);
    expect(wakeIndicatorText({ kind: "HEARING" })).toMatch(/Listening/);
    expect(wakeIndicatorText({ kind: "OFF" })).toBeNull();
    expect(wakeIndicatorText({ kind: "PAUSED", reason: "IN_CALL" })).toBeNull();
    expect(wakeIndicatorText({ kind: "BLOCKED" })).toMatch(/microphone/);
  });
});

describe("D2 · the speech-recogniser detector", () => {
  it("finds the phrase in any alternative of the new results", () => {
    const event = {
      resultIndex: 1,
      results: [
        [{ transcript: "hey Q" }], // already handled: before resultIndex
        [{ transcript: "hey you" }, { transcript: "hey cue" }],
      ],
    };
    expect(wakeInResults(event)).toBe("HEY_Q");
    expect(
      wakeInResults({ ...event, results: [[], [{ transcript: "OK cool" }]] }),
    ).toBeNull();
  });

  it("starts only when asked and stops itself on a wake", () => {
    const made: FakeRecognition[] = [];
    class FakeRecognition {
      lang = "";
      continuous = false;
      interimResults = false;
      maxAlternatives = 1;
      onresult: ((event: unknown) => void) | null = null;
      onerror = null;
      onend = null;
      start = vi.fn();
      stop = vi.fn();
      abort = vi.fn();
      constructor() {
        made.push(this);
      }
    }
    vi.stubGlobal("webkitSpeechRecognition", FakeRecognition);
    const onWake = vi.fn();
    const detector = createSpeechDetector({ onWake, onFailure: vi.fn() });
    expect(detector).not.toBeNull();
    expect(made).toHaveLength(0);
    detector?.start();
    expect(made).toHaveLength(1);
    const recognition = made[0];
    expect(recognition?.start).toHaveBeenCalledOnce();
    expect(recognition?.continuous).toBe(true);
    recognition?.onresult?.({
      resultIndex: 0,
      results: [[{ transcript: "okay Q" }]],
    });
    expect(onWake).toHaveBeenCalledWith("OK_Q");
    expect(recognition?.abort).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });
});

function stubSupport(getUserMedia: () => Promise<unknown>) {
  const mic = vi.fn(getUserMedia);
  vi.stubGlobal("webkitSpeechRecognition", class {});
  vi.stubGlobal("AudioWorkletNode", class {});
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: mic },
  });
  return mic;
}

const grantedStream = () =>
  Promise.resolve({ getTracks: () => [{ stop: vi.fn() }] });

describe("D2 · Settings → Q → Say “Hey Q” to start", () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetWakeStatus();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("is off by default", () => {
    stubSupport(grantedStream);
    expect(readWakePreference()).toBe(false);
    render(<WakeSetting />);
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe(
      "false",
    );
  });

  it("asks for the microphone, then turns on and is remembered", async () => {
    const mic = stubSupport(grantedStream);
    render(<WakeSetting />);
    await userEvent.click(screen.getByRole("switch"));
    expect(mic).toHaveBeenCalledOnce();
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(window.localStorage.getItem(WAKE_PREFERENCE_KEY)).toBe("on");
    await userEvent.click(screen.getByRole("switch"));
    expect(window.localStorage.getItem(WAKE_PREFERENCE_KEY)).toBe("off");
  });

  it("stays off and says how to allow it when the microphone is refused", async () => {
    stubSupport(() =>
      Promise.reject(new DOMException("denied", "NotAllowedError")),
    );
    render(<WakeSetting />);
    await userEvent.click(screen.getByRole("switch"));
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe(
      "false",
    );
    expect(screen.getByRole("alert").textContent).toMatch(/blocked/);
    expect(readWakePreference()).toBe(false);
  });

  it("says when the browser cannot do it, and cannot be turned on", () => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn(grantedStream) },
    });
    render(<WakeSetting />);
    expect(screen.getByRole("switch")).toHaveProperty("disabled", true);
    expect(screen.getByText(/can’t listen/)).toBeTruthy();
  });
});

describe("D2 · nothing loads while the toggle is off", () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetWakeStatus();
    startWakeEngine.mockClear();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("off: no engine, no microphone", async () => {
    const mic = stubSupport(grantedStream);
    render(<WakeWord openQ={vi.fn()} />);
    await act(() => Promise.resolve());
    expect(startWakeEngine).not.toHaveBeenCalled();
    expect(mic).not.toHaveBeenCalled();
  });

  it("on and visible: the engine is loaded and started", async () => {
    stubSupport(grantedStream);
    storeWakePreference(true);
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    render(<WakeWord openQ={vi.fn()} />);
    await vi.waitFor(() => expect(startWakeEngine).toHaveBeenCalledOnce());
  });

  it("on, but a line is playing (a GPT-Live call that holds no surface): not started", async () => {
    // V (founder 2026-10-09, "two voices"): the wake word heard Q's own
    // voice on the preview's GPT-Live call and opened a second line.
    stubSupport(grantedStream);
    storeWakePreference(true);
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    const { claimVoiceAudio, releaseVoiceAudio } =
      await import("../src/features/voice/voice-audio");
    const call = { stop: () => undefined };
    await claimVoiceAudio(call);
    render(<WakeWord openQ={vi.fn()} />);
    await act(() => Promise.resolve());
    expect(startWakeEngine).not.toHaveBeenCalled();
    // The call ends: the wake word may listen again.
    act(() => {
      releaseVoiceAudio(call);
    });
    await vi.waitFor(() => expect(startWakeEngine).toHaveBeenCalledOnce());
  });

  it("on but hidden: not started", async () => {
    stubSupport(grantedStream);
    storeWakePreference(true);
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    render(<WakeWord openQ={vi.fn()} />);
    await act(() => Promise.resolve());
    expect(startWakeEngine).not.toHaveBeenCalled();
  });
});

describe("D2 · the engine is a lazy chunk", () => {
  it("is never imported statically outside its own folder's loader", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { readFileSync, readdirSync } = fs;
    const join = (...parts: string[]) => path.join(...parts);
    const roots = ["src", "app"].map((dir) => join(__dirname, "..", dir));
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (/\.tsx?$/.test(entry.name)) {
          const text = readFileSync(path, "utf8");
          if (
            /^import (?!type)[^;]*from "[^"]*wake\/engine"/m.test(text) ||
            /^import (?!type)[^;]*from "\.\/engine"/m.test(text)
          ) {
            offenders.push(path);
          }
        }
      }
    };
    roots.forEach(walk);
    expect(offenders).toEqual([]);
  });
});
