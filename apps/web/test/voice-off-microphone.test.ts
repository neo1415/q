// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Owner 2026-11-06: voice off means the microphone is released -- every
 * MediaStreamTrack stopped, so the browser's microphone light goes off.
 * The duplex line's own close is covered in voice-duplex.test.tsx (its
 * track.stop assertions); this covers the permission probe, which used to
 * leave its stream open, and the wake path choosing the voice view.
 */

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("the microphone probe", () => {
  it("stops every track it opened", async () => {
    const tracks = [{ stop: vi.fn() }, { stop: vi.fn() }];
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: vi.fn(() => Promise.resolve({ getTracks: () => tracks })),
      },
    });
    const { probeMicrophone } =
      await import("../src/features/voice/provider/elevenlabs-session");
    await probeMicrophone();
    for (const track of tracks) expect(track.stop).toHaveBeenCalledTimes(1);
  });
});

describe("a wake shows the voice view first", () => {
  it("chooses Q, so Chat never ends the line it opens", async () => {
    localStorage.setItem("cq.q.view", "chat");
    const { showQVoiceView, readStageView } =
      await import("../src/features/q/stage-view");
    showQVoiceView();
    expect(readStageView()).toBe("presence");
  });
});
