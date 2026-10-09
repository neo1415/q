// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * V (founder 2026-10-09): GPT-Live is the product voice for the people the
 * Q API allows. Every voice start asks the server; when it says yes the
 * call opens on GPT-Live, attached to the session the Q API just issued;
 * when GPT-Live cannot open, the standard line takes the same credential
 * at once and the person is told in one line. The WebRTC call is faked at
 * its boundary (`startLiveCall`); no network, no provider.
 */

const standardStart = vi.fn(() => Promise.resolve());
const fake = () => ({
  state: "LISTENING" as const,
  connected: true,
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

let available = true;
let opens = true;
const calls: Record<string, unknown>[] = [];
const typed: string[] = [];
vi.mock("../src/features/voice/live/live-call", () => ({
  liveVoiceAvailable: () => Promise.resolve(available),
  startLiveCall: (options: Record<string, unknown>) => {
    calls.push(options);
    if (!opens) return Promise.reject(new Error("live voice unavailable"));
    return Promise.resolve({
      voiceSessionId: "5f000000-0000-4000-8000-000000000001",
      end: () => Promise.resolve(),
      typed: (text: string) => {
        typed.push(text);
      },
      setMuted: () => undefined,
      setVolume: () => undefined,
      inputLevel: () => 0,
      outputLevel: () => 0,
    });
  },
}));

const { useVoiceSession } =
  await import("../src/features/voice/use-voice-session");
const { LIVE_FALLBACK_NOTICE } =
  await import("../src/features/voice/provider/live-session");

const credential = {
  voiceSessionId: "5f000000-0000-4000-8000-000000000001",
  providerConversationId: "dg_5f000000",
  token: "standard-token",
  voice: "FEMALE" as const,
  expiresAt: "2026-10-09T12:00:00.000Z",
  sessionToken: "sealed-session",
  firstMessage: "Nineteen things need your eyes. Spheros is waiting.",
  provider: "deepgram" as const,
};

describe("GPT-Live as the product voice", () => {
  beforeEach(() => {
    available = true;
    opens = true;
    calls.length = 0;
    typed.length = 0;
    standardStart.mockClear();
  });

  it("opens every voice start on GPT-Live, attached to the issued session", async () => {
    const { result } = renderHook(() => useVoiceSession());
    await act(async () => {
      await result.current.start({ credential });
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      voice: "FEMALE",
      attach: {
        voiceSessionId: credential.voiceSessionId,
        sessionToken: "sealed-session",
      },
      fastNavigation: true,
    });
    expect(
      (calls[0]?.["opening"] as { content?: string } | undefined)?.content,
    ).toBe(credential.firstMessage);
    expect(standardStart).not.toHaveBeenCalled();
    expect(result.current.connected).toBe(true);
    // Typed words while the call is open go to Q Brain through the call.
    act(() => {
      result.current.sendText("Open Ajopot");
    });
    expect(typed).toEqual(["Open Ajopot"]);
  });

  it("falls back to the standard line with one line of notice when GPT-Live cannot open", async () => {
    opens = false;
    const statuses: (string | null)[] = [];
    const { result } = renderHook(() =>
      useVoiceSession({
        onLinkStatus: (status) => {
          statuses.push(status);
        },
      }),
    );
    await act(async () => {
      await result.current.start({ credential });
    });
    expect(calls).toHaveLength(1);
    expect(standardStart).toHaveBeenCalledTimes(1);
    expect(statuses).toEqual([LIVE_FALLBACK_NOTICE]);
  });

  it("uses the standard line, silently, for someone GPT-Live is not on for", async () => {
    available = false;
    const { result } = renderHook(() => useVoiceSession());
    await act(async () => {
      await result.current.start({ credential });
    });
    expect(calls).toHaveLength(0);
    expect(standardStart).toHaveBeenCalledTimes(1);
  });

  it("never opens GPT-Live where a surface opts out (a rehearsal)", async () => {
    const { result } = renderHook(() => useVoiceSession({}, { live: false }));
    await act(async () => {
      await result.current.start({ credential });
    });
    expect(calls).toHaveLength(0);
    expect(standardStart).toHaveBeenCalledTimes(1);
  });
});
