// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { VoiceSessionEvents } from "../src/features/voice/session";

/**
 * A voice line that fails on its first word is given up on, and said so.
 *
 * Seen live on the welcome screen (CQ-ACCEPT-001): the Q API issued a
 * session, the provider failed as soon as it tried to speak, and the stage
 * reconnected — a new session and a model call for its greeting every few
 * seconds, without end, and finally vanished with nothing said. Issuing a
 * session is not the line working, so it must not refill the reconnect
 * budget.
 */

const startVoiceSessionAction = vi.fn();
vi.mock("../src/features/voice/actions", () => ({
  startVoiceSessionAction: (...args: unknown[]) =>
    startVoiceSessionAction(...args) as unknown,
  readVoiceTurnAction: () =>
    Promise.resolve({ ok: false, gone: false, message: "" }),
}));

// The transport stands in for a provider that fails as soon as it starts:
// one plain sentence, then the line reported dropped.
let events: VoiceSessionEvents = {};
vi.mock("../src/features/voice/use-voice-session", () => ({
  useVoiceSession: (latest: VoiceSessionEvents) => {
    events = latest;
    return {
      state: "IDLE",
      connected: false,
      muted: false,
      transcript: [],
      start: () => {
        queueMicrotask(() => {
          events.onError?.("Something went wrong with voice.");
          events.onEnded?.("dropped");
        });
        return Promise.resolve();
      },
      end: () => Promise.resolve(),
      sendText: () => undefined,
      setMuted: () => undefined,
      setVolume: () => undefined,
      inputLevel: () => 0,
      outputLevel: () => 0,
    };
  },
}));

const { useVoiceInterview } =
  await import("../src/features/voice/use-voice-interview");

beforeEach(() => {
  vi.useFakeTimers();
  startVoiceSessionAction.mockReset();
  startVoiceSessionAction.mockResolvedValue({
    ok: true,
    value: {
      voiceSessionId: "00000000-0000-4000-8000-000000000001",
      voice: "FEMALE",
      provider: "deepgram",
      token: "t",
    },
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("voice reconnect budget", () => {
  it("tries three times after a first-word failure, then stops and says so", async () => {
    const { result } = renderHook(() => useVoiceInterview());

    await act(async () => {
      await result.current.talk({ thread: { welcome: true } });
    });
    // Every scheduled retry, and the failure each one meets.
    for (let i = 0; i < 6; i += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
    }

    expect(startVoiceSessionAction).toHaveBeenCalledTimes(4);
    expect(result.current.active).toBe(false);
    expect(result.current.notice).toMatch(/couldn't get the line back/);
  });
});
