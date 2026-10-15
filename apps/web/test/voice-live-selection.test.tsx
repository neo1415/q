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
const duplexStart = vi.fn(() => Promise.resolve(false));
vi.mock("../src/features/voice/provider/duplex-session", () => ({
  useDuplexVoiceSession: () => ({ ...fake(), start: duplexStart }),
}));

let available = true;
let opens = true;
let quota = false;
let neverAnswers = false;
class LiveCallUnavailable extends Error {
  readonly status: number | null;
  constructor(status: number | null) {
    super("live voice unavailable");
    this.status = status;
  }
}
const calls: Record<string, unknown>[] = [];
const typed: string[] = [];
let slowAnswer: Promise<boolean> | null = null;
vi.mock("../src/features/voice/live/live-call", () => ({
  LiveCallUnavailable,
  LIVE_AVAILABLE_TIMEOUT_MS: 1_500,
  askLiveVoice: () =>
    neverAnswers
      ? new Promise<boolean>(() => undefined)
      : (slowAnswer ?? Promise.resolve(available)),
  startLiveCall: (options: Record<string, unknown>) => {
    calls.push(options);
    if (quota) return Promise.reject(new LiveCallUnavailable(429));
    if (!opens) return Promise.reject(new LiveCallUnavailable(503));
    return Promise.resolve({
      voiceSessionId: "5f000000-0000-4000-8000-000000000001",
      end: () => Promise.resolve(),
      finished: Promise.resolve(),
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
const { askLiveAvailability, forgetLiveAvailability } =
  await import("../src/features/voice/live/availability");
/** The availability answer is in (it is asked as the surface mounts). */
const ready = () =>
  act(async () => {
    await askLiveAvailability();
  });
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

// A credential that also carries a brokered duplex line.
const withDuplex = {
  ...credential,
  duplex: {
    clientSecret: "ek_fake",
    callsUrl: "https://realtime.invalid/v1/realtime/calls",
    expiresAt: "2026-10-09T12:00:00.000Z",
    maxSessionMs: 600_000,
    idleMs: 30_000,
  },
};

describe("GPT-Live as the product voice", () => {
  beforeEach(() => {
    forgetLiveAvailability();
    available = true;
    opens = true;
    quota = false;
    neverAnswers = false;
    slowAnswer = null;
    duplexStart.mockClear();
    calls.length = 0;
    typed.length = 0;
    standardStart.mockClear();
  });

  it("opens every voice start on GPT-Live, attached to the issued session", async () => {
    const { result } = renderHook(() => useVoiceSession());
    await ready();
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
    await ready();
    await act(async () => {
      await result.current.start({ credential });
    });
    expect(calls).toHaveLength(1);
    expect(standardStart).toHaveBeenCalledTimes(1);
    expect(statuses).toEqual([LIVE_FALLBACK_NOTICE]);
  });

  it("tries the duplex line after an ordinary GPT-Live failure", async () => {
    opens = false;
    const { result } = renderHook(() => useVoiceSession());
    await ready();
    await act(async () => {
      await result.current.start({ credential: withDuplex });
    });
    expect(duplexStart).toHaveBeenCalledTimes(1);
    expect(standardStart).toHaveBeenCalledTimes(1);
  });

  it("skips the duplex line when OpenAI is out of quota, straight to the standard voice", async () => {
    quota = true;
    const statuses: (string | null)[] = [];
    const { result } = renderHook(() =>
      useVoiceSession({
        onLinkStatus: (status) => {
          statuses.push(status);
        },
      }),
    );
    await ready();
    await act(async () => {
      await result.current.start({ credential: withDuplex });
    });
    expect(calls).toHaveLength(1);
    expect(duplexStart).not.toHaveBeenCalled();
    expect(standardStart).toHaveBeenCalledTimes(1);
    expect(statuses).toEqual([LIVE_FALLBACK_NOTICE]);
  });

  it("GPT-Live not available: the duplex line opens at once, with no notice", async () => {
    available = false;
    const statuses: (string | null)[] = [];
    const { result } = renderHook(() =>
      useVoiceSession({
        onLinkStatus: (status) => {
          statuses.push(status);
        },
      }),
    );
    await ready();
    await act(async () => {
      await result.current.start({ credential: withDuplex });
    });
    expect(calls).toHaveLength(0);
    expect(duplexStart).toHaveBeenCalledTimes(1);
    expect(statuses).toEqual([]);
  });

  it("an answer that comes later than the bound is kept for the tab, never cached as 'no' (gpt-live.spec start failures)", async () => {
    vi.useFakeTimers();
    let land: (value: boolean) => void = () => undefined;
    slowAnswer = new Promise<boolean>((resolve) => {
      land = resolve;
    });
    const { result } = renderHook(() => useVoiceSession());
    // The first start waits at most the bound, then opens the existing line.
    await act(async () => {
      const starting = result.current.start({ credential: withDuplex });
      await vi.advanceTimersByTimeAsync(1_500);
      await starting;
    });
    expect(calls).toHaveLength(0);
    expect(duplexStart).toHaveBeenCalledTimes(1);
    // The Q API's yes lands at 3 s (as under load on the stack: 1.7-4.1 s).
    await act(async () => {
      land(true);
      await vi.advanceTimersByTimeAsync(1_500);
    });
    vi.useRealTimers();
    // Before the fix this tab stayed on the duplex line for good.
    await act(async () => {
      await result.current.start({ credential: withDuplex });
    });
    expect(calls).toHaveLength(1);
  });

  it("an answer still on its way inside the bound is waited for: the start opens GPT-Live", async () => {
    vi.useFakeTimers();
    let land: (value: boolean) => void = () => undefined;
    slowAnswer = new Promise<boolean>((resolve) => {
      land = resolve;
    });
    const { result } = renderHook(() => useVoiceSession());
    await act(async () => {
      const starting = result.current.start({ credential: withDuplex });
      await vi.advanceTimersByTimeAsync(800);
      land(true);
      await vi.advanceTimersByTimeAsync(10);
      await starting;
    });
    vi.useRealTimers();
    expect(calls).toHaveLength(1);
    expect(duplexStart).toHaveBeenCalledTimes(0);
  });

  it("a start before the availability answer is in opens the existing line within the bound (2026-10-09 regression)", async () => {
    neverAnswers = true;
    const statuses: (string | null)[] = [];
    const { result } = renderHook(() =>
      useVoiceSession({
        onLinkStatus: (status) => {
          statuses.push(status);
        },
      }),
    );
    await act(async () => {
      await result.current.start({ credential: withDuplex });
    });
    expect(calls).toHaveLength(0);
    expect(duplexStart).toHaveBeenCalledTimes(1);
    expect(statuses).toEqual([]);
  });

  it("uses the standard line, silently, for someone GPT-Live is not on for", async () => {
    available = false;
    const { result } = renderHook(() => useVoiceSession());
    await ready();
    await act(async () => {
      await result.current.start({ credential });
    });
    expect(calls).toHaveLength(0);
    expect(standardStart).toHaveBeenCalledTimes(1);
  });

  it("never opens GPT-Live where a surface opts out (a rehearsal)", async () => {
    const { result } = renderHook(() => useVoiceSession({}, { live: false }));
    await ready();
    await act(async () => {
      await result.current.start({ credential });
    });
    expect(calls).toHaveLength(0);
    expect(standardStart).toHaveBeenCalledTimes(1);
  });
});
