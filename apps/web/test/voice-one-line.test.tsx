// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  VoiceSessionEvents,
  VoiceSessionStart,
} from "../src/features/voice/session";

/**
 * One voice line per tab (founder live 2026-10-05, Mai Soli, 10:30-10:32).
 *
 * Within two minutes one tab held four lines: the welcome's duplex line
 * (fd3e05a0), the interview's duplex line (bcb12877), its standard
 * fallback (3b3c26e1), and a second standard line (f5d0366f) opened while
 * 3b3c26e1 was still polling `/turn`. Every line heard the microphone, so
 * Q answered itself and cut itself off. These replay that sequence against
 * the real `useVoiceInterview` and assert at most one line is ever live,
 * that the previous one is ended (and its polling stopped) first, and that
 * Q speaks first on every line that opens.
 */

const IDS = {
  welcome: "fd3e05a0-9caf-42e6-bfaa-6aca151d370b",
  interview: "bcb12877-775a-4eb4-97bb-a623791c4fc0",
  fallback: "3b3c26e1-a587-4af1-84b2-cd3c8a4b3051",
  again: "f5d0366f-4eb0-4c96-ae06-306dd6212de7",
} as const;

const startVoiceSessionAction = vi.fn();
const polled: string[] = [];
vi.mock("../src/features/voice/actions", () => ({
  startVoiceSessionAction: (...args: unknown[]) =>
    startVoiceSessionAction(...args) as unknown,
  readVoiceTurnAction: (id: string) => {
    polled.push(id);
    return Promise.resolve({ ok: false, gone: false, message: "" });
  },
  sendVoiceScreenAction: () => Promise.resolve({ ok: true }),
}));

/** Every line the transports hold, across every surface in the tab. */
const live = new Set<string>();
let mostLive = 0;
const starts: VoiceSessionStart[] = [];
const ends: string[] = [];
let lastEvents: VoiceSessionEvents = {};

