// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AnswerCanvas } from "../src/features/q/answer-canvas";
import {
  DEMO_COMPARE,
  DEMO_RESEARCH,
  demoTop,
} from "../src/features/q/answer-canvas-fixtures";
import {
  answerChipFor,
  canvasLayout,
  comparesAsTable,
  focusForSaid,
  playbackSteps,
  topicMovedOn,
} from "../src/features/q/answer-canvas-logic";
import { boardTimeline, groupByDay } from "../src/features/q/board-timeline";
import type { QTurn } from "../src/features/q/conversation";
import { announceQSaid } from "../src/features/q-swarm/q-said";
import { useAnswerPlayback } from "../src/features/q/use-answer-playback";

/**
 * Q's answer as cards (C1-C4, C6, C7): the layout for any number of
 * cards, which card is open while Q talks, closing, the topic moving on
 * to the Board, the chip on other pages and the Board's timeline.
 */

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const person = (id: string, text: string): QTurn => ({
  kind: "PERSON",
  id,
  text,
  unconfirmed: false,
});
const answer = (
  id: string,
  text: string,
  blocks: Extract<QTurn, { kind: "Q" }>["blocks"] = [],
): QTurn => ({
  kind: "Q",
  id,
  at: "2026-10-05T21:04:00.000Z",
  text,
  streaming: false,
  sourceCount: 2,
  publicSources: [],
  findings: [],
  uncertainties: [],
  blocks,
});

describe("layout for 1, 3, 5 and 10 cards (C1)", () => {
  it("is a row on a desktop up to five, then the focused card beside a grid", () => {
    expect([1, 3, 5, 10].map((n) => canvasLayout(n, true).layout)).toEqual([
      "row",
      "row",
      "row",
      "grid",
    ]);
  });

  it("turns the rest into half-width tiles on a phone from four cards", () => {
    expect([1, 3, 5, 10].map((n) => canvasLayout(n, false).tiles)).toEqual([
      false,
      false,
      true,
      true,
    ]);
  });

  it("shows a comparison with shared measures as one table", () => {
    expect(comparesAsTable(DEMO_COMPARE)).toBe(true);
    expect(comparesAsTable(demoTop(3))).toBe(false);
  });
});

describe("the card Q is talking about (C2)", () => {
  const cards = demoTop(3).cards;

  it("is the card the sentence names first, as a whole name", () => {
    expect(
      focusForSaid(cards, "Kestrel Heat is close behind Norrland Grid."),
    ).toBe(1);
    expect(focusForSaid(cards, "atlas ledger's revenue is a claim")).toBe(2);
    expect(focusForSaid(cards, "Three stand out.")).toBeNull();
  });

  it("walks through each card, then the overview, at speaking pace", () => {
    const steps = playbackSteps(demoTop(3), "Want them side by side?");
    expect(steps.map((step) => step.focus)).toEqual([0, 1, 2, -1]);
    expect(steps[0]?.ms).toBeGreaterThanOrEqual(2600);
  });

  it("follows the timed walk-through, and stops where the person taps", () => {
    vi.useFakeTimers();
    const block = demoTop(3);
    const { result } = renderHook(() =>
      useAnswerPlayback(block, "a1", "Want them side by side?", false),
    );
    expect(result.current.focus).toBe(0);
    act(() => {
      vi.advanceTimersByTime(playbackSteps(block, "").at(0)?.ms ?? 0);
    });
    expect(result.current.focus).toBe(1);
    act(() => result.current.choose(2));
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(result.current.focus).toBe(2);
  });

  it("follows Q's own spoken lines on a live voice line", () => {
    const block = demoTop(3);
    const { result } = renderHook(() =>
      useAnswerPlayback(block, "a1", "Want them side by side?", true),
    );
    expect(result.current.focus).toBe(-1);
    act(() => announceQSaid("Atlas Ledger fits the sector."));
    expect(result.current.focus).toBe(2);
    expect(result.current.said).toBe("Atlas Ledger fits the sector.");
    act(() => announceQSaid("That's the three."));
    expect(result.current.focus).toBe(2);
  });
});

