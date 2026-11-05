// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/discover" }));

type EngineInput = {
  readonly onWake: (phrase: string) => void;
  readonly onFailure: (failure: string) => void;
};
const engines: { input: EngineInput; stop: ReturnType<typeof vi.fn> }[] = [];
const startWakeEngine = vi.fn((input: EngineInput) => {
  const stop = vi.fn(() => Promise.resolve());
  engines.push({ input, stop });
  return Promise.resolve({ stop });
});
vi.mock("../src/features/wake/engine", () => ({ startWakeEngine }));

import {
  holdMicrophone,
  resetMicrophoneHolds,
} from "../src/features/voice/mic-hold";
import { microphoneFailure } from "../src/features/wake/microphone";
import { keepContextRunning } from "../src/features/wake/context-keeper";
import {
  onDeviceAvailability,
  ON_DEVICE_CHECK_MS,
  resetOnDevice,
} from "../src/features/wake/on-device";
import { matchWakePhrase } from "../src/features/wake/phrases";
import {
  createSpeechDetector,
  wakeInResults,
} from "../src/features/wake/speech-detector";
import { storeWakePreference } from "../src/features/wake/wake-preference";
import { resetWakeStatus, wakeStatus } from "../src/features/wake/wake-status";
import {
  WAKE_REARM_MS,
  WAKE_RETRY_MS,
  WakeWord,
} from "../src/features/wake/wake-word";

class FakeRecognition {
  static made: FakeRecognition[] = [];
  lang = "";
  continuous = false;
  interimResults = false;
  maxAlternatives = 1;
  onresult: ((event: unknown) => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  start = vi.fn();
  stop = vi.fn();
  abort = vi.fn();
  constructor() {
    FakeRecognition.made.push(this);
  }
}

describe("Hey Q reliability · the matcher and the detector", () => {
  beforeEach(() => {
    FakeRecognition.made = [];
    vi.stubGlobal("webkitSpeechRecognition", FakeRecognition);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("hears the phrase when the recogniser splits it across two results", () => {
    // Continuous recognition finalises "Hey." and starts a new result "Q".
    expect(
      wakeInResults({
        resultIndex: 1,
        results: [[{ transcript: "Hey." }], [{ transcript: " Q" }]],
      }),
    ).toBe("HEY_Q");
    expect(
      wakeInResults({
        resultIndex: 1,
        results: [[{ transcript: "hey" }], [{ transcript: " you there" }]],
      }),
    ).toBeNull();
  });

  it("accepts the other ways a recogniser spells the phrase, never 'hey you'", () => {
    expect(matchWakePhrase("hey que")).toBe("HEY_Q");
    expect(matchWakePhrase("hey kiu")).toBe("HEY_Q");
    expect(matchWakePhrase("high Q, what's next")).toBe("HI_Q");
    expect(matchWakePhrase("hey you")).toBeNull();
    expect(matchWakePhrase("high cool")).toBeNull();
  });

  it("restarts the recogniser when it ends on its own inside a window, a bounded number of times", () => {
    const detector = createSpeechDetector({
      onWake: vi.fn(),
      onFailure: vi.fn(),
    });
    detector?.start();
    expect(FakeRecognition.made).toHaveLength(1);
    // A network blip or "no-speech": the session ends while the gate's
    // window is still open. Before, nothing listened for the rest of it.
    FakeRecognition.made[0]?.onerror?.({ error: "network" });
    FakeRecognition.made[0]?.onend?.();
    expect(FakeRecognition.made).toHaveLength(2);
    expect(FakeRecognition.made[1]?.start).toHaveBeenCalledOnce();
    for (let i = 0; i < 10; i += 1) {
      FakeRecognition.made.at(-1)?.onend?.();
    }
    expect(FakeRecognition.made.length).toBeLessThanOrEqual(4);
  });

  it("does not restart once the gate stopped it", () => {
    const detector = createSpeechDetector({
      onWake: vi.fn(),
      onFailure: vi.fn(),
    });
    detector?.start();
    const first = FakeRecognition.made[0];
    const onend = first?.onend;
    detector?.stop();
    onend?.();
    expect(FakeRecognition.made).toHaveLength(1);
  });
});

describe("Hey Q reliability · microphone and audio", () => {
  it("tells a refused microphone from a busy one", () => {
    expect(microphoneFailure(new DOMException("x", "NotAllowedError"))).toBe(
      "microphone",
    );
    expect(microphoneFailure(new DOMException("x", "SecurityError"))).toBe(
      "microphone",
    );
    // Busy right after a call released it, or a device change: retry.
    expect(microphoneFailure(new DOMException("x", "NotReadableError"))).toBe(
      "interrupted",
    );
    expect(microphoneFailure(new DOMException("x", "AbortError"))).toBe(
      "interrupted",
    );
  });

  it("resumes a suspended audio context on the next tap, every time it suspends", () => {
    const target = new EventTarget();
    const context = Object.assign(new EventTarget(), {
      state: String("suspended"),
      resume: vi.fn(() => Promise.resolve()),
    });
    const release = keepContextRunning(context, target);
    expect(context.resume).toHaveBeenCalledTimes(1);
    target.dispatchEvent(new Event("pointerdown"));
    expect(context.resume).toHaveBeenCalledTimes(2);
    // Running, then interrupted by Q's own audio (Safari): armed again.
    context.state = "running";
    context.dispatchEvent(new Event("statechange"));
    context.state = "interrupted";
    context.dispatchEvent(new Event("statechange"));
    target.dispatchEvent(new Event("keydown"));
    expect(context.resume.mock.calls.length).toBeGreaterThanOrEqual(4);
    release();
    const before = context.resume.mock.calls.length;
    target.dispatchEvent(new Event("pointerdown"));
    expect(context.resume.mock.calls.length).toBe(before);
  });
});

describe("Hey Q reliability · on-device check", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    resetOnDevice();
  });

  it("answers 'unavailable' when the browser's check never resolves", async () => {
    vi.useFakeTimers();
    class Hanging {
      static available() {
        return new Promise(() => undefined);
      }
    }
    Object.defineProperty(Hanging.prototype, "processLocally", {
      value: false,
      writable: true,
    });
    vi.stubGlobal("webkitSpeechRecognition", Hanging);
    const result = onDeviceAvailability("en-US");
    await vi.advanceTimersByTimeAsync(ON_DEVICE_CHECK_MS + 1);
    await expect(result).resolves.toBe("unavailable");
  });
});

