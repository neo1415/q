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
const { openerOf, pendingCount, readOpenerReply, waitingPhrases } =
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
  // Owner 2026-11-06 replaces 2026-10-16's "never the list": the opener
  // names what waits (at most three, then "and N more"), never "N things".
  it("greets by first name and names what waits in one sentence", () => {
    const words = arrivalWords(BUSY, MORNING, null);
    expect(words.opener.pending).toBe(3);
    expect(words.spoken).toMatch(/^Good morning, Laura\. /u);
    expect(words.spoken).toMatch(
      / Three things need you: approve the reply to Tensorgate, approve the reply to Spheros and Apex asked for your cap table\. Would you like to look at them now, or talk about something else\?$/u,
    );
    expect(words.spoken).not.toMatch(/things waiting/u);
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
      "One thing needs you: approve the reply to Tensorgate. Would you like to look at it now, or talk about something else?",
    );
    const partial = openerOf({
      ...BUSY,
      attention: { ...ATTENTION, unread: ["MEETING"] },
    });
    expect(partial.count).toBe(
      "At least three things need you: approve the reply to Tensorgate, approve the reply to Spheros and Apex asked for your cap table.",
    );
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

describe("what waits, named (owner 2026-11-06)", () => {
  it("names at most three, then says how many more", () => {
    const opener = openerOf({
      ...QUIET,
      cards: [
        card(1, "Brightwell"),
        card(2, "Ledgerfold"),
        card(3, "Spheros"),
        card(4, "Tensorgate"),
        card(5, "Halyard"),
      ],
    });
    expect(opener.count).toBe(
      "Five things need you: approve the reply to Brightwell, approve the reply to Ledgerfold, approve the reply to Spheros and 2 more.",
    );
  });

  it("says a held message as held, and never a bare count", () => {
    const opener = openerOf({
      ...QUIET,
      cards: [
        { ...card(1, "Spheros"), kind: "HELD", title: "Q held a message" },
      ],
    });
    expect(opener.count).toBe(
      "One thing needs you: a message to Spheros that Q held back.",
    );
    expect(opener.line).not.toMatch(/\d+ things? waiting/u);
  });

  it("names exactly what it counts, from the data it already holds", () => {
    for (const data of [BUSY, QUIET]) {
      const phrases = waitingPhrases(data);
      expect(phrases.reduce((sum, phrase) => sum + phrase.weight, 0)).toBe(
        pendingCount(data),
      );
    }
  });

  it("'what are they?' is the answer to look, from the held list", () => {
    expect(readOpenerReply("What are they?")).toBe("SHOW");
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
    expect(arrivalSpoken()).toMatch(/Three things need you: /u);
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
    expect(arrivalSpoken()).toMatch(/Three things need you: /u);
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

  it("an 'okay' typed once the conversation has turns is for Q, not the welcome (J4)", async () => {
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
      consumed = typedOpenerAnswer("okay", false, true);
    });
    expect(consumed).toBe(false);
    expect(openerShowsCards()).toBe(false);
    expect(document.querySelector("[data-arrival-card]")).toBeNull();
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
