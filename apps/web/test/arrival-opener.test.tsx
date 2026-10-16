// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ArrivalCard,
  ArrivalData,
} from "../src/features/briefing/arrival";

/**
 * Q's opener on sign-in (owner 2026-10-16: "it should just greet the user
 * and tell them they have notifications if they do and ask if they'd like
 * to look at them ... or if they want to talk about other things").
 */

vi.mock("../src/features/briefing/arrival-actions", () => ({
  arrivalBriefingAction: vi.fn(),
  decideArrivalCardAction: vi.fn(() => Promise.resolve({ ok: true })),
  readArrivalWordsAction: vi.fn(() => Promise.resolve(null)),
}));
vi.mock("../src/features/work/notice-store", () => ({
  useNotices: () => ({ items: null }),
}));

const { arrivalWords } = await import("../src/features/briefing/arrival");
const { openerOf, pendingCount, readOpenerReply } =
  await import("../src/features/briefing/opener");
const { ArrivalBriefing } =
  await import("../src/features/briefing/arrival-briefing");
const { arrivalSpoken, openerShowsCards, resetArrival, useOpener } =
  await import("../src/features/briefing/arrival-store");
const { resetArrivalGate } =
  await import("../src/features/briefing/arrival-gate");
const { typedOpenerAnswer } =
  await import("../src/features/briefing/opener-answer");
const { onLineNote } = await import("../src/features/voice/line-cards");

const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const card = (n: number, counterpart: string): ArrivalCard => ({
  key: uuid(n),
  kind: "APPROVAL",
  approvalId: uuid(n),
  draftId: null,
  relationshipId: uuid(100 + n),
  counterpart,
  named: null,
  title: "Reply ready to send",
  summary: `Reply to ${counterpart}`,
  message: "Thanks, Tuesday works.",
  theySaid: "Can we meet Tuesday?",
  reason: null,
  canDecide: true,
  at: "2026-10-16T09:00:00Z",
});

const ATTENTION: NonNullable<ArrivalData["attention"]> = {
  items: [
    {
      key: `DOCUMENT_REQUEST:${uuid(9)}`,
      source: "DOCUMENT_REQUEST",
      title: "Apex asked for your cap table",
      since: "2026-10-16T08:00:00Z",
      decidable: false,
    },
    // Decided by a card already: counted once, as the card.
    {
      key: `APPROVAL:${uuid(1)}`,
      source: "APPROVAL",
      title: "Reply to Tensorgate",
      since: "2026-10-16T08:00:00Z",
      decidable: true,
    },
  ],
  activity: null,
  unread: [],
  readAt: "2026-10-16T10:00:00Z",
};

const BUSY: ArrivalData = {
  firstName: "Laura Okafor",
  timeZone: "Africa/Lagos",
  activity: { replies: { n: 1, names: ["Tensorgate"] } },
  hoursAway: 20,
  cards: [card(1, "Tensorgate"), card(2, "Spheros")],
  waiting: ["Tensorgate is waiting for your reply"],
  attention: ATTENTION,
  jobsDone: { n: 0, names: [] },
};

const QUIET: ArrivalData = {
  ...BUSY,
  activity: {},
  cards: [],
  waiting: [],
  attention: { ...ATTENTION, items: [] },
};
const QUIET_ATTENTION = { ...ATTENTION, items: [] };

// 10:30 in Lagos.
const MORNING = new Date("2026-10-16T09:30:00Z");

