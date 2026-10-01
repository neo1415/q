// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * An open line stops listening when the person leaves (founder live
 * 2026-10-01: with Capital Q's voice open, a long dictation to their
 * developer was stored as theirs and later answered from). Hidden tab,
 * page put away or a long loss of focus pauses the microphone; only
 * their own Unmute resumes it.
 */

const setMuted = vi.fn();
let muted = false;
const fake = () => ({
  state: "LISTENING" as const,
  connected: true,
  muted,
  transcript: [],
  start: () => Promise.resolve(),
  end: () => Promise.resolve(),
  sendText: () => undefined,
  setMuted: (next: boolean) => {
    muted = next;
    setMuted(next);
  },
  setVolume: () => undefined,
  inputLevel: () => 0,
  outputLevel: () => 0,
});
vi.mock("../src/features/voice/provider/deepgram-session", () => ({
  useDeepgramVoiceSession: () => fake(),
}));
vi.mock("../src/features/voice/provider/elevenlabs-session", () => ({
  useElevenLabsVoiceSession: () => fake(),
}));

const { useVoiceSession, AWAY_BLUR_PAUSE_MS } =
  await import("../src/features/voice/use-voice-session");

function hide(hidden: boolean) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => (hidden ? "hidden" : "visible"),
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("the microphone pauses when the person leaves", () => {
  beforeEach(() => {
    muted = false;
    setMuted.mockClear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    hide(false);
  });

  it("pauses at once when the tab is hidden, and says why", () => {
    const { result, rerender } = renderHook(() => useVoiceSession());
    act(() => hide(true));
    rerender();
    expect(setMuted).toHaveBeenCalledWith(true);
    expect(result.current.pausedAway).toBe(true);
  });

  it("pauses after a long loss of focus, not a glance", () => {
    const { result, rerender } = renderHook(() => useVoiceSession());
    act(() => {
      window.dispatchEvent(new Event("blur"));
      vi.advanceTimersByTime(AWAY_BLUR_PAUSE_MS - 1_000);
      window.dispatchEvent(new Event("focus"));
      vi.advanceTimersByTime(AWAY_BLUR_PAUSE_MS);
    });
    expect(setMuted).not.toHaveBeenCalled();
    act(() => {
      window.dispatchEvent(new Event("blur"));
      vi.advanceTimersByTime(AWAY_BLUR_PAUSE_MS);
    });
    rerender();
    expect(setMuted).toHaveBeenCalledWith(true);
    expect(result.current.pausedAway).toBe(true);
  });

  it("does not resume on its own: coming back leaves it paused until they unmute", () => {
    const { result, rerender } = renderHook(() => useVoiceSession());
    act(() => hide(true));
    act(() => {
      hide(false);
      window.dispatchEvent(new Event("focus"));
    });
    rerender();
    expect(setMuted).toHaveBeenCalledTimes(1);
    expect(result.current.pausedAway).toBe(true);
    act(() => result.current.setMuted(false));
    rerender();
    expect(setMuted).toHaveBeenLastCalledWith(false);
    expect(result.current.pausedAway).toBe(false);
  });
});
