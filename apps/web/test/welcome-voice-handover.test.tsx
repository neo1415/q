// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

/**
 * Founder live 2026-10-05: choosing a role by voice must stay in voice.
 * When Q's first minute hears "I'm raising", the welcome line ends and
 * the person goes to their setup with the voice on (`?talk=1`); the voice
 * stage holds in between, never the typed chat or the form.
 */

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
const end = vi.fn(() => Promise.resolve());
vi.mock("../src/features/voice/use-voice-interview", () => ({
  useVoiceInterview: () => ({
    active: false,
    notice: null,
    turn: null,
    client: {},
    voice: "FEMALE",
    talk: vi.fn(),
    end,
    chooseVoice: vi.fn(),
    clearNotice: vi.fn(),
  }),
}));
vi.mock("../src/features/voice/use-q-speech", () => ({
  useQSpeech: () => ({
    status: "idle",
    muted: false,
    say: () => Promise.resolve(),
    stop: () => undefined,
    play: () => undefined,
    toggleMuted: () => undefined,
  }),
}));
// Q's turn says where it is taking them; followed once, as the hook does.
vi.mock("../src/features/voice/use-follow-turn", async () => {
  const { useEffect } = await import("react");
  return {
    useFollowTurn: (
      _turn: unknown,
      _client: unknown,
      follow: (followed: {
        handoff: null;
        navigate: "INTERVIEW_FOUNDER";
      }) => void,
    ) => {
      useEffect(() => {
        follow({ handoff: null, navigate: "INTERVIEW_FOUNDER" });
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);
    },
  };
});
vi.mock("../src/features/q-aperture", () => ({
  QAperture: () => null,
}));

const { WelcomeScreen } =
  await import("../src/features/welcome/welcome-screen");

describe("a role chosen by voice", () => {
  it("goes to that setup with the voice on, holding the voice stage", () => {
    render(<WelcomeScreen knownName="Ada" />);
    expect(push).toHaveBeenCalledWith("/onboarding/founder?talk=1");
    expect(end).toHaveBeenCalled();
    expect(document.querySelector("[data-voice-handover]")).toBeTruthy();
    expect(screen.getByText("Setting up your company")).toBeTruthy();
    // Not the typed choice, and not the intro page.
    expect(document.querySelector("[data-persona-cards]")).toBeNull();
    expect(document.querySelector("[data-q-welcome]")).toBeNull();
  });
});
