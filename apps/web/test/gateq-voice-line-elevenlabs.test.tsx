// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  VoiceSessionEvents,
  VoiceState,
} from "../src/features/voice/session";

/**
 * Owner directive 2026-11-14: the GateQ voice line runs on Q's own
 * ElevenLabs voice session (the same transport adapter Q's signed-in line
 * uses), opened with the one-conversation token the GateQ API issued and
 * Q's server-composed opening. The SDK itself is a double: real WebRTC
 * and audio are not testable here.
 */

const session = {
  state: "IDLE" as VoiceState,
  muted: false,
  transcript: [] as { id: string; role: "user" | "q"; text: string }[],
  events: {} as VoiceSessionEvents,
  open: vi.fn<(token: string, firstMessage?: string) => Promise<void>>(),
  end: vi.fn(() => Promise.resolve()),
  setMuted: vi.fn(),
};

vi.mock("../src/features/voice/provider/elevenlabs-session", () => ({
  ELEVENLABS_PLAIN_ERRORS: {
    microphone: "mic",
    connection: "conn",
    generic: "generic",
  },
  useElevenLabsSpeechLine: (events: VoiceSessionEvents) => {
    session.events = events;
    return {
      open: session.open,
      client: {
        state: session.state,
        connected: session.state !== "IDLE",
        muted: session.muted,
        transcript: session.transcript.map((line) => ({
          ...line,
          partial: false,
          at: 0,
        })),
        start: vi.fn(),
        end: session.end,
        sendText: vi.fn(),
        setMuted: session.setMuted,
        setVolume: vi.fn(),
        inputLevel: () => 0,
        outputLevel: () => 0,
      },
    };
  },
}));

// The Deepgram fallback's transport must not load for an ElevenLabs line.
vi.mock("@deepgram/agents", () => {
  throw new Error("the Deepgram transport loaded for an ElevenLabs line");
});

const { useGateqVoiceLine } =
  await import("../src/features/voice/provider/gateq-voice-line");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  session.state = "IDLE";
  session.transcript = [];
});

describe("the GateQ voice line on Q's ElevenLabs voice", () => {
  it("opens with the issued token and Q's opening; captions, state and mute come from the session", async () => {
    session.open.mockImplementation(() => {
      session.state = "LISTENING";
      return Promise.resolve();
    });
    const onProblem = vi.fn();
    const { result, rerender } = renderHook(() =>
      useGateqVoiceLine({ onProblem }),
    );
    let up = false;
    await act(async () => {
      up = await result.current.start({
        provider: "elevenlabs",
        token: "webrtc-token",
        firstMessage: "What does the company do?",
      });
    });
    expect(up).toBe(true);
    expect(session.open).toHaveBeenCalledWith(
      "webrtc-token",
      "What does the company do?",
    );
    session.transcript = [
      { id: "1", role: "q", text: "What does the company do?" },
      { id: "2", role: "user", text: "Payroll for clinics." },
    ];
    session.state = "Q_SPEAKING";
    rerender();
    expect(result.current.state).toBe("Q_SPEAKING");
    expect(result.current.captions).toEqual([
      { id: "1", from: "Q", text: "What does the company do?" },
      { id: "2", from: "YOU", text: "Payroll for clinics." },
    ]);
    // The person talks over Q: the session reports it, the line listens.
    session.state = "INTERRUPTED";
    rerender();
    expect(result.current.state).toBe("LISTENING");
    act(() => {
      result.current.setMuted(true);
    });
    expect(session.setMuted).toHaveBeenCalledWith(true);
    act(() => {
      result.current.stop();
    });
    expect(session.end).toHaveBeenCalledTimes(1);
    expect(onProblem).not.toHaveBeenCalled();
  });

  it("a denied microphone or a dropped line is reported in plain words, and start says it failed", async () => {
    session.open.mockImplementation(() => {
      session.state = "ERROR";
      session.events.onError?.("mic");
      return Promise.resolve();
    });
    const onProblem = vi.fn();
    const { result, rerender } = renderHook(() =>
      useGateqVoiceLine({ onProblem }),
    );
    let up = true;
    await act(async () => {
      up = await result.current.start({
        provider: "elevenlabs",
        token: "webrtc-token",
        firstMessage: "Hello.",
      });
    });
    rerender();
    expect(up).toBe(false);
    expect(onProblem).toHaveBeenCalledWith("microphone");
    expect(result.current.state).toBe("FAILED");
    act(() => {
      session.events.onError?.("conn");
    });
    expect(onProblem).toHaveBeenLastCalledWith("connection");
  });
});
