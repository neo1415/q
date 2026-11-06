// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

/**
 * Owner 2026-11-06 (live): ended while the duplex line was still trying,
 * the client opens no standard line after it -- off stays off.
 */

const standardStart = vi.fn(() => Promise.resolve());
const fake = () => ({
  state: "LISTENING" as const,
  connected: false,
  muted: false,
  transcript: [],
  start: standardStart,
  end: () => Promise.resolve(),
  sendText: () => undefined,
  setMuted: () => undefined,
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
let finishDuplex: (up: boolean) => void = () => undefined;
const duplexEnd = vi.fn(() => {
  // Closing the line makes its open answer "not up".
  finishDuplex(false);
  return Promise.resolve();
});
vi.mock("../src/features/voice/provider/duplex-session", () => ({
  useDuplexVoiceSession: () => ({
    ...fake(),
    start: () =>
      new Promise<boolean>((resolve) => {
        finishDuplex = resolve;
      }),
    end: duplexEnd,
  }),
}));
vi.mock("../src/features/voice/live/live-call", () => ({
  LiveCallUnavailable: class extends Error {},
  isLiveTrialSpent: () => false,
  LIVE_AVAILABLE_TIMEOUT_MS: 1_500,
  askLiveVoice: () => Promise.resolve(false),
  startLiveCall: () => Promise.reject(new Error("not offered")),
}));

const { useVoiceSession } =
  await import("../src/features/voice/use-voice-session");

describe("ending while the duplex line is still connecting", () => {
  it("closes it and never brings up the standard line after", async () => {
    const { result } = renderHook(() => useVoiceSession({}, { live: false }));
    let starting: Promise<void> = Promise.resolve();
    act(() => {
      starting = result.current.start({
        credential: {
          voiceSessionId: "00000000-0000-4000-8000-000000000001",
          voice: "FEMALE",
          provider: "deepgram",
          duplex: {},
        },
      } as never);
    });
    await act(async () => {
      await Promise.resolve();
      await result.current.end();
      await starting;
    });
    expect(duplexEnd).toHaveBeenCalled();
    expect(standardStart).not.toHaveBeenCalled();
  });
});
