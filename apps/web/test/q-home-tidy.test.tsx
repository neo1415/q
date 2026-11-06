// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import userEvent from "@testing-library/user-event";

import { createQStreamState } from "@capital-q/api-client";

/**
 * Owner 2026-11-06: the Q home tidied like ChatGPT's. On a phone it has one
 * top bar (menu, Q | Chat, Board, Conversations, More) with the scope, the
 * bell and You one tap inside the menu's drawer. "Hide from Q" is a
 * per-message action, not a link under every line. The floating "Clear"
 * left the thread for the More menu. Hiding and clearing work as before.
 */

// The bell reads notices from the server; here it is only a placement.
vi.mock("@/features/work/notification-center", () => ({
  NotificationCenter: () => (
    <button type="button" aria-label="Notifications" data-test-bell />
  ),
}));
const hide = vi.fn(() => Promise.resolve({ ok: true as const, value: null }));
vi.mock("@/features/q/actions", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  hideQMessageAction: (...args: unknown[]) => hide(...(args as [])),
}));

const talk = vi.fn(() => Promise.resolve());
const state: {
  conversationId: string | null;
  turns: readonly {
    kind: "PERSON";
    id: string;
    text: string;
    unconfirmed: boolean;
  }[];
} = { conversationId: null, turns: [] };
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
      get conversationId() {
        return state.conversationId;
      },
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
  state.conversationId = null;
  window.sessionStorage.clear();
  resetCards();
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
const { ShellPhoneLeadProvider } =
  await import("../src/components/app-shell/phone-lead");
const { AnswerCanvas } = await import("../src/features/q/answer-canvas");
const { demoTop } = await import("../src/features/q/answer-canvas-fixtures");
const { resetCards, setCardsConversation } =
  await import("../src/features/q/cards/card-visibility");

const CONVERSATION = "f0000000-0000-4000-8000-000000000002";
const MESSAGE = "f0000000-0000-4000-8000-000000000003";
const CONTEXT = {
  scope: "investor_private" as const,
  label: "Personal investing",
  suggestions: ["What is my mandate?"],
};

const panel = (
  <QConversationPanel connected context={CONTEXT} conversationId={null} />
);

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

function chatWithOneLine() {
  state.conversationId = CONVERSATION;
  state.turns = [
    {
      kind: "PERSON",
      id: MESSAGE,
      text: "Who should I meet this week?",
      unconfirmed: false,
    },
  ];
  localStorage.setItem("cq.q.view", "chat");
}

