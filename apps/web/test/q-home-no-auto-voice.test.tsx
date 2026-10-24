// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createQStreamState } from "@capital-q/api-client";

/**
 * QA QO-46 (privacy, owner 2026-10-23): a fresh /home said "Listening": the
 * room opened a live voice line on load wherever the site already had
 * microphone permission. The microphone opens only on the person's own
 * action (Speak, or the wake word they turned on), never on load.
 */

const talk = vi.fn(() => Promise.resolve());
const voiceTalk = vi.fn(() => Promise.resolve());
vi.mock("next/navigation", () => ({
  usePathname: () => "/home",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/features/q/q-session", () => ({
  useQSession: () => ({
    connected: true,
    subject: { kind: "NONE" },
    q: {
      state: createQStreamState(),
      pending: [],
      transport: null,
      working: false,
      loading: false,
      notice: null,
      runId: null,
      conversationId: null,
      ask: vi.fn(() => Promise.resolve()),
      stop: vi.fn(() => Promise.resolve()),
    },
    turns: [],
    voice: {
      client: {
        state: "IDLE",
        connected: false,
        muted: false,
        transcript: [],
        start: vi.fn(),
        end: vi.fn(() => Promise.resolve()),
        sendText: vi.fn(),
        setMuted: vi.fn(),
        setVolume: vi.fn(),
        inputLevel: () => 0,
        outputLevel: () => 0,
      },
      active: false,
      voice: "FEMALE",
      notice: null,
      talk: voiceTalk,
      end: vi.fn(() => Promise.resolve()),
      setVoice: vi.fn(),
    },
    spokenOnly: [],
    spoken: [],
    voiceOutcomes: [],
    spokenPreview: null,
    presence: {
      state: "IDLE",
      label: undefined,
      detail: undefined,
      stage: null,
    },
    open: vi.fn(),
    talk,
    act: vi.fn(),
    artifactId: null,
    openArtifact: vi.fn(),
    closeArtifact: vi.fn(),
  }),
  useQSessionOptional: () => null,
}));

const getUserMedia = vi.fn(() => Promise.reject(new Error("no mic in test")));

beforeEach(() => {
  talk.mockClear();
  voiceTalk.mockClear();
  getUserMedia.mockClear();
  vi.stubGlobal("navigator", {
    ...globalThis.navigator,
    // The site already has the microphone: what used to open the line.
    permissions: {
      query: () => Promise.resolve({ state: "granted" }),
    },
    mediaDevices: { getUserMedia },
  });
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
  cleanup();
  vi.unstubAllGlobals();
});

const { QConversationPanel } = await import("../src/features/q/q-conversation");

describe("loading /home (QO-46)", () => {
  it("never opens the microphone or a voice line by itself", async () => {
    render(
      <QConversationPanel
        connected
        context={{ scope: "unset", suggestions: [] }}
        welcomeLine="Welcome back, Ada."
      />,
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(talk).not.toHaveBeenCalled();
    expect(voiceTalk).not.toHaveBeenCalled();
    expect(getUserMedia).not.toHaveBeenCalled();
  });
});