function stubSupport() {
  vi.stubGlobal("webkitSpeechRecognition", class {});
  vi.stubGlobal("AudioWorkletNode", class {});
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: vi.fn() },
  });
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible",
  });
}

describe("Hey Q reliability · the listener comes back", () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetWakeStatus();
    resetMicrophoneHolds();
    engines.length = 0;
    startWakeEngine.mockClear();
    stubSupport();
    storeWakePreference(true);
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("listens again after a wake when no call opened (no Q session, a failed line)", async () => {
    render(<WakeWord openQ={vi.fn()} />);
    await vi.waitFor(() => expect(startWakeEngine).toHaveBeenCalledOnce());
    vi.useFakeTimers();
    act(() => engines[0]?.input.onWake("HEY_Q"));
    expect(engines[0]?.stop).toHaveBeenCalled();
    // Before: stopped for good, while the indicator still said Listening.
    expect(wakeStatus().kind).not.toBe("LISTENING");
    await act(() => vi.advanceTimersByTimeAsync(WAKE_REARM_MS + 10));
    vi.useRealTimers();
    await vi.waitFor(() => expect(startWakeEngine).toHaveBeenCalledTimes(2));
  });

  it("retries after a transient microphone failure", async () => {
    render(<WakeWord openQ={vi.fn()} />);
    await vi.waitFor(() => expect(startWakeEngine).toHaveBeenCalledOnce());
    vi.useFakeTimers();
    act(() => engines[0]?.input.onFailure("interrupted"));
    await act(() => vi.advanceTimersByTimeAsync(WAKE_RETRY_MS + 10));
    vi.useRealTimers();
    await vi.waitFor(() => expect(startWakeEngine).toHaveBeenCalledTimes(2));
  });

  it("tries again after a refusal once the tab was away and came back", async () => {
    render(<WakeWord openQ={vi.fn()} />);
    await vi.waitFor(() => expect(startWakeEngine).toHaveBeenCalledOnce());
    act(() => engines[0]?.input.onFailure("blocked"));
    expect(wakeStatus().kind).toBe("BLOCKED");
    for (const state of ["hidden", "visible"]) {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: state,
      });
      act(() => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
    }
    await vi.waitFor(() => expect(startWakeEngine).toHaveBeenCalledTimes(2));
  });

  it("stops while another part of the page records from the microphone", async () => {
    render(<WakeWord openQ={vi.fn()} />);
    await vi.waitFor(() => expect(startWakeEngine).toHaveBeenCalledOnce());
    let release = () => undefined as void;
    act(() => {
      release = holdMicrophone();
    });
    expect(engines[0]?.stop).toHaveBeenCalled();
    expect(wakeStatus()).toEqual({ kind: "PAUSED", reason: "IN_CALL" });
    act(() => release());
    await vi.waitFor(() => expect(startWakeEngine).toHaveBeenCalledTimes(2));
  });
});