describe("the opener's words", () => {
  it("greets by first name and counts what waits in one sentence, never the list", () => {
    const words = arrivalWords(BUSY, MORNING, null);
    expect(words.opener.pending).toBe(3);
    expect(words.spoken).toMatch(/^Good morning, Laura\. /u);
    expect(words.spoken).toMatch(
      / You have 3 things waiting\. Would you like to look at them now, or talk about something else\?$/u,
    );
    // Not one name or item from the cards.
    for (const name of ["Tensorgate", "Spheros", "Apex", "cap table"]) {
      expect(words.spoken).not.toContain(name);
    }
    // The full lowdown is kept for when they choose to look.
    expect(words.briefing).toContain("Tensorgate");
  });

  it("is deterministic: the same data and clock give the same words", () => {
    expect(arrivalWords(BUSY, MORNING, null).spoken).toBe(
      arrivalWords(BUSY, MORNING, null).spoken,
    );
  });

  it("with nothing waiting: the greeting and one open question, no urgency", () => {
    const words = arrivalWords(QUIET, MORNING, null);
    expect(words.opener.offersChoice).toBe(false);
    expect(words.spoken).toMatch(/ What would you like to look at\?$/u);
    expect(words.spoken).not.toMatch(/waiting|need|urgent/iu);
  });

  it("one thing reads as one; a source not read makes it 'at least'", () => {
    const one = openerOf({ ...QUIET, cards: [card(1, "Tensorgate")] });
    expect(one.line).toBe(
      "You have 1 thing waiting. Would you like to look at it now, or talk about something else?",
    );
    const partial = openerOf({
      ...BUSY,
      attention: { ...ATTENTION, unread: ["MEETING"] },
    });
    expect(partial.count).toBe("You have at least 3 things waiting.");
  });

  it("unknown is never called empty: nothing counted but a read failed", () => {
    const opener = openerOf({
      ...QUIET,
      attention: { ...QUIET_ATTENTION, unread: ["MEETING"] },
    });
    expect(opener.offersChoice).toBe(false);
    expect(opener.line).toMatch(
      /^I couldn't check .+ What would you like to look at\?$/u,
    );
  });

  it("counts from the cards' own data: decisions, lines, new matches, questions", () => {
    expect(pendingCount(QUIET)).toBe(0);
    expect(
      pendingCount({
        ...QUIET,
        matches: {
          label: "SINCE_LAST_VISIT",
          total: 5,
          items: [
            {
              companyId: uuid(21),
              name: "Kora Health",
              line: null,
              stage: null,
              country: null,
              band: null,
              take: "x",
            },
          ],
        },
      }),
    ).toBe(1);
    // The feed, not looked at yet, is not something waiting on them.
    expect(
      pendingCount({
        ...QUIET,
        matches: { label: "NOT_LOOKED_AT", total: 1, items: [] },
      }),
    ).toBe(0);
  });
});

describe("their answer, typed or said", () => {
  it.each([
    ["yes", "SHOW"],
    ["Yes please!", "SHOW"],
    ["show me", "SHOW"],
    ["sure, let's see", "SHOW"],
    ["I'd like to look at them", "SHOW"],
    ["What's waiting?", "SHOW"],
    ["okay", "SHOW"],
    ["something else", "OTHER"],
    ["No, something else.", "OTHER"],
    ["not now", "OTHER"],
    ["let's talk about something else", "OTHER"],
    ["later", "OTHER"],
    ["Good morning Q", "SOCIAL"],
    ["thanks", "SOCIAL"],
    ["What's my readiness score?", "QUESTION"],
    ["yes, but first who is Tensorgate?", "QUESTION"],
    ["let's talk about my raise", "QUESTION"],
    ["show me investors in fintech", "QUESTION"],
  ] as const)("%j reads as %s", (words, reply) => {
    expect(readOpenerReply(words)).toBe(reply);
  });
});

function Choice() {
  const opener = useOpener();
  return <output data-choice>{opener.choice ?? "none"}</output>;
}

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
  resetArrivalGate();
  resetArrival();
});
afterEach(() => {
  cleanup();
});

