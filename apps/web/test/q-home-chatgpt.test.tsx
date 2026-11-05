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
 * Client 2026-11-05: "our Q screen should basically look like ChatGPT".
 * The empty home is one greeting line, the composer in the middle and at
 * most three starters; no Q field, no corner Q, no scope chip and no "Q
 * can see" on the top line. After the first word the greeting and the
 * starters go and the composer sits at the foot of the thread. The
 * composer's round button is "Talk to Q" when empty and "Send" with text.
 */

const talk = vi.fn(() => Promise.resolve());
const state: {
  turns: readonly {
    kind: "PERSON";
    id: string;
    text: string;
    unconfirmed: boolean;
  }[];
} = { turns: [] };
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

beforeEach(() => {
  state.turns = [];
  talk.mockClear();
  voiceTalk.mockClear();
  localStorage.clear();
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

const CONTEXT = {
  scope: "investor_private" as const,
  label: "Personal investing",
  suggestions: [
    "What is my mandate?",
    "What are my hard exclusions?",
    "What should I look at?",
  ],
};

async function renderHome() {
  render(
    <QConversationPanel
      connected
      context={CONTEXT}
      welcomeLine="Welcome back, David."
      greeting="What's on your mind today, David?"
      starters={[
        {
          id: "verify",
          label: "Verify you and Personal investing",
          icon: "verify",
          kind: "GO",
          href: "/verification",
        },
      ]}
    />,
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

describe("the empty Q home (client 2026-11-05)", () => {
  it("is one greeting, the composer and at most three starters, with no Q field", async () => {
    await renderHome();
    const greeting = document.querySelectorAll("[data-q-greeting]");
    expect(greeting).toHaveLength(1);
    expect(greeting[0]?.textContent).toBe("What's on your mind today, David?");
    const rows = document.querySelectorAll("[data-q-starter]");
    expect(rows).toHaveLength(3);
    // What waits on them comes first; the suggestions fill the rest.
    expect(rows[0]?.textContent).toContain("Verify you and Personal investing");
    expect(rows[2]?.textContent).toContain("What are my hard exclusions?");
    // The composer is in the middle, with the greeting.
    const empty = document.querySelector("[data-q-home-empty]");
    expect(empty?.querySelector("#home-q")).not.toBeNull();
    expect(document.querySelector("[data-q-voice-stage-controls]")).toBeNull();
    // No particle field, no corner Q, no separate Talk to Q button.
    expect(document.querySelector(".cq-room-presence")).toBeNull();
    expect(document.querySelector("[data-q-room-presence]")).toBeNull();
    expect(document.querySelector("[data-q-presence='corner']")).toBeNull();
    expect(document.querySelector(".cq-room-talk")).toBeNull();
    expect(document.querySelectorAll("[data-q-control='talk']")).toHaveLength(
      1,
    );
  });

  it("never shows more than three starters", () => {
    render(
      <QConversationPanel
        connected
        context={{
          ...CONTEXT,
          suggestions: ["One?", "Two?", "Three?", "Four?", "Five?"],
        }}
        starters={[
          {
            id: "resume-setup",
            label: "Finish setup with Q",
            icon: "setup",
            kind: "GO",
            href: "/onboarding/investor?from=home",
          },
        ]}
      />,
    );
    expect(document.querySelectorAll("[data-q-starter]")).toHaveLength(3);
    // The default line when the page gives none.
    expect(document.querySelector("[data-q-greeting]")?.textContent).toBe(
      "What's on your mind today?",
    );
  });

  it("keeps the top line to the switch, Board, Conversations and More", async () => {
    await renderHome();
    const top = document.querySelector("[data-q-top-line]");
    expect(top).not.toBeNull();
    expect(top?.textContent).not.toContain("Investor private");
    expect(top?.textContent).not.toContain("Q can see");
    expect(document.querySelector("[data-q-scope]")).toBeNull();
    expect(document.querySelector("[data-q-can-see]")).toBeNull();
    screen.getByRole("button", { name: /^Board, 0 items$/ });
    screen.getByRole("button", { name: "Conversations" });
    screen.getByRole("button", { name: "More" });
    // Voice, captions and the transcript live inside More now.
    expect(document.querySelector("[data-q-control='voice']")).toBeNull();
    expect(
      top?.querySelector("[data-q-control='transcript']") ?? null,
    ).toBeNull();
  });

  it("the round button talks to Q when empty and sends once there is text", async () => {
    await renderHome();
    const talkButton = screen.getByRole("button", { name: "Talk to Q" });
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
    fireEvent.click(talkButton);
    // The one voice path: the panel's own talk(), never a second.
    expect(talk).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByRole("textbox", { name: "Ask Q" }), {
      target: { value: "What should I look at?" },
    });
    expect(screen.queryByRole("button", { name: "Talk to Q" })).toBeNull();
    screen.getByRole("button", { name: "Send" });
  });

  it("the Q | Chat switch slides between the two views", async () => {
    await renderHome();
    const group = screen.getByRole("group", { name: "View" });
    const chat = screen.getByRole("button", { name: "Chat" });
    const q = screen.getByRole("button", { name: "Q" });
    expect(q.getAttribute("aria-pressed")).toBe("true");
    expect(group.getAttribute("data-q-view")).toBe("presence");
    fireEvent.click(chat);
    expect(chat.getAttribute("aria-pressed")).toBe("true");
    expect(group.getAttribute("data-q-view")).toBe("chat");
    expect(group.querySelector(".cq-q-switch-thumb")).not.toBeNull();
  });
});

describe("after the first word (client 2026-11-05)", () => {
  it("drops the greeting and starters and puts the composer at the foot", async () => {
    state.turns = [
      {
        kind: "PERSON",
        id: "p-1",
        text: "What should I look at this week?",
        unconfirmed: false,
      },
    ];
    localStorage.setItem("cq.q.view", "chat");
    await renderHome();
    expect(document.querySelector("[data-q-greeting]")).toBeNull();
    expect(document.querySelector("[data-q-starter]")).toBeNull();
    expect(document.querySelector("[data-q-home-empty]")).toBeNull();
    const controls = document.querySelector("[data-q-voice-stage-controls]");
    expect(controls?.querySelector("#home-q")).not.toBeNull();
    // Their words, right-aligned in a bubble.
    const row = document.querySelector("[data-q-row='person']");
    expect(row?.querySelector(".cq-q-bubble")?.textContent).toContain(
      "What should I look at this week?",
    );
  });
});
