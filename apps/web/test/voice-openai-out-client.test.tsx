// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

/**
 * DECISIONS 68 on the client: while OpenAI's account is out the server
 * says GPT-Live is unavailable and issues an ElevenLabs line with no
 * duplex credential. The client then opens exactly that line -- no OpenAI
 * transport is tried -- with Q's own first words (the continuation or the
 * greeting), and End ends it. No live provider call: transports are fakes.
 */

const fake = (
  start: ReturnType<typeof vi.fn>,
  end: ReturnType<typeof vi.fn>,
) => ({
  state: "LISTENING" as const,
  connected: true,
  muted: false,
  transcript: [],
  start,
  end,
  sendText: () => undefined,
  setMuted: () => undefined,
  setVolume: () => undefined,
  inputLevel: () => 0,
  outputLevel: () => 0,
});
const elevenStart = vi.fn(() => Promise.resolve());
const elevenEnd = vi.fn(() => Promise.resolve());
const deepgramStart = vi.fn(() => Promise.resolve());
const duplexStart = vi.fn(() => Promise.resolve(false));
vi.mock("../src/features/voice/provider/elevenlabs-session", () => ({
  useElevenLabsVoiceSession: () => fake(elevenStart, elevenEnd),
}));
vi.mock("../src/features/voice/provider/deepgram-session", () => ({
  useDeepgramVoiceSession: () =>
    fake(
      deepgramStart,
      vi.fn(() => Promise.resolve()),
    ),
}));
vi.mock("../src/features/voice/provider/duplex-session", () => ({
  useDuplexVoiceSession: () =>
    fake(
      duplexStart,
      vi.fn(() => Promise.resolve()),
    ),
}));
const startLiveCall = vi.fn();
vi.mock("../src/features/voice/live/live-call", () => ({
  LiveCallUnavailable: class extends Error {},
  isLiveTrialSpent: () => false,
  LIVE_AVAILABLE_TIMEOUT_MS: 1_500,
  // The server's answer while OpenAI's account is out.
  askLiveVoice: () => Promise.resolve(false),
  startLiveCall,
}));

const { useVoiceSession } =
  await import("../src/features/voice/use-voice-session");
const { askLiveAvailability } =
  await import("../src/features/voice/live/availability");

describe("voice while OpenAI's account is out", () => {
  it("opens the ElevenLabs line with Q's own first words, tries no OpenAI line, and End ends it", async () => {
    const { result } = renderHook(() => useVoiceSession());
    await act(async () => {
      await askLiveAvailability();
    });
    const said =
      "You'd asked “Find me founders raising in fintech”, and I found five. Want me to go through them, or something else?";
    await act(async () => {
      await result.current.start({
        credential: {
          voiceSessionId: "00000000-0000-4000-8000-000000000001",
          voice: "FEMALE",
          provider: "elevenlabs",
          token: "el_token",
        },
        firstMessage: said,
      } as never);
    });
    expect(startLiveCall).not.toHaveBeenCalled();
    expect(duplexStart).not.toHaveBeenCalled();
    expect(deepgramStart).not.toHaveBeenCalled();
    expect(elevenStart).toHaveBeenCalledTimes(1);
    expect(
      (elevenStart.mock.calls[0] as unknown as [{ firstMessage?: string }])[0]
        .firstMessage,
    ).toBe(said);
    await act(async () => {
      await result.current.end();
    });
    expect(elevenEnd).toHaveBeenCalled();
  });
});
