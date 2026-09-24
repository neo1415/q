// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Q speaking the first minute (Q-FIRST-RUN-TTS-001; QX-002 §A1-§A4).
 *
 * The introduction is on the screen either way; what these hold is that
 * speech never becomes a condition of getting past it. A browser that
 * refuses to start audio, a provider that refuses to synthesise, and a
 * person who would rather have silence all end in the same place: the
 * words readable and Start reachable.
 *
 * The microphone is asserted about directly. Hearing Q must never ask for
 * one, and "we did not mean to" is not a property — this is.
 */

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

// The two-way interview is a different capability with its own tests; it
// is stubbed to "not running" so this is only about one-way speech.
vi.mock("../src/features/voice/use-voice-interview", () => ({
  useVoiceInterview: () => ({
    active: false,
    notice: null,
    turn: null,
    client: {},
    voice: "FEMALE",
    talk: vi.fn(),
    end: vi.fn(),
    chooseVoice: vi.fn(),
    clearNotice: vi.fn(),
  }),
}));
vi.mock("../src/features/voice/use-follow-turn", () => ({
  useFollowTurn: () => undefined,
}));

const { WelcomeScreen } =
  await import("../src/features/welcome/welcome-screen");

let play: ReturnType<typeof vi.fn>;
let micCalls: number;

function audioResponse(): Response {
  return new Response(new Uint8Array([0xff, 0xfb, 0x90, 0x00]), {
    status: 200,
    headers: { "content-type": "audio/mpeg" },
  });
}

beforeEach(() => {
  micCalls = 0;
  window.localStorage.clear();
  play = vi.fn(() => Promise.resolve());
  // jsdom has no media pipeline; the element is stood in for so the
  // decision this component makes — play, or offer to — is observable.
  vi.spyOn(window.HTMLMediaElement.prototype, "play").mockImplementation(
    play as unknown as () => Promise<void>,
  );
  // jsdom implements neither; without this the run prints "Not
  // implemented" for every teardown, which reads like a failure.
  vi.spyOn(window.HTMLMediaElement.prototype, "pause").mockImplementation(
    () => undefined,
  );
  URL.createObjectURL = vi.fn(() => "blob:speech");
  URL.revokeObjectURL = vi.fn();
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: () => {
        micCalls += 1;
        return Promise.reject(new Error("no microphone in a test"));
      },
    },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(audioResponse())),
  );
  // jsdom has no matchMedia; Q's presence reads reduced motion and its
  // own size from it. Full motion and a desktop width, as a browser would.
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    })),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Q-FIRST-RUN-TTS-001 · arriving for the first time", () => {
  it("says the introduction aloud without asking for a microphone", async () => {
    render(<WelcomeScreen knownName="Ada" />);

    // The words are there before any of this resolves.
    expect(screen.getByText("Hi Ada, I'm Q.")).toBeTruthy();
    await waitFor(() => {
      expect(play).toHaveBeenCalled();
    });

    const request = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>)
      .mock.calls[0] as [string, RequestInit];
    expect(request[0]).toBe("/api/q-speech");
    const body: unknown = request[1].body;
    expect(typeof body === "string" ? body : "").toContain("Hi Ada");
    expect(micCalls).toBe(0);
  });

  it("offers to play when the browser will not start audio on its own", async () => {
    play.mockRejectedValueOnce(
      Object.assign(new Error("gesture required"), { name: "NotAllowedError" }),
    );
    render(<WelcomeScreen knownName={null} />);

    const hear = await screen.findByText("Hear Q");
    // Start was never held up waiting for audio.
    expect(screen.getByText("Start")).toBeTruthy();

    play.mockResolvedValue(undefined);
    await userEvent.click(hear);
    await waitFor(() => {
      expect(play).toHaveBeenCalledTimes(2);
    });
  });

  it("stays silent, and says nothing about it, when synthesis is refused", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({ message: "Q can't speak right now." }),
            {
              status: 503,
              headers: { "content-type": "application/json" },
            },
          ),
        ),
      ),
    );
    render(<WelcomeScreen knownName={null} />);

    await waitFor(() => {
      expect(
        document.querySelector('[data-q-speech="unavailable"]'),
      ).toBeTruthy();
    });
    expect(play).not.toHaveBeenCalled();
    // No dead control, no apology, and the way forward is still there.
    expect(screen.queryByText("Hear Q")).toBeNull();
    expect(screen.queryByText("Mute Q")).toBeNull();
    expect(screen.getByText("Start")).toBeTruthy();
    expect(screen.getByText("Hi, I'm Q.")).toBeTruthy();
  });

  it("does not speak to somebody who has already been welcomed", async () => {
    render(<WelcomeScreen knownName="Ada" returning />);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(play).not.toHaveBeenCalled();
    expect(screen.getByText("Hi Ada, I'm Q.")).toBeTruthy();
  });

  it("asks for no audio at all once somebody has muted Q", async () => {
    window.localStorage.setItem("cq.q.speech.muted", "1");
    render(<WelcomeScreen knownName="Ada" />);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(play).not.toHaveBeenCalled();
    expect(screen.getByText("Unmute Q")).toBeTruthy();
  });
});
