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

import type { QTurn } from "../src/features/q/conversation";
import { demoTop } from "../src/features/q/answer-canvas-fixtures";

/**
 * Owner 2026-11-06: "in ChatGPT, when you start voice the interface
 * changes". Chat is the default view (the ChatGPT-style home); Q is the
 * voice view, with Q's room presence back as it was before 5 Nov. One
 * conversation and one voice path under both views.
 */

const talk = vi.fn(() => Promise.resolve());
const state: {
  turns: readonly QTurn[];
  voiceActive: boolean;
} = { turns: [], voiceActive: false };
const voiceEnd = vi.fn((_reason?: string) => Promise.resolve());
const voiceTalk = vi.fn(() => Promise.resolve());
const speechStop = vi.fn();
vi.mock("../src/features/voice/use-q-speech", () => ({
  useQSpeech: () => ({
    status: "idle",
    muted: false,
    say: vi.fn(() => Promise.resolve()),
    queue: vi.fn(),
    play: vi.fn(),
    stop: speechStop,
    toggleMuted: vi.fn(),
  }),
}));
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
    get turns() {
      return state.turns;
    },
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
      get active() {
        return state.voiceActive;
      },
      voice: "FEMALE",
      notice: null,
      talk: voiceTalk,
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
    talk,
    act: vi.fn(),
    artifactId: null,
    openArtifact: vi.fn(),
    closeArtifact: vi.fn(),
  }),
  useQSessionOptional: () => null,
}));