describe("Hide from Q is a message action (owner 2026-11-06)", () => {
  it("shows no Hide from Q link under the line until its actions are opened", async () => {
    chatWithOneLine();
    render(panel);
    await settle();
    const row = document.querySelector("[data-q-row='person']");
    expect(row).not.toBeNull();
    expect(screen.queryByText("Hide from Q")).toBeNull();
    expect(screen.queryByRole("button", { name: "Hide from Q" })).toBeNull();
    // A small actions button beside the line instead, out of sight until
    // the row is hovered or focused (globals.css, below).
    const trigger = within(row as HTMLElement).getByRole("button", {
      name: "Message actions",
    });
    expect(trigger.className).toContain("cq-q-msg-actions-trigger");
  });

  it("is reached from the keyboard and still hides the line from Q", async () => {
    chatWithOneLine();
    const user = userEvent.setup();
    render(panel);
    await settle();
    const trigger = screen.getByRole("button", { name: "Message actions" });
    trigger.focus();
    expect(document.activeElement).toBe(trigger);
    await user.keyboard("{Enter}");
    await user.click(
      await screen.findByRole("menuitem", { name: "Hide from Q" }),
    );
    expect(hide).toHaveBeenCalledWith(CONVERSATION, MESSAGE);
    expect((await screen.findByRole("status")).textContent).toContain(
      "Hidden from Q. It stays in your history.",
    );
  });

  it("is out of sight until hover or keyboard focus, and visible on touch", () => {
    const css = readFileSync(join(__dirname, "../app/globals.css"), "utf8");
    expect(css).toMatch(/\.cq-q-msg-actions-trigger \{[^}]*opacity: 0;/);
    expect(css).toContain(
      ".cq-q-msg-actions:focus-within .cq-q-msg-actions-trigger",
    );
    expect(css).toContain(
      "li:hover > .cq-q-msg-actions .cq-q-msg-actions-trigger",
    );
    expect(css).toMatch(
      /@media \(hover: none\) \{\s*\.cq-q-msg-actions-trigger \{\s*opacity: 0\.7;/,
    );
  });
});

describe("Clear lives in More, not in the thread (owner 2026-11-06)", () => {
  it("draws no Clear in the thread and offers it, and Show again, in More", async () => {
    // Inside a conversation, as on the page: Show again is offered there.
    state.conversationId = CONVERSATION;
    setCardsConversation(CONVERSATION);
    const user = userEvent.setup();
    render(
      <>
        {panel}
        <AnswerCanvas block={demoTop(3)} focus={-1} said="Here." />
      </>,
    );
    await settle();
    expect(document.querySelectorAll("[data-ac-card]").length).toBe(3);
    // No floating Clear on the thread.
    expect(document.querySelector("[data-q-cards-controls]")).toBeNull();
    expect(document.querySelector("[data-q-cards-clear]")).toBeNull();
    expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "More" }));
    await user.click(
      await screen.findByRole("menuitem", { name: "Clear the cards" }),
    );
    expect(document.querySelectorAll("[data-ac-card]").length).toBe(0);

    await user.click(screen.getByRole("button", { name: "More" }));
    expect(
      screen.queryByRole("menuitem", { name: "Clear the cards" }),
    ).toBeNull();
    await user.click(
      await screen.findByRole("menuitem", { name: "Show the cards again" }),
    );
    expect(document.querySelectorAll("[data-ac-card]").length).toBe(3);
  });
});

describe("one top bar on the phone Q home (owner 2026-11-06)", () => {
  it("leads the Q top line with the menu, and keeps scope, bell and You one tap inside it", async () => {
    const user = userEvent.setup();
    render(
      <ShellPhoneLeadProvider context={{ scope: "investor_private" }}>
        {panel}
      </ShellPhoneLeadProvider>,
    );
    await settle();
    const top = document.querySelector<HTMLElement>("[data-q-top-line]");
    expect(top).not.toBeNull();
    const lead = top?.querySelector("[data-q-phone-lead]");
    // Shown below the desktop breakpoint only, where the shell header hides.
    expect(lead?.className).toContain("lg:hidden");
    const menu = within(top as HTMLElement).getByRole("button", {
      name: "Menu",
    });
    // The menu, the switch and Board / Conversations / More: one line.
    within(top as HTMLElement).getByRole("group", { name: "View" });
    within(top as HTMLElement).getByRole("button", { name: "More" });
    expect(top?.querySelector("[data-test-bell]")).toBeNull();
    expect(
      within(top as HTMLElement).queryByRole("button", { name: "You" }),
    ).toBeNull();

    await user.click(menu);
    const drawer = await screen.findByRole("dialog");
    const row = drawer.querySelector<HTMLElement>("[data-nav-shell-controls]");
    expect(row).not.toBeNull();
    within(row as HTMLElement).getByRole("button", { name: "Notifications" });
    within(row as HTMLElement).getByRole("button", { name: "You" });
    // The scope indicator ("Private") is still there.
    expect(row?.textContent).toContain("Private");
  });

  it("hides the shell's own header on the Q home below the desktop breakpoint only", () => {
    const css = readFileSync(join(__dirname, "../app/globals.css"), "utf8");
    expect(css).toMatch(
      /@media \(max-width: 1023px\) \{\s*\.cq-shell:has\(\.cq-q-home\) \.cq-shell-header \{\s*display: none;/,
    );
  });

  it("draws no menu of its own outside the signed-in shell", async () => {
    render(panel);
    await settle();
    expect(
      document.querySelector("[data-q-phone-lead] [data-nav-menu]"),
    ).toBeNull();
  });
});
