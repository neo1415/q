// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { VoiceSessionEvents } from "../src/features/voice/session";

/**
 * DUPLEX: a full-duplex line that ends after it came up (the cap, its
 * maximum length, the network) carries on, on the same thread, on the
 * standard voice: resumed (Q does not greet again), asked for the standard
 * line explicitly, and with the cap's one sentence shown when there is one.
 */

const startVoiceSessionAction = vi.fn();
vi.mock("../src/features/voice/actions", () => ({
  startVoiceSessionAction: (...args: unknown[]) =>
    startVoiceSessionAction(...args) as unknown,
  readVoiceTurnAction: () =>
    Promise.resolve({ ok: false, gone: false, message: "" }),
  sendVoiceScreenAction: () => Promise.resolve({ ok: true }),
}));

let events: VoiceSessionEvents = {};
vi.mock("../src/features/voice/use-voice-session", () => ({
  useVoiceSession: (latest: VoiceSessionEvents) => {
    events = latest;
    return {
      state: "LISTENING",
      connected: true,
      muted: false,
      transcript: [],
      start: () => Promise.resolve(),
      end: () => Promise.resolve(),
      sendText: () => undefined,
      setMuted: () => undefined,
      setVolume: () => undefined,
      inputLevel: () => 0,
      outputLevel: () => 0,
    };
  },
}));

const { useVoiceInterview } = await import(
  "../src/features/voice/use-voice-interview"
);

const CONVERSATION = "7f000000-0000-4000-8000-000000000001";

beforeEach(() => {
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

describe("falling back from a duplex line", () => {
  it("resumes the same thread on the standard line and shows the cap's sentence", async () => {
    const { result } = renderHook(() => useVoiceInterview());
    await act(async () => {
      await result.current.talk({ thread: { conversationId: CONVERSATION } });
    });
    expect(startVoiceSessionAction.mock.calls[0]?.[0]).not.toHaveProperty(
      "duplex",
    );

    const notice =
      "I've reached today's limit for live voice, so I'm switching to my standard voice.";
    await act(async () => {
      events.onFallback?.(notice);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(startVoiceSessionAction).toHaveBeenCalledTimes(2);
    expect(startVoiceSessionAction.mock.calls[1]?.[0]).toMatchObject({
      conversationId: CONVERSATION,
      resume: true,
      duplex: false,
    });
    expect(result.current.notice).toBe(notice);
    expect(result.current.active).toBe(true);
  });

  it("falls back silently when there is nothing to say", async () => {
    const { result } = renderHook(() => useVoiceInterview());
    await act(async () => {
      await result.current.talk({ thread: { conversationId: CONVERSATION } });
    });
    await act(async () => {
      events.onFallback?.(null);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(startVoiceSessionAction).toHaveBeenCalledTimes(2);
    expect(result.current.notice).toBeNull();
  });
});
