// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CreateQVoiceSessionResponse } from "@capital-q/contracts";

/**
 * The standard voice never sits in a dead "listening" (founder: "it can't
 * even hear me talk"). With a fake microphone, socket and player: a
 * capture that stops delivering frames (its track ended, the device went
 * away) is re-acquired on the same line within a few seconds; a muted one
 * is left alone; a device change re-acquires at once; a socket that fails
 * to open is reported as a drop, so the interview reconnects.
 */

type Handler = (payload: unknown) => void;

class FakeSession {
  static last: FakeSession | null = null;
  static refuse = false;
  readonly handlers = new Map<string, Handler[]>();
  open = true;
  constructor() {
    FakeSession.last = this;
  }
  on(event: string, handler: Handler) {
    const list = this.handlers.get(event) ?? [];
    list.push(handler);
    this.handlers.set(event, list);
  }
  emit(event: string, payload: unknown = {}) {
    for (const handler of this.handlers.get(event) ?? []) handler(payload);
  }
  connect() {
    return FakeSession.refuse
      ? Promise.reject(new Error("refused"))
      : Promise.resolve();
  }
  disconnect() {
    this.open = false;
  }
  sendAudio() {
    return undefined;
  }
  injectUserMessage() {
    return undefined;
  }
}

class FakeMicrophone {
  static last: FakeMicrophone | null = null;
  muted = false;
  starts = 0;
  stops = 0;
  readonly deliver: (frame: ArrayBuffer) => void;
  constructor(onFrame: (frame: ArrayBuffer) => void) {
    this.deliver = onFrame;
    FakeMicrophone.last = this;
  }
  start() {
    this.starts += 1;
    return Promise.resolve();
  }
  stop() {
    this.stops += 1;
  }
  mute() {
    this.muted = true;
  }
  unmute() {
    this.muted = false;
  }
  getInputVolume() {
    return 0;
  }
}

class FakePlayer {
  static last: FakePlayer | null = null;
  constructor() {
    FakePlayer.last = this;
  }
  queue() {
    return undefined;
  }
  interrupt() {
    return undefined;
  }
  getRemainingPlaybackTime() {
    return 0;
  }
  flush() {
    return undefined;
  }
  get stats() {
    return { underruns: 0, gapMs: 0, blocks: 0, frames: 0, prebufferMs: 0 };
  }
  getOutputVolume() {
    return 0;
  }
  setVolume() {
    return undefined;
  }
  dispose() {
    return undefined;
  }
}

vi.mock("@deepgram/agents", () => ({
  AgentMicrophone: FakeMicrophone,
}));
vi.mock("../src/features/voice/provider/agent-socket", () => ({
  AgentSocket: FakeSession,
}));
vi.mock("../src/features/voice/provider/pcm-player", () => ({
  PcmPlayer: FakePlayer,
}));

const { useDeepgramVoiceSession, MIC_SILENT_MS } =
  await import("../src/features/voice/provider/deepgram-session");

const CREDENTIAL = {
  voiceSessionId: "00000000-0000-4000-8000-000000000001",
  voice: "FEMALE",
  provider: "deepgram",
  token: "t",
  deepgram: { agent: {}, audio: {} },
} as unknown as CreateQVoiceSessionResponse;

const devices = new EventTarget();

async function started() {
  const onEnded = vi.fn();
  const onError = vi.fn();
  const hook = renderHook(() => useDeepgramVoiceSession({ onEnded, onError }));
  await act(async () => {
    await hook.result.current.start({ credential: CREDENTIAL });
  });
  const microphone = FakeMicrophone.last;
  const session = FakeSession.last;
  if (microphone === null || session === null) throw new Error("not started");
  act(() => {
    session.emit("connected");
    session.emit("settings-applied");
  });
  return { hook, microphone, session, onEnded, onError };
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeSession.refuse = false;
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: devices,
  });
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("the microphone on the standard voice", () => {
  it("is re-acquired on the same line when it stops delivering audio", async () => {
    const h = await started();
    // Frames flow, then stop (the track ended).
    act(() => {
      h.microphone.deliver(new ArrayBuffer(8));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(MIC_SILENT_MS + 600);
    });
    expect(h.microphone.stops).toBe(1);
    expect(h.microphone.starts).toBe(2);
    expect(h.onEnded).not.toHaveBeenCalled();
    expect(h.hook.result.current.connected).toBe(true);
    await act(async () => {
      await h.hook.result.current.end();
    });
  });

  it("leaves a muted microphone alone", async () => {
    const h = await started();
    act(() => {
      h.hook.result.current.setMuted(true);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(MIC_SILENT_MS * 3);
    });
    expect(h.microphone.starts).toBe(1);
    await act(async () => {
      await h.hook.result.current.end();
    });
  });

  it("takes the new device when one is plugged in or out", async () => {
    const h = await started();
    await act(async () => {
      devices.dispatchEvent(new Event("devicechange"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(h.microphone.starts).toBe(2);
    await act(async () => {
      await h.hook.result.current.end();
    });
  });

  it("reports a socket that will not open as a drop, so the line is reconnected", async () => {
    FakeSession.refuse = true;
    const h = await started();
    expect(h.onEnded).toHaveBeenCalledWith("dropped");
    expect(h.hook.result.current.state).toBe("ERROR");
  });
});