async function landed() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("the opener on the page", () => {
  it("offers two clear buttons and no cards until they choose", async () => {
    render(
      <>
        <ArrivalBriefing
          variant="page"
          load={() => Promise.resolve(BUSY)}
          now={() => MORNING}
        />
        <Choice />
      </>,
    );
    await landed();
    expect(screen.getByRole("heading").textContent).toBe(
      "Good morning, Laura.",
    );
    expect(
      document.querySelector("[data-arrival-lowdown]")?.textContent,
    ).toMatch(/You have 3 things waiting\./u);
    expect(document.body.textContent).not.toContain("Spheros");
    expect(document.querySelector("[data-arrival-card]")).toBeNull();
    // The words the voice opens with are the same short ones.
    expect(arrivalSpoken()).toMatch(/You have 3 things waiting\./u);
    const look = screen.getByRole("button", { name: "Look at them" });
    // 44 px or more (the large size is h-12 at every width).
    expect(look.className).toMatch(/\bh-12\b/u);
    expect(
      screen.getByRole("button", { name: "Something else" }).className,
    ).toMatch(/\bh-12\b/u);
    fireEvent.click(look);
    expect(openerShowsCards()).toBe(true);
    expect(document.querySelector("[data-arrival-card]")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Look at them" })).toBeNull();
  });

  it("'Something else' asks what they'd like to know, and shows no cards", async () => {
    render(
      <ArrivalBriefing
        variant="page"
        load={() => Promise.resolve(BUSY)}
        now={() => MORNING}
      />,
    );
    await landed();
    fireEvent.click(screen.getByRole("button", { name: "Something else" }));
    expect(
      document.querySelector("[data-arrival-lowdown]")?.textContent,
    ).toMatch(/What would you like to know\?$/u);
    expect(document.querySelector("[data-arrival-card]")).toBeNull();
  });

  it("a typed 'yes' brings the cards up and goes no further; a question goes to Q", async () => {
    render(
      <ArrivalBriefing
        variant="page"
        load={() => Promise.resolve(BUSY)}
        now={() => MORNING}
      />,
    );
    await landed();
    let consumed = false;
    act(() => {
      consumed = typedOpenerAnswer("yes", false);
    });
    expect(consumed).toBe(true);
    expect(document.querySelector("[data-arrival-card]")).not.toBeNull();
    // Answered: anything more is for Q.
    expect(typedOpenerAnswer("what's my score?", false)).toBe(false);
  });

  it("a typed question instead of a choice is just answered (and the cards stay away)", async () => {
    render(
      <ArrivalBriefing
        variant="page"
        load={() => Promise.resolve(BUSY)}
        now={() => MORNING}
      />,
    );
    await landed();
    let consumed = true;
    act(() => {
      consumed = typedOpenerAnswer("Who fits my raise best?", false);
    });
    expect(consumed).toBe(false);
    expect(document.querySelector("[data-arrival-card]")).toBeNull();
    expect(screen.queryByRole("button", { name: "Look at them" })).toBeNull();
  });

  it("tells an open line what they chose, with the full lowdown to go through", async () => {
    const notes: { note: string; say: string | undefined }[] = [];
    const stop = onLineNote((note, respond, say) => {
      if (respond) notes.push({ note, say });
    });
    render(
      <ArrivalBriefing
        variant="page"
        load={() => Promise.resolve(BUSY)}
        now={() => MORNING}
      />,
    );
    await landed();
    fireEvent.click(screen.getByRole("button", { name: "Look at them" }));
    stop();
    expect(notes).toHaveLength(1);
    expect(notes[0]?.note).toMatch(/they chose to look/u);
    expect(notes[0]?.say).toContain("Tensorgate");
  });

  it("with nothing waiting: no buttons, just the open question", async () => {
    render(
      <ArrivalBriefing
        variant="page"
        load={() => Promise.resolve(QUIET)}
        now={() => MORNING}
      />,
    );
    await landed();
    expect(screen.queryByRole("button", { name: "Look at them" })).toBeNull();
    expect(
      document.querySelector("[data-arrival-lowdown]")?.textContent,
    ).toMatch(/What would you like to look at\?$/u);
    // A "yes" with nothing offered is just words for Q.
    expect(typedOpenerAnswer("yes", false)).toBe(false);
  });
});