describe("the canvas (C1, C3)", () => {
  it("offers Open profile on a card with a company behind it, and opens it (R0)", () => {
    const block = demoTop(2);
    const companyId = "0a8b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
    const withSubject = {
      ...block,
      cards: block.cards.map((card, index) =>
        index === 0
          ? { ...card, subject: { kind: "COMPANY" as const, companyId } }
          : card,
      ),
    };
    const opened: string[] = [];
    render(
      <AnswerCanvas
        block={withSubject}
        focus={0}
        said=""
        onOpenProfile={(card) => {
          if (card.subject?.kind === "COMPANY") {
            opened.push(card.subject.companyId);
          }
        }}
      />,
    );
    const buttons = document.querySelectorAll("[data-ac-open-profile]");
    expect(buttons).toHaveLength(1);
    fireEvent.click(buttons[0] as Element);
    expect(opened).toEqual([companyId]);
  });

  it("opens the focused card with its reasons, fit in words and measure words", () => {
    render(
      <AnswerCanvas block={demoTop(3)} focus={0} said="Norrland fits best." />,
    );
    const cards = document.querySelectorAll("[data-ac-card]");
    expect([...cards].map((card) => card.getAttribute("data-state"))).toEqual([
      "focus",
      "rest",
      "rest",
    ]);
    expect(
      screen.getByRole("img", {
        name: /Fit 8.6 out of 10, from 5 of 6 measures known/u,
      }),
    ).toBeTruthy();
    expect(screen.getAllByText("Unknown").length).toBeGreaterThan(0);
    expect(
      screen.getAllByText("Seed round inside your cheque range").length,
    ).toBeGreaterThan(0);
  });

  it("has an X on every card and one on the whole answer", () => {
    const onCloseCard = vi.fn();
    const onCloseAll = vi.fn();
    render(
      <AnswerCanvas
        block={demoTop(3)}
        focus={0}
        said="Three stand out."
        onCloseCard={onCloseCard}
        onCloseAll={onCloseAll}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Close Kestrel Heat" }));
    expect(onCloseCard).toHaveBeenCalledWith("kestrel");
    fireEvent.click(screen.getByRole("button", { name: "Close this answer" }));
    expect(onCloseAll).toHaveBeenCalledOnce();
  });

  it("drops a dismissed card from the layout", () => {
    render(
      <AnswerCanvas
        block={demoTop(5)}
        focus={0}
        dismissed={new Set(["morrow"])}
      />,
    );
    expect(
      document.querySelector("[data-ac-cards]")?.getAttribute("data-n"),
    ).toBe("4");
    expect(document.querySelector('[data-ac-card="morrow"]')).toBeNull();
  });

  it("shows research with no score, and follow-ups only on the overview", () => {
    const onFollowUp = vi.fn();
    const { rerender } = render(
      <AnswerCanvas block={DEMO_RESEARCH} focus={0} onFollowUp={onFollowUp} />,
    );
    expect(screen.queryByText("fit, out of 10")).toBeNull();
    expect(document.querySelector("[data-ac-followups]")).toBeNull();
    rerender(
      <AnswerCanvas block={DEMO_RESEARCH} focus={-1} onFollowUp={onFollowUp} />,
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Which YC companies fit my mandate?",
      }),
    );
    expect(onFollowUp).toHaveBeenCalledWith(
      "Which YC companies fit my mandate?",
    );
  });
});

describe("the topic moves on (C4)", () => {
  const cards = [{ ...demoTop(3), kind: "ANSWER_CARDS" as const }];
  it("keeps the cards for a follow-up that names one of them", () => {
    const turns = [
      person("p1", "Top three"),
      answer("a1", "Three stand out.", cards),
      person("p2", "Why is Atlas third?"),
      answer("a2", "Atlas Ledger's revenue is only a claim."),
    ];
    expect(topicMovedOn(turns, "a1")).toBe(false);
  });

  it("sends them to the Board when the next answer is about something else", () => {
    const turns = [
      person("p1", "Top three"),
      answer("a1", "Three stand out.", cards),
      person("p2", "What's on tomorrow?"),
      answer("a2", "Two meetings tomorrow."),
    ];
    expect(topicMovedOn(turns, "a1")).toBe(true);
  });

  it("replaces them when a new answer brings cards of its own", () => {
    const turns = [
      answer("a1", "Three stand out.", cards),
      answer("a2", "Here is the research.", [DEMO_RESEARCH]),
    ];
    expect(topicMovedOn(turns, "a1")).toBe(true);
  });
});

describe("the chip on other pages (C6)", () => {
  const turns = [answer("a1", "Three stand out.", [demoTop(3)])];
  it("names a new answer, its companies and colours", () => {
    expect(answerChipFor(turns, new Set(), new Set())).toEqual({
      answerId: "a1",
      heading: "Top three ready",
      names: "Norrland, Kestrel, Atlas",
      hues: [1, 2, 3],
    });
  });
  it("is not shown for an answer already there, or dismissed", () => {
    expect(answerChipFor(turns, new Set(["a1"]), new Set())).toBeNull();
    expect(answerChipFor(turns, new Set(), new Set(["a1"]))).toBeNull();
  });
});

describe("the Board's timeline (C7)", () => {
  it("keeps what Q showed, newest first, with minis and folded sources", () => {
    const turns = [
      person("p1", "Research Y Combinator"),
      answer("a1", "Y Combinator invests early. It runs batches.", [
        DEMO_RESEARCH,
      ]),
      person("p2", "hello"),
      answer("a2", "Hi."),
      person("p3", "Top three"),
      answer("a3", "Three stand out. Norrland leads.", [demoTop(3)]),
    ];
    const entries = boardTimeline(turns);
    expect(entries.map((entry) => entry.id)).toEqual(["a3", "a1"]);
    expect(entries[0]?.kind).toBe("Ranked answer, 3 results");
    expect(entries[0]?.minis[0]).toEqual({
      name: "Norrland Grid",
      hue: 1,
      score: "8.6",
    });
    expect(entries[1]?.kind).toBe("Research, 3 parts");
    expect(entries[0]?.sources[0]?.title).toBe("2 records on Capital Q");
    expect(groupByDay(entries, new Date("2026-10-05T23:00:00Z"))[0]?.day).toBe(
      "Today",
    );
  });
});
