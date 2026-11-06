// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

/**
 * Owner 2026-11-06 (live): End -- the person's, or Chat's -- reaches the
 * transports at once, even while the line is still being opened. It used
 * to wait for the open to finish, and a duplex line stuck connecting kept
 * the microphone live after the person had left Q.
 */

const startVoiceSessionAction = vi.fn(() =>
  Promise.resolve({
    ok: true,
    value: {
      voiceSessionId: "00000000-0000-4000-8000-000000000001",
      voice: "FEMALE",
      provider: "deepgram",
      token: "t",
      duplex: {},
    },
  }),
);
vi.mock("../src/features/voice/provider/duplex-relays", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  readVoiceTurn: () => Promise.resolve({ ok: false, gone: false }),
  sendVoiceScreen: () => Promise.resolve(),
}));
vi.mock("../src/features/voice/actions", () => ({
  startVoiceSessionAction: () => startVoiceSessionAction(),
  readVoiceTurnAction: () =>
    Promise.resolve({ ok: false, gone: false, message: "" }),
  sendVoiceScreenAction: () => Promise.resolve({ ok: true }),
}));

let starting = false;
const clientEnd = vi.fn(() => Promise.resolve());
vi.mock("../src/features/voice/use-voice-session", () => ({
  useVoiceSession: () => ({
    state: "CONNECTING",
    connected: false,
    muted: false,
    transcript: [],
    // The transport is stuck connecting: its start never settles.
    start: () => {
      starting = true;
      return new Promise<void>(() => undefined);
    },
    end: clientEnd,
    sendText: () => undefined,
    setMuted: () => undefined,
    setVolume: () => undefined,
    inputLevel: () => 0,
    outputLevel: () => 0,
  }),
}));

const { useVoiceInterview } =
  await import("../src/features/voice/use-voice-interview");

describe("End while the line is still opening", () => {
  it("reaches the transport at once, without waiting for the open", async () => {
    const { result } = renderHook(() => useVoiceInterview());
    act(() => {
      void result.current.talk({ thread: {} });
    });
    // The server answered and the transport is connecting.
    await act(async () => {
      for (let i = 0; i < 10 && !starting; i += 1) await Promise.resolve();
    });
    expect(starting).toBe(true);
    expect(clientEnd).not.toHaveBeenCalled();
    act(() => {
      void result.current.end("user");
    });
    expect(clientEnd).toHaveBeenCalledWith("user");
  });
});