vi.mock("../src/features/voice/use-voice-session", () => ({
  useVoiceSession: (latest: VoiceSessionEvents) => {
    lastEvents = latest;
    // One transport per surface, as the real hook is.
    const line = useRef<string | null>(null);
    return {
      state: "LISTENING",
      connected: true,
      muted: false,
      transcript: [],
      start: (input: VoiceSessionStart) => {
        starts.push(input);
        line.current = input.credential.voiceSessionId;
        live.add(input.credential.voiceSessionId);
        mostLive = Math.max(mostLive, live.size);
        return Promise.resolve();
      },
      end: async () => {
        await Promise.resolve();
        if (line.current !== null) {
          ends.push(line.current);
          live.delete(line.current);
          line.current = null;
        }
      },
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
const { voiceLineHolder } = await import("../src/features/voice/voice-line");

function issue(id: string, extra: Record<string, unknown> = {}) {
  return {
    ok: true,
    value: {
      voiceSessionId: id,
      voice: "FEMALE",
      provider: "deepgram",
      token: "t",
      deepgram: { agent: { greeting: "Hi, I'm Q." } },
      ...extra,
    },
  };
}

const ONBOARDING = {
  onboarding: {
    sessionId: "6f000000-0000-4000-8000-000000000001",
    journeyType: "founder" as const,
  },
};
const QUESTION = "What is your company called?";

/** Lets every queued open and end run to completion. */
async function settle() {
  for (let index = 0; index < 20; index += 1) {
    await Promise.resolve();
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  live.clear();
  mostLive = 0;
  starts.length = 0;
  ends.length = 0;
  polled.length = 0;
  startVoiceSessionAction.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("one voice line per tab", () => {
  it("replays 10:30-10:32 with at most one live line, Q speaking first on each", async () => {
    startVoiceSessionAction
      .mockResolvedValueOnce(
        issue(IDS.welcome, {
          firstMessage: "Hi, I'm Q. Raising or investing?",
        }),
      )
      .mockResolvedValueOnce(issue(IDS.interview, { duplex: {} }))
      .mockResolvedValueOnce(issue(IDS.fallback))
      .mockResolvedValueOnce(issue(IDS.again));

    // 10:30:12 -- Q's first minute opens its line on the welcome screen.
    const welcome = renderHook(() => useVoiceInterview());
    await act(async () => {
      await welcome.result.current.talk({ thread: { welcome: true } });
    });
    expect([...live]).toEqual([IDS.welcome]);
    expect(starts[0]?.firstMessage).toBe("Hi, I'm Q. Raising or investing?");

    // 10:31:20 -- the interview opens on the next screen before the
    // welcome's end has landed: its line is ended first, and awaited.
    const interview = renderHook(() => useVoiceInterview());
    const interviewEvents = lastEvents;
    await act(async () => {
      await interview.result.current.talk({
        thread: ONBOARDING,
        resume: true,
        firstMessage: QUESTION,
        lead: () => QUESTION,
      });
    });
    expect(ends).toEqual([IDS.welcome]);
    expect([...live]).toEqual([IDS.interview]);
    expect(welcome.result.current.active).toBe(false);
    expect(interview.result.current.active).toBe(true);
    // Resumed: Q asks the question on screen, no second welcome.
    expect(starts[1]?.firstMessage).toBe(QUESTION);
    expect(starts[1]?.credential.deepgram?.agent.greeting).toBe(QUESTION);

    // 10:31:33 -- the duplex line falls back after 13 s: exactly one
    // standard line, on the same thread, and Q asks again at once.
    await act(async () => {
      interviewEvents.onFallback?.(null, "CONNECT");
      await settle();
    });
    // A second report from the same failed line opens nothing more.
    await act(async () => {
      interviewEvents.onFallback?.(null, "NETWORK");
      await settle();
    });
    expect(startVoiceSessionAction).toHaveBeenCalledTimes(3);
    expect(startVoiceSessionAction.mock.calls[2]?.[0]).toMatchObject({
      ...ONBOARDING,
      resume: true,
      duplex: false,
    });
    expect([...live]).toEqual([IDS.fallback]);
    expect(starts[2]?.firstMessage).toBe(QUESTION);
    expect(starts[2]?.credential.deepgram?.agent.greeting).toBe(QUESTION);

    // 10:32:16 -- something asks for the line again while 3b3c26e1 is
    // up and polling: that line is ended and its polling stopped first.
    await act(async () => {
      await interview.result.current.talk({ thread: ONBOARDING, resume: true });
    });
    expect([...live]).toEqual([IDS.again]);
    expect(ends).toEqual([IDS.welcome, IDS.interview, IDS.fallback]);

    polled.length = 0;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(polled.length).toBeGreaterThan(0);
    expect(new Set(polled)).toEqual(new Set([IDS.again]));

    expect(mostLive).toBe(1);
  });

  it("two surfaces asking at the same moment still get one line", async () => {
    startVoiceSessionAction
      .mockResolvedValueOnce(issue(IDS.welcome))
      .mockResolvedValueOnce(issue(IDS.interview));
    const one = renderHook(() => useVoiceInterview());
    const two = renderHook(() => useVoiceInterview());
    await act(async () => {
      await Promise.all([
        one.result.current.talk({ thread: { welcome: true } }),
        two.result.current.talk({ thread: ONBOARDING }),
      ]);
    });
    expect(mostLive).toBe(1);
    expect([...live]).toEqual([IDS.interview]);
    expect(one.result.current.active).toBe(false);
    expect(two.result.current.active).toBe(true);
  });

  it("an End pressed while the line is still being issued never brings it up", async () => {
    let issueNow: (value: unknown) => void = () => undefined;
    startVoiceSessionAction.mockReturnValueOnce(
      new Promise((resolve) => {
        issueNow = resolve;
      }),
    );
    const surface = renderHook(() => useVoiceInterview());
    let talking: Promise<void> = Promise.resolve();
    act(() => {
      talking = surface.result.current.talk({ thread: ONBOARDING });
    });
    let ending: Promise<void> = Promise.resolve();
    act(() => {
      ending = surface.result.current.end();
    });
    await act(async () => {
      issueNow(issue(IDS.interview));
      await talking;
      await ending;
    });
    expect(live.size).toBe(0);
    expect(starts).toHaveLength(0);
    expect(surface.result.current.active).toBe(false);
    expect(voiceLineHolder()).toBeNull();
  });

  it("a reconnect scheduled before End, or before the surface went away, opens nothing", async () => {
    startVoiceSessionAction.mockResolvedValue(issue(IDS.interview));
    const surface = renderHook(() => useVoiceInterview());
    const events = lastEvents;
    await act(async () => {
      await surface.result.current.talk({ thread: ONBOARDING });
    });
    act(() => {
      events.onEnded?.("dropped");
    });
    await act(async () => {
      await surface.result.current.end();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(startVoiceSessionAction).toHaveBeenCalledTimes(1);

    await act(async () => {
      await surface.result.current.talk({ thread: ONBOARDING });
    });
    act(() => {
      events.onEnded?.("dropped");
    });
    surface.unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(startVoiceSessionAction).toHaveBeenCalledTimes(2);
  });

  it("a reconnect asks the question at once, without a greeting", async () => {
    startVoiceSessionAction.mockResolvedValue(issue(IDS.interview));
    const surface = renderHook(() => useVoiceInterview());
    const events = lastEvents;
    await act(async () => {
      await surface.result.current.talk({
        thread: ONBOARDING,
        firstMessage: QUESTION,
        lead: () => "Which stage are you at?",
      });
    });
    act(() => {
      events.onEnded?.("dropped");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
      await settle();
    });
    expect(startVoiceSessionAction).toHaveBeenCalledTimes(2);
    expect(startVoiceSessionAction.mock.calls[1]?.[0]).toMatchObject({
      resume: true,
    });
    expect(starts[1]?.firstMessage).toBe("Which stage are you at?");
    expect(starts[1]?.credential.deepgram?.agent.greeting).toBe(
      "Which stage are you at?",
    );
    expect(mostLive).toBe(1);
  });
});
