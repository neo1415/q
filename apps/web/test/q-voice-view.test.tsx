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
 * Owner 2026-11-06: "in ChatGPT, when you start voice the interface
 * changes". Chat is the default view (the ChatGPT-style home); Q is the
 * voice view, with Q's room presence back as it was before 5 Nov. One
 * conversation and one voice path under both views.
 */

const talk = vi.fn(() => Promise.resolve());
const state: {
  turns: readonly {
    kind: "PERSON";
    id: string;
    text: string;
    unconfirmed: boolean;
  }[];
  voiceActive: boolean;
} = { turns: [], voiceActive: false };
const voiceEnd = vi.fn((_reason?: string) => Promise.resolve());
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

  it("a stored choice still wins", async () => {
    localStorage.setItem("cq.q.view", "presence");
    await renderHome();
    expect(viewSwitch().getAttribute("data-q-view")).toBe("presence");
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
    // Ready to talk: one clear Talk control, the same talk().
    const talkButton =
      document.querySelector<HTMLButtonElement>(".cq-room-talk");
    expect(talkButton).not.toBeNull();
    expect(talk).not.toHaveBeenCalled();
    if (talkButton !== null) fireEvent.click(talkButton);
    expect(talk).toHaveBeenCalledTimes(1);
    expect(voiceTalk).not.toHaveBeenCalled();
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
});
