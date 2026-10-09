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
/** What the turn board read answers; a test may say the line was replaced. */
let turnRead: { ok: false; gone: boolean; replaced?: boolean } = {
  ok: false,
  gone: false,
};
// G-D19: the turn board poll and the screen are fetches through the voice
// route now, not server actions.
vi.mock("../src/features/voice/provider/duplex-relays", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  readVoiceTurn: (id: string) => {
    void id;
    return Promise.resolve(turnRead);
  },
  sendVoiceScreen: () => Promise.resolve(),
}));
vi.mock("../src/features/voice/actions", () => ({
  startVoiceSessionAction: (...args: unknown[]) =>
    startVoiceSessionAction(...args) as unknown,
  readVoiceTurnAction: () =>
    Promise.resolve({ ok: false, gone: false, message: "" }),
  sendVoiceScreenAction: () => Promise.resolve({ ok: true }),
}));

// The transport stands in for a provider that fails as soon as it starts:
// one plain sentence, then the line reported dropped.
let events: VoiceSessionEvents = {};
/** The provider fails as soon as it starts, unless a test says not. */
let dropOnStart = true;
vi.mock("../src/features/voice/use-voice-session", () => ({
  useVoiceSession: (latest: VoiceSessionEvents) => {
    events = latest;
    return {
      state: "IDLE",
      connected: false,
      muted: false,
      transcript: [],
      start: () => {
        if (!dropOnStart) return Promise.resolve();
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

const { useVoiceInterview, withGreeting } =
  await import("../src/features/voice/use-voice-interview");

beforeEach(() => {
  turnRead = { ok: false, gone: false };
  dropOnStart = true;
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
  it("tries once after a first-word failure, then stops and says so (G-D21)", async () => {
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

    // The person's line, and one resume: never a chain of sessions.
    expect(startVoiceSessionAction).toHaveBeenCalledTimes(2);
    expect(result.current.active).toBe(false);
    expect(result.current.notice).toMatch(/couldn't get the line back/);
  });

  it("a line coming back is the same thread resumed: no second opening, no greeting", async () => {
    // The acceptance fixture: every reconnect composed and recorded
    // another "Welcome back. <question>" -- three for one arrival.
    const { result } = renderHook(() => useVoiceInterview());
    await act(async () => {
      await result.current.talk({ thread: { welcome: true } });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    const calls = startVoiceSessionAction.mock.calls.map(
      (call) => call[0] as { resume?: true },
    );
    expect(calls.length).toBeGreaterThanOrEqual(2);
    // The arrival opens; every retry resumes.
    expect(calls[0]?.resume).toBeUndefined();
    for (const retry of calls.slice(1)) {
      expect(retry.resume).toBe(true);
    }
  });
});

describe("a dropped line (bad network)", () => {
  it("keeps the error on screen while it reconnects, and resumes the same conversation", async () => {
    const conversationId = "7f000000-0000-4000-8000-000000000001";
    const { result } = renderHook(() => useVoiceInterview());
    await act(async () => {
      await result.current.talk({
        thread: { conversationId } as never,
      });
    });
    // The socket drops (the fake transport reports it at once).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    // The vendor error said is what shows, not a flicker of it (G: a
    // vendor error mid-turn must end visibly).
    expect(result.current.notice).toBe("Something went wrong with voice.");
    expect(result.current.active).toBe(true);
    // The first retry comes within the recovery window.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });
    expect(startVoiceSessionAction).toHaveBeenCalledTimes(2);
    expect(startVoiceSessionAction.mock.calls[1]?.[0]).toMatchObject({
      conversationId,
      resume: true,
    });
  });
});

describe("G-D21: nothing reopens a line the person did not start", () => {
  it("an automatic reopen with no line of the person's opens nothing", async () => {
    const { result } = renderHook(() => useVoiceInterview());
    await act(async () => {
      await result.current.talk({
        thread: {},
        resume: true,
        automatic: true,
      });
    });
    expect(startVoiceSessionAction).not.toHaveBeenCalled();
    expect(result.current.active).toBe(false);
  });

  it("after the person ends their line, a reopen still pending opens nothing", async () => {
    const { result } = renderHook(() => useVoiceInterview());
    await act(async () => {
      await result.current.talk({ thread: {} });
    });
    await act(async () => {
      await result.current.end();
    });
    startVoiceSessionAction.mockClear();
    await act(async () => {
      await result.current.talk({
        thread: {},
        resume: true,
        automatic: true,
      });
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(startVoiceSessionAction).not.toHaveBeenCalled();
  });
});

describe("G-D21: a line replaced by the person's newer one (another tab)", () => {
  it("stops, says where voice went, and never reopens", async () => {
    // A line that stays up: the transport does not drop by itself here.
    dropOnStart = false;
    const { result } = renderHook(() => useVoiceInterview());
    turnRead = { ok: false, gone: true, replaced: true };
    await act(async () => {
      await result.current.talk({ thread: {} });
    });
    startVoiceSessionAction.mockClear();
    for (let i = 0; i < 4; i += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
    }
    expect(startVoiceSessionAction).not.toHaveBeenCalled();
    expect(result.current.active).toBe(false);
    expect(result.current.notice).toMatch(/Voice moved to your other window/u);
  });
});

describe("withGreeting", () => {
  const credential = {
    voiceSessionId: "00000000-0000-4000-8000-000000000001",
    providerConversationId: "dg_1",
    token: "t",
    voice: "FEMALE" as const,
    expiresAt: "2026-09-24T22:00:00.000Z",
    provider: "deepgram" as const,
    deepgram: {
      agent: { language: "en", greeting: "Welcome back. Old line." },
      audio: {},
    },
  };

  it("says the line already on screen, and only that", () => {
    expect(
      withGreeting(credential, "What's a typical cheque for you?").deepgram
        ?.agent,
    ).toEqual({ language: "en", greeting: "What's a typical cheque for you?" });
  });

  it("with no line, Q waits for the person rather than greeting again", () => {
    expect(withGreeting(credential, undefined).deepgram?.agent).toEqual({
      language: "en",
    });
  });
});
