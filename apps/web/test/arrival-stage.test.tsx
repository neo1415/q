// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ArrivalData } from "../src/features/briefing/arrival";

/**
 * RECOVERY-2026-10 E1/E2 (audit E-01, E-02), in the rendered DOM.
 *
 * The Q page renders the arrival's cards as a layer of the stage: once,
 * beside its welcome and conversation branches. This harness has the same
 * shape as the page (QConversationPanel): a pre-conversation branch and a
 * conversing branch, each with its own columns and place below Q, and the
 * stage layer as their sibling. Live 2026-10-08 the cards were part of the
 * welcome and vanished the moment Q spoke its briefing; here the switch
 * happens and the cards, and the voice decider, are still there.
 */

// The reads are server actions; the stage is driven with fixed data.
vi.mock("../src/features/briefing/arrival-actions", () => ({
  arrivalBriefingAction: vi.fn(),
  decideArrivalCardAction: vi.fn(() =>
    Promise.resolve({ ok: true, message: "Sent." }),
  ),
  readArrivalWordsAction: vi.fn(() => Promise.resolve(null)),
}));
vi.mock("../src/components/app-shell/global-q", () => ({
  useGlobalQ: () => ({ askNow: vi.fn() }),
}));
const answerQuestionAction = vi.fn(() =>
  Promise.resolve({ ok: true, value: { status: "ANSWERED", remaining: 0 } }),
);
vi.mock("../src/features/readiness/readiness-actions", () => ({
  answerQuestionAction: (...args: unknown[]) =>
    (answerQuestionAction as (...a: unknown[]) => unknown)(...args),
  setAsideQuestionAction: vi.fn(() => Promise.resolve({ ok: true })),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock("../src/features/work/notice-store", () => ({
  useNotices: () => ({ items: null }),
}));

const { ArrivalStage } = await import("../src/features/briefing/arrival-stage");
const { ArrivalRoom, RoomBelow, StageModeProvider } =
  await import("../src/features/briefing/arrival-room");
const { resetArrival } = await import("../src/features/briefing/arrival-store");
const { resetArrivalGate } =
  await import("../src/features/briefing/arrival-gate");
const { cardInFocus } = await import("../src/features/voice/line-cards");
const { announceQSaid } = await import("../src/features/q-swarm/q-said");

const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const DATA: ArrivalData = {
  firstName: "Zino",
  timeZone: "Europe/London",
  activity: {
    sent: { n: 2, names: ["Halyard Security", "Apex Capital"] },
    booked: { n: 1, names: ["Northwind"] },
  },
  hoursAway: 20,
  cards: [
    {
      key: uuid(1),
      kind: "APPROVAL",
      approvalId: uuid(1),
      draftId: null,
      relationshipId: uuid(101),
      counterpart: "Halyard Security",
      named: null,
      title: "Reply ready to send",
      summary: "Reply to Halyard Security",
      message: "Thanks, Tuesday works.",
      theySaid: "Can we meet Tuesday?",
      reason: null,
      canDecide: true,
      at: "2026-10-08T09:00:00Z",
    },
    {
      key: uuid(2),
      kind: "APPROVAL",
      approvalId: uuid(2),
      draftId: null,
      relationshipId: uuid(102),
      counterpart: "Tensorgate",
      named: null,
      title: "Reply ready to send",
      summary: "Reply to Tensorgate",
      message: "Sharing the data room now.",
      theySaid: null,
      reason: null,
      canDecide: true,
      at: "2026-10-08T09:10:00Z",
    },
  ],
  waiting: [],
  attention: {
    items: [
      {
        key: `DOCUMENT_REQUEST:${uuid(9)}`,
        source: "DOCUMENT_REQUEST",
        title: "Apex asked for your cap table",
        since: "2026-10-08T08:00:00Z",
        decidable: false,
      },
    ],
    activity: null,
    unread: ["MEETING"],
    readAt: "2026-10-08T10:00:00Z",
  },
  attentionLinks: { [`DOCUMENT_REQUEST:${uuid(9)}`]: "/documents?request=1" },
  jobsDone: { n: 0, names: [] },
  matches: {
    label: "SINCE_LAST_VISIT",
    total: 2,
    items: [
      {
        companyId: uuid(21),
        name: "Kora Health",
        line: "Clinic software for East Africa",
        stage: "SEED",
        country: "KE",
        band: "GOOD_FIT",
        take: "A good fit with your mandate: it lines up on stage and sector. Cheque size isn't known yet. That's fit with your mandate, not a judgement of the business.",
      },
      {
        companyId: uuid(22),
        name: "Tamu Pay",
        line: null,
        stage: "PRE_SEED",
        country: "TZ",
        band: "PARTIAL_FIT",
        take: "A partial fit with your mandate. That's fit with your mandate, not a judgement of the business.",
      },
    ],
  },
};

const load = () => Promise.resolve(DATA);

/** The Q page's shape: two branches, the stage layer beside them. */
function Page() {
  const [conversing, setConversing] = useState(false);
  const [answerShown, setAnswerShown] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setConversing(true)}>
        speak
      </button>
      <button type="button" onClick={() => setAnswerShown((on) => !on)}>
        answer
      </button>
      {conversing ? (
        <div data-branch="conversing">
          <ArrivalRoom wide>
            <p>Q is speaking</p>
          </ArrivalRoom>
          <RoomBelow />
        </div>
      ) : (
        <div data-branch="welcome">
          <ArrivalRoom>
            <p>Q</p>
          </ArrivalRoom>
          <RoomBelow />
        </div>
      )}
      <StageModeProvider value={conversing && answerShown ? "STRIP" : "FULL"}>
        <ArrivalStage load={load} />
      </StageModeProvider>
    </div>
  );
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

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("E1: the arrival is a layer of the stage", () => {
  it("keeps the cards and the voice decider after the conversation starts", async () => {
    render(<Page />);
    await settle();
    expect(
      await screen.findByText("Replied to Halyard Security and Apex Capital"),
    ).toBeTruthy();
    expect(
      document.querySelector(`[data-arrival-card="${uuid(1)}"]`),
    ).not.toBeNull();
    expect(cardInFocus()).toBe(true);

    // Q's opener lands: the page switches to its conversing branch.
    fireEvent.click(screen.getByText("speak"));
    await settle();
    expect(document.querySelector('[data-branch="conversing"]')).not.toBeNull();
    expect(document.querySelector('[data-branch="welcome"]')).toBeNull();
    // The cards are still on screen, inside the conversing branch's place,
    // and a spoken "send it" still has a card to act on.
    const card = document.querySelector(`[data-arrival-card="${uuid(1)}"]`);
    expect(card).not.toBeNull();
    expect(card?.closest('[data-branch="conversing"]')).not.toBeNull();
    expect(
      screen.getByText("Replied to Halyard Security and Apex Capital"),
    ).toBeTruthy();
    expect(cardInFocus()).toBe(true);
  });

  it("steps aside into one line while an answer holds the centre, and comes back", async () => {
    render(<Page />);
    await settle();
    await screen.findByText("Kora Health");
    fireEvent.click(screen.getByText("speak"));
    fireEvent.click(screen.getByText("answer"));
    await settle();
    expect(
      document.querySelector('[data-arrival-stage="strip"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('[data-arrival-layout="strip"]')?.textContent,
    ).toContain("1 of 2");
    // The full card is gone from view, but the decider is still there.
    expect(
      document.querySelector(`[data-arrival-card="${uuid(1)}"]`),
    ).toBeNull();
    expect(cardInFocus()).toBe(true);
    // "Show" opens it in place; the answer leaving brings it back too.
    fireEvent.click(screen.getByText("answer"));
    await settle();
    expect(document.querySelector('[data-arrival-stage="strip"]')).toBeNull();
    expect(
      document.querySelector(`[data-arrival-card="${uuid(1)}"]`),
    ).not.toBeNull();
  });

  it("brings the card Q names into focus", async () => {
    render(<Page />);
    await settle();
    await screen.findByText("Kora Health");
    expect(
      document.querySelector(`[data-arrival-card="${uuid(2)}"]`),
    ).toBeNull();
    act(() => {
      announceQSaid("Tensorgate wants the data room link; I've drafted it.");
    });
    await settle();
    expect(
      document.querySelector(`[data-arrival-card="${uuid(2)}"]`),
    ).not.toBeNull();
    act(() => {
      announceQSaid("Tamu Pay is the other new one in your feed.");
    });
    await settle();
    expect(
      document.querySelector(`[data-arrival-match="${uuid(22)}"]`),
    ).not.toBeNull();
  });
});

describe("E2: the arrival says everything, true", () => {
  it("shows what Q did, what needs them (with what could not be read), and new matches with Q's take", async () => {
    render(<Page />);
    await settle();
    await screen.findByText("Kora Health");
    expect(screen.getByText("Booked your call with Northwind")).toBeTruthy();
    expect(screen.getByText("Apex asked for your cap table")).toBeTruthy();
    expect(
      document
        .querySelector("[data-arrival-attention] a")
        ?.getAttribute("href"),
    ).toBe("/documents?request=1");
    expect(document.querySelector("[data-arrival-unread]")?.textContent).toBe(
      "I couldn't check meetings just now.",
    );
    const match = document.querySelector(`[data-arrival-match="${uuid(21)}"]`);
    expect(match?.textContent).toContain("Q's take:");
    expect(match?.textContent).toContain("not a judgement of the business");
    expect(match?.textContent).not.toMatch(/\d+ ?%|\/10/u);
    expect(screen.getByText("New for you")).toBeTruthy();
    // Remembered, so the next arrival calls only what is new "new".
    expect(window.localStorage.getItem("cq.arrival.seen-matches")).toContain(
      uuid(21),
    );
  });
});

describe("Q.01: the questions Q still has stay beside Q", () => {
  it("shows a founder's pending question, answerable in place, before and after Q speaks", async () => {
    const founder: ArrivalData = {
      ...DATA,
      cards: [],
      attention: undefined,
      matches: undefined,
      questions: [
        {
          questionId: uuid(31),
          question: "What is your monthly burn?",
          why: "Investors ask this first.",
          reason: "MATERIAL_GAP",
          pillar: null,
          readings: [],
          quickAnswers: ["Under $20k", "$20k to $50k"],
          typed: "NUMBER",
          answerable: true,
          editHref: null,
          askedAt: "2026-10-07T09:00:00Z",
        },
      ],
    };
    function FounderPage() {
      const [conversing, setConversing] = useState(false);
      return (
        <div>
          <button type="button" onClick={() => setConversing(true)}>
            speak
          </button>
          {conversing ? <RoomBelow key="c" /> : <RoomBelow key="w" />}
          <StageModeProvider value="FULL">
            <ArrivalStage load={() => Promise.resolve(founder)} />
          </StageModeProvider>
        </div>
      );
    }
    render(<FounderPage />);
    await settle();
    expect(await screen.findByText("What is your monthly burn?")).toBeTruthy();
    expect(screen.getByText("Q still wants to know")).toBeTruthy();
    fireEvent.click(screen.getByText("speak"));
    await settle();
    expect(screen.getByText("What is your monthly burn?")).toBeTruthy();
    fireEvent.click(screen.getByText("Under $20k"));
    await settle();
    expect(answerQuestionAction).toHaveBeenCalledTimes(1);
  });
});
