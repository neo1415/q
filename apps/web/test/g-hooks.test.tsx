// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { QAnswerCard, QAnswerCardsBlock } from "@capital-q/contracts";

import type { QTurn } from "../src/features/q/conversation";

vi.mock("next/navigation", () => ({
  usePathname: () => "/home",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

const { AnswerCanvas } = await import("../src/features/q/answer-canvas");
const { fitProvenance, tieLine, fitWords } =
  await import("../src/features/q/answer-canvas-logic");
const { boardTimeline } = await import("../src/features/q/board-timeline");
const { withShelf } = await import("../src/features/q/result-shelf");
const { shownItems } = await import("../src/features/q/shown");
const { dispositionOfFailure, dispositionOfTurn, outcomeWords } =
  await import("../src/features/q/turn-disposition");

/**
 * G's real-browser findings on INC-1 (2026-10-08): G-D18 (the Board read
 * 0 after the page moved conversation), G-D17 (mandate-fit wording not on
 * the card), G-R3 (each turn's disposition in the DOM).
 */

afterEach(cleanup);

const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function card(n: number, name: string, score: number): QAnswerCard {
  return {
    key: `c${String(n)}`,
    name,
    line: null,
    hue: n,
    fit: { score, measured: 5, of: 7 },
    reasons: ["Stage in range"],
    measures: [],
    view: null,
    said: null,
    sourceCount: 0,
    subject: { kind: "COMPANY", companyId: uuid(n) },
  };
}
const TOP: QAnswerCardsBlock = {
  kind: "ANSWER_CARDS",
  shape: "RANKED",
  title: "Mandate fit: your top three",
  cards: [
    card(1, "Ajopot", 8),
    card(2, "Ledgerfold", 8),
    card(3, "Clinicrest", 6),
  ],
  followUps: [],
};

function answer(
  id: string,
  runId: string,
  text: string,
  blocks: Extract<QTurn, { kind: "Q" }>["blocks"] = [],
  streaming = false,
): Extract<QTurn, { kind: "Q" }> {
  return {
    kind: "Q",
    id,
    runId,
    text,
    streaming,
    sourceCount: 0,
    publicSources: [],
    findings: [],
    uncertainties: [],
    blocks,
  };
}

describe("G-D17: a card says mandate fit, how it was made, and its tie", () => {
  it("in words, from the card's own fields", () => {
    const ajopot = TOP.cards[0];
    if (ajopot === undefined) throw new Error("fixture");
    expect(fitWords(ajopot)).toBe(
      "Mandate fit 8.0 out of 10, from 5 of 7 measures known",
    );
    expect(fitProvenance(ajopot)).toBe(
      "5 of 7 measures known · no source documents yet",
    );
    expect(tieLine(TOP, ajopot)).toBe(
      "Tied with Ledgerfold on mandate fit (8.0).",
    );
    const clinicrest = TOP.cards[2];
    if (clinicrest === undefined) throw new Error("fixture");
    expect(tieLine(TOP, clinicrest)).toBeNull();
  });

  it("on the card's face in the rendered canvas", () => {
    render(
      <AnswerCanvas
        block={TOP}
        asked="Top three for my mandate"
        said=""
        focus={-1}
        presence={null}
      />,
    );
    const text = document.querySelector("[data-ac-cards]")?.textContent ?? "";
    expect(text).toMatch(/mandate fit, out of 10/u);
    expect(text).toContain("5 of 7 measures known");
    expect(text).toContain("no source documents yet");
    expect(text).toContain("Tied with Ajopot on mandate fit (8.0).");
    expect(text).not.toMatch(/\d+ ?%/u);
  });
});

describe("G-D18: the Board keeps every set shown in this tab", () => {
  it("holds the ranked cards after the page moved to another conversation", () => {
    const first = [answer("a1", "run-1", "Your top three.", [TOP])];
    const kept = shownItems(first);
    // The reconnect: another conversation, holding only the attention answer.
    const now = [answer("a9", "run-9", "Two things need you.")];
    expect(boardTimeline(now)).toHaveLength(0);
    const board = boardTimeline(withShelf(now, kept));
    expect(board.map((entry) => entry.title)).toEqual([
      "Mandate fit: your top three",
    ]);
    // The same run already in the thread is never listed twice.
    expect(boardTimeline(withShelf(first, kept))).toHaveLength(1);
  });
});

describe("G-R3: every turn has a terminal disposition", () => {
  it("reads it from the turn, the run failure, or the voice outcome", () => {
    expect(dispositionOfTurn(answer("a", "r", "Here.", [TOP]))).toBe(
      "ANSWERED",
    );
    expect(dispositionOfTurn(answer("a", "r", "", [], true))).toBeNull();
    expect(
      dispositionOfTurn(
        answer("a", "r", "Which round?", [
          { kind: "CLARIFICATION_REQUEST", question: "Which round?" },
        ]),
      ),
    ).toBe("CLARIFIED");
    expect(dispositionOfFailure("Q_TIMEOUT")).toEqual({
      disposition: "FAILED",
      failure: "TIMEOUT",
    });
    expect(dispositionOfFailure("CANCELLED")).toEqual({
      disposition: "CANCELLED",
      failure: null,
    });
    // IGNORED is said, never silent.
    expect(outcomeWords({ disposition: "IGNORED" })).toMatch(/didn't take it/u);
    expect(
      outcomeWords({ disposition: "FAILED", notice: "Voice dropped." }),
    ).toBe("Voice dropped.");
  });
});

describe("G-R4: the attention answer, with what Q could not check", () => {
  it("renders each item and the unread sources, said and marked", async () => {
    const { QResultBlocks } = await import("../src/features/q/q-result-blocks");
    render(
      <QResultBlocks
        blocks={[
          {
            kind: "ATTENTION",
            report: {
              items: [
                {
                  key: "UNANSWERED_MESSAGE:1",
                  source: "UNANSWERED_MESSAGE",
                  title: "Zino Aviation is waiting for your reply",
                  since: "2026-10-08T09:00:00Z",
                  decidable: false,
                },
                {
                  key: "DOCUMENT_REQUEST:2",
                  source: "DOCUMENT_REQUEST",
                  title: "Apex asked for your cap table",
                  note: "Due Friday",
                  entity: { kind: "COMPANY", id: uuid(7) },
                  since: "2026-10-08T08:00:00Z",
                  decidable: false,
                },
              ],
              activity: null,
              unread: ["MEETING"],
              readAt: "2026-10-08T10:00:00Z",
            },
          },
        ]}
      />,
    );
    const items = [...document.querySelectorAll("[data-q-attention-item]")];
    expect(
      items.map((item) => item.getAttribute("data-q-attention-item")),
    ).toEqual(["UNANSWERED_MESSAGE", "DOCUMENT_REQUEST"]);
    expect(items[1]?.querySelector("a")?.getAttribute("href")).toBe(
      `/company/${uuid(7)}`,
    );
    expect(
      document
        .querySelector("[data-q-attention-unread]")
        ?.getAttribute("data-q-attention-unread"),
    ).toBe("MEETING");
    expect(
      document.querySelector("[data-q-attention-unread-line]")?.textContent,
    ).toBe("I couldn't check meetings just now.");
  });
});
