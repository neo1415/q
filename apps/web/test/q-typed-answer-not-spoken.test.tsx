// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createQStreamState } from "@capital-q/api-client";

/**
 * Owner 2026-11-03: with a GPT-Live call open, they typed "i need companies
 * to invest in" in the chat view. Typing closes the call (QO-12) and makes
 * the turn a written one, yet its answer was read aloud by the one-way
 * voice -- not the call's voice -- and heard as Q's voice turning into
 * Deepgram's. The answer to a typed turn that closed the call is written,
 * not spoken.
 *
 * A6 (owner 2026-11-04): 16 paid speech requests for 5 typed turns. A typed
 * answer is now silent by default and read aloud only when the viewer
 * turned on "Read answers aloud" (this supersedes "an answer with no call
 * involved is still read aloud").
 */

const say = vi.fn(() => Promise.resolve());
const queue = vi.fn();
const voiceEnd = vi.fn(() => Promise.resolve());
const ask = vi.fn(() => Promise.resolve());
const session = {
  active: false,
  connected: false,
  turns: [] as unknown[],
};

vi.mock("next/navigation", () => ({
  usePathname: () => "/q",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("../src/features/voice/use-q-speech", () => ({
  useQSpeech: () => ({
    status: "idle",
    muted: false,
    say,
    queue,
    play: vi.fn(),
    stop: vi.fn(),
    setMuted: vi.fn(),
    toggleMuted: vi.fn(),
  }),
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
      ask,
      stop: vi.fn(() => Promise.resolve()),
    },
    turns: session.turns,
    voice: {
      client: {
        state: session.active ? "LISTENING" : "IDLE",
        connected: session.connected,
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
      active: session.active,
      voice: "FEMALE",
      notice: null,
      talk: vi.fn(() => Promise.resolve()),
      end: voiceEnd,
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
    talk: vi.fn(() => Promise.resolve()),
    act: vi.fn(),
    artifactId: null,
    openArtifact: vi.fn(),
    closeArtifact: vi.fn(),
  }),
  useQSessionOptional: () => null,
}));

beforeEach(() => {
  say.mockClear();
  queue.mockClear();
  voiceEnd.mockClear();
  ask.mockClear();
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
  window.localStorage.clear();
  resetReadAloudChoiceForTests();
});

const { QConversationPanel } = await import("../src/features/q/q-conversation");
const { resetReadAloudChoiceForTests, writeReadAloudOn } =
  await import("../src/features/voice/read-aloud-choice");

const QUESTION = "i need companies to invest in";
const person = { kind: "PERSON", id: "p1", text: QUESTION, unconfirmed: false };
const answer = {
  kind: "Q",
  id: "q1",
  text: "Ranked by fit with your mandate, the top three: Halyard Security, Tensorgate and Shiftwell.",
  streaming: false,
  sourceCount: 0,
  publicSources: [],
  findings: [],
  uncertainties: [],
  blocks: [],
  gestures: [],
};

function panel() {
  return (
    <QConversationPanel
      connected
      context={{ scope: "unset", suggestions: [] }}
    />
  );
}
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

describe("an answer to a typed turn that closed the call (owner 2026-11-03)", () => {
  it("is written, never read aloud by the one-way voice", async () => {
    // Even with read-aloud on: the typed turn made the call a written one.
    writeReadAloudOn(true);
    session.active = true;
    session.connected = true;
    session.turns = [];
    const view = render(panel());
    await settle();
    const box = screen.getByPlaceholderText("Type instead");
    fireEvent.change(box, { target: { value: QUESTION } });
    fireEvent.submit(box.closest("form") ?? box);
    await settle();
    // Typing closed the call, as before (QO-12), and asked Q.
    expect(voiceEnd).toHaveBeenCalled();
    expect(ask).toHaveBeenCalled();
    // The call is closed when the answer lands.
    session.active = false;
    session.connected = false;
    session.turns = [person, answer];
    view.rerender(panel());
    await settle();
    expect(say).not.toHaveBeenCalled();
    expect(queue).not.toHaveBeenCalled();
  });
});

describe("typed answers are silent by default (A6, owner 2026-11-04)", () => {
  async function typedTurn() {
    session.active = false;
    session.connected = false;
    session.turns = [];
    const view = render(panel());
    await settle();
    session.turns = [person, answer];
    view.rerender(panel());
    await settle();
  }

  it("sends no speech request for a typed answer", async () => {
    await typedTurn();
    expect(say).not.toHaveBeenCalled();
    expect(queue).not.toHaveBeenCalled();
  });

  it("reads the answer aloud once when the viewer turned on Read answers aloud", async () => {
    writeReadAloudOn(true);
    await typedTurn();
    expect(say).toHaveBeenCalledTimes(1);
    expect(queue).not.toHaveBeenCalled();
  });

  it("a remembered choice from an earlier visit applies", async () => {
    window.localStorage.setItem("cq.q.readAloud", "on");
    resetReadAloudChoiceForTests();
    await typedTurn();
    expect(say).toHaveBeenCalledTimes(1);
  });
});
