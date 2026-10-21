// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
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
  it("keeps the server's heading when the read lands: the greeting never swaps (speed lane 2026-10-20)", async () => {
    let land: (data: ArrivalData) => void = () => undefined;
    const reading = new Promise<ArrivalData>((resolve) => {
      land = resolve;
    });
    render(
      <ArrivalBriefing
        variant="page"
        headline="Welcome back, Laura."
        fallback={<h1>Welcome back, Laura.</h1>}
        load={() => reading}
        now={() => MORNING}
      />,
    );
    expect(screen.getByRole("heading").textContent).toBe(
      "Welcome back, Laura.",
    );
    await act(async () => {
      land(BUSY);
      await Promise.resolve();
      await Promise.resolve();
    });
    // The briefing has landed (its opener is ready for the voice) and the
    // heading on screen is the same words.
    expect(arrivalSpoken()).toMatch(/You have 3 things waiting./u);
    expect(screen.getByRole("heading").textContent).toBe(
      "Welcome back, Laura.",
    );
  });

  // Owner 2026-10-17: the Q page is a greeting and one open question, like
  // a chat app's first screen; what waits comes up when they ask for it.
  it("greets and asks one open question: no buttons, no cards until they ask", async () => {
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
    expect(document.querySelector("[data-arrival-lowdown]")?.textContent).toBe(
      "What's on your mind today?",
    );
    expect(document.body.textContent).not.toContain("Spheros");
    expect(document.querySelector("[data-arrival-card]")).toBeNull();
    expect(screen.queryByRole("button", { name: "Look at them" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Something else" })).toBeNull();
    // A voice line still opens by saying what waits.
    expect(arrivalSpoken()).toMatch(/You have 3 things waiting\./u);
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
    expect(openerShowsCards()).toBe(true);
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
  });

  it("with nothing waiting: the same open question", async () => {
    render(
      <ArrivalBriefing
        variant="page"
        load={() => Promise.resolve(QUIET)}
        now={() => MORNING}
      />,
    );
    await landed();
    expect(document.querySelector("[data-arrival-lowdown]")?.textContent).toBe(
      "What's on your mind today?",
    );
    // A "yes" with nothing offered is just words for Q.
    expect(typedOpenerAnswer("yes", false)).toBe(false);
  });
});