let reducedMotion = false;
beforeEach(() => {
  state.turns = [];
  state.voiceActive = false;
  reducedMotion = false;
  talk.mockClear();
  voiceTalk.mockClear();
  voiceEnd.mockClear();
  speechStop.mockClear();
  localStorage.clear();
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: reducedMotion && query.includes("prefers-reduced-motion"),
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

const CONTEXT = {
  scope: "investor_private" as const,
  label: "Personal investing",
  suggestions: ["What is my mandate?", "What should I look at?"],
};

async function renderHome() {
  render(
    <QConversationPanel
      connected
      context={CONTEXT}
      welcomeLine="Welcome back, David."
      greeting="What's on your mind today, David?"
    />,
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

function viewSwitch() {
  return screen.getByRole("group", { name: "View" });
}

describe("Chat and Q as two views (owner 2026-11-06)", () => {
  it("opens on Chat when no choice is stored", async () => {
    await renderHome();
    expect(viewSwitch().getAttribute("data-q-view")).toBe("chat");
    expect(
      screen.getByRole("button", { name: "Chat" }).getAttribute("aria-pressed"),
    ).toBe("true");
    // The ChatGPT-style home: greeting and the composer in the middle.
    expect(document.querySelector("[data-q-greeting]")).not.toBeNull();
    expect(
      document.querySelector("[data-q-home-empty] #home-q"),
    ).not.toBeNull();
  });

  it("a stored choice still wins, and opens ready without the mic", async () => {
    localStorage.setItem("cq.q.view", "presence");
    await renderHome();
    expect(viewSwitch().getAttribute("data-q-view")).toBe("presence");
    // No click, no line (QO-46): Q waits, with Talk to Q.
    expect(talk).not.toHaveBeenCalled();
    expect(document.querySelector(".cq-room-talk")).not.toBeNull();
  });

  it("choosing Q again while in Q starts nothing new", async () => {
    localStorage.setItem("cq.q.view", "presence");
    await renderHome();
    fireEvent.click(screen.getByRole("button", { name: "Q" }));
    expect(talk).not.toHaveBeenCalled();
  });

  it("the Q view shows Q's room presence; the Chat view does not", async () => {
    await renderHome();
    expect(document.querySelector("[data-q-room-presence]")).toBeNull();
    expect(document.querySelector(".cq-room-presence")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Q" }));
    const presence = document.querySelector("[data-q-room-presence]");
    expect(presence).not.toBeNull();
    expect(presence?.classList.contains("cq-room-presence")).toBe(true);
    expect(presence?.querySelector("[data-q-aperture]")).not.toBeNull();
    // Decorative: nothing in it is announced or focusable.
    expect(presence?.getAttribute("aria-hidden")).toBe("true");
    // Owner 2026-11-06: choosing Q starts the line in the same click,
    // through the one talk() (never a second voice path).
    expect(talk).toHaveBeenCalledTimes(1);
    expect(voiceTalk).not.toHaveBeenCalled();
    // The line did not open here (as with a refused mic): "Talk to Q" is
    // the way to try again, the same talk().
    const talkButton =
      document.querySelector<HTMLButtonElement>(".cq-room-talk");
    expect(talkButton).not.toBeNull();
    if (talkButton !== null) fireEvent.click(talkButton);
    expect(talk).toHaveBeenCalledTimes(2);
    // Back to Chat: the presence goes.
    fireEvent.click(screen.getByRole("button", { name: "Chat" }));
    expect(document.querySelector("[data-q-room-presence]")).toBeNull();
  });

  it("the composer's Q button switches to Q and starts the one talk()", async () => {
    await renderHome();
    expect(viewSwitch().getAttribute("data-q-view")).toBe("chat");
    const composer = document.querySelector("[data-q-home-empty]");
    const talkButton = composer?.querySelector<HTMLButtonElement>(
      "button[aria-label='Talk to Q']",
    );
    expect(talkButton).toBeTruthy();
    if (talkButton !== null && talkButton !== undefined) {
      fireEvent.click(talkButton);
    }
    expect(viewSwitch().getAttribute("data-q-view")).toBe("presence");
    expect(talk).toHaveBeenCalledTimes(1);
    expect(document.querySelector("[data-q-room-presence]")).not.toBeNull();
  });

  it("keeps one thread across the switch", async () => {
    state.turns = [
      {
        kind: "PERSON",
        id: "p-1",
        text: "What should I look at this week?",
        unconfirmed: false,
      },
    ];
    await renderHome();
    const said = "What should I look at this week?";
    expect(document.querySelector("[data-q-thread]")?.textContent).toContain(
      said,
    );
    fireEvent.click(screen.getByRole("button", { name: "Q" }));
    expect(viewSwitch().getAttribute("data-q-view")).toBe("presence");
    // The same words, under Q's presence (captions are on by default).
    expect(
      document.querySelector("[data-q-voice-stage-body]")?.textContent,
    ).toContain(said);
    // Q's presence is on the stage while they talk.
    expect(
      document.querySelector("[data-q-presence='stage'] [data-q-aperture]"),
    ).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Chat" }));
    expect(document.querySelector("[data-q-thread]")?.textContent).toContain(
      said,
    );
  });

  it("leaving Q for Chat ends the voice the way End does", async () => {
    localStorage.setItem("cq.q.view", "presence");
    state.voiceActive = true;
    await renderHome();
    fireEvent.click(screen.getByRole("button", { name: "Chat" }));
    expect(voiceEnd).toHaveBeenCalledWith("user");
    expect(viewSwitch().getAttribute("data-q-view")).toBe("chat");
  });

  it("under reduced motion Q's presence is still", async () => {
    reducedMotion = true;
    localStorage.setItem("cq.q.view", "presence");
    await renderHome();
    const aperture = document.querySelector(
      "[data-q-room-presence] [data-q-aperture]",
    );
    expect(aperture).not.toBeNull();
    // Calm is Q's still light: no automatic motion (ADR-001).
    expect(aperture?.getAttribute("data-motion")).toBe("calm");
  });

  it("keeps the presence in an existing conversation (/home?c=)", async () => {
    state.turns = [
      {
        kind: "PERSON",
        id: "p-1",
        text: "Where are we with Brightwell?",
        unconfirmed: false,
      },
    ];
    localStorage.setItem("cq.q.view", "presence");
    render(
      <QConversationPanel
        connected
        context={CONTEXT}
        conversationId="00000000-0000-4000-8000-000000000001"
      />,
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(
      document.querySelector("[data-q-presence='stage'] [data-q-aperture]"),
    ).not.toBeNull();
  });
});

describe("Chat is voice off (owner 2026-11-06)", () => {
  it("switching to Chat ends the line and stops Q mid-sentence", async () => {
    localStorage.setItem("cq.q.view", "presence");
    state.voiceActive = true;
    await renderHome();
    expect(voiceEnd).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Chat" }));
    expect(voiceEnd).toHaveBeenCalledWith("user");
    expect(speechStop).toHaveBeenCalled();
  });

  it("arriving on Chat with a line still open (stored choice, navigation) ends it", async () => {
    localStorage.setItem("cq.q.view", "chat");
    state.voiceActive = true;
    await renderHome();
    expect(voiceEnd).toHaveBeenCalledWith("user");
  });

  it("never re-arms on Chat: a line that comes up there is ended, and talk() is not called", async () => {
    localStorage.setItem("cq.q.view", "chat");
    const view = render(<QConversationPanel connected context={CONTEXT} />);
    expect(voiceEnd).not.toHaveBeenCalled();
    state.voiceActive = true;
    view.rerender(<QConversationPanel connected context={CONTEXT} />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(voiceEnd).toHaveBeenCalledTimes(1);
    expect(talk).not.toHaveBeenCalled();
    expect(voiceTalk).not.toHaveBeenCalled();
    expect(viewSwitch().getAttribute("data-q-view")).toBe("chat");
  });
});

type Block = Extract<QTurn, { kind: "Q" }>["blocks"][number];

function qAnswer(
  id: string,
  text: string,
  blocks: readonly unknown[] = [],
): QTurn {
  return {
    kind: "Q",
    id,
    text,
    streaming: false,
    sourceCount: 0,
    publicSources: [],
    findings: [],
    uncertainties: [],
    blocks: blocks as Block[],
  };
}

// The real card fixtures the dev harness uses: five discovery cards.
const DISCOVERY = { ...demoTop(5), kind: "ANSWER_CARDS" as const };
const NAMES = DISCOVERY.cards.map((card) => card.name);

/** A live-shaped conversation: 12 turns, ending in discovery cards. */
function longConversation(): readonly QTurn[] {
  const turns: QTurn[] = [];
  for (let n = 1; n <= 5; n += 1) {
    turns.push({
      kind: "PERSON",
      id: `p-${String(n)}`,
      text: `Earlier question ${String(n)}`,
      unconfirmed: false,
    });
    turns.push(qAnswer(`q-${String(n)}`, `Earlier answer ${String(n)}`));
  }
  turns.push({
    kind: "PERSON",
    id: "p-6",
    text: "Find me founders raising in fintech",
    unconfirmed: false,
  });
  turns.push(
    qAnswer("q-6", "I found **five** founders raising now.", [DISCOVERY]),
  );
  return turns;
}

describe("the Q view in a conversation is the voice room (owner 2026-11-06, live)", () => {
  it("pins Q's presence and shows only the current exchange, cards one line each", async () => {
    state.turns = longConversation();
    localStorage.setItem("cq.q.view", "presence");
    render(
      <QConversationPanel
        connected
        context={CONTEXT}
        conversationId="00000000-0000-4000-8000-000000000001"
      />,
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    const room = document.querySelector("[data-q-voice-room]");
    expect(room).not.toBeNull();
    // The presence: pinned (sticky, first in the room), decorative.
    const pinned = room?.querySelector(".cq-voice-room-presence");
    expect(pinned?.querySelector("[data-q-aperture]")).not.toBeNull();
    expect(pinned?.getAttribute("aria-hidden")).toBe("true");
    expect(room?.firstElementChild).toBe(pinned);
    // No transcript: no thread, no earlier turns, no full cards.
    expect(document.querySelector("[data-q-thread]")).toBeNull();
    const body =
      document.querySelector("[data-q-voice-stage-body]")?.textContent ?? "";
    expect(body).not.toContain("Earlier question 1");
    expect(body).not.toContain("Earlier answer 5");
    for (const reason of DISCOVERY.cards[0]?.reasons ?? []) {
      expect(body).not.toContain(reason);
    }
    // Their last line and Q's reply as a caption, as plain words.
    expect(
      document.querySelector("[data-q-exchange-person]")?.textContent,
    ).toContain("Find me founders raising in fintech");
    expect(
      document.querySelector("[data-q-exchange-caption]")?.textContent,
    ).toContain("I found five founders raising now.");
    // Cards: one line each, at most four, the rest one way to Chat.
    const lines = document.querySelectorAll("[data-q-card-line]");
    expect(lines).toHaveLength(4);
    const first = DISCOVERY.cards[0];
    expect(lines[0]?.textContent).toBe(
      first?.line === null || first?.line === undefined
        ? first?.name
        : `${first.name} · ${first.line}`,
    );
    screen.getByRole("button", { name: "See all in Chat" });
    screen.getByRole("button", { name: "Earlier in this conversation" });
  });

  it("a card line opens Chat, where the whole transcript and the cards are", async () => {
    state.turns = longConversation();
    localStorage.setItem("cq.q.view", "presence");
    render(<QConversationPanel connected context={CONTEXT} />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    const first =
      document.querySelector<HTMLButtonElement>("[data-q-card-line]");
    if (first !== null) fireEvent.click(first);
    expect(viewSwitch().getAttribute("data-q-view")).toBe("chat");
    const thread = document.querySelector("[data-q-thread]")?.textContent ?? "";
    expect(thread).toContain("Earlier question 1");
    // The cards are Chat's again, in full (their canvas loads on demand).
    expect(
      (await screen.findAllByText(NAMES.at(-1) ?? "-", {}, { timeout: 4000 }))
        .length,
    ).toBeGreaterThan(0);
    expect(document.querySelector("[data-q-voice-room]")).toBeNull();
  });
});

describe("one conversation under both views (owner 2026-11-06)", () => {
  it("switching to Q mid-conversation carries on from the thread, never the arrival greeting", async () => {
    state.turns = longConversation();
    await renderHome();
    fireEvent.click(screen.getByRole("button", { name: "Q" }));
    expect(talk).toHaveBeenCalledTimes(1);
    const greeting =
      (
        talk.mock.calls[0] as unknown as [{ greeting?: string }] | undefined
      )?.[0]?.greeting ?? "";
    expect(greeting).toContain("Find me founders raising in fintech");
    expect(greeting).toContain("I found five");
    expect(greeting).not.toContain("Welcome back");
    expect(greeting).not.toMatch(/things? (are )?waiting/u);
  });

  it("an empty thread still opens with the arrival greeting", async () => {
    await renderHome();
    fireEvent.click(screen.getByRole("button", { name: "Q" }));
    const greeting =
      (
        talk.mock.calls[0] as unknown as [{ greeting?: string }] | undefined
      )?.[0]?.greeting ?? "";
    expect(greeting).toBe("Welcome back, David.");
  });
});
