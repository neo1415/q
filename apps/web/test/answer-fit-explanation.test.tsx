// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  fitScoreOutOf10,
  type FitOutcome,
  type QAnswerCard,
  type QAnswerCardsBlock,
} from "@capital-q/contracts";

import { AnswerCanvas } from "../src/features/q/answer-canvas";
import { demoTop } from "../src/features/q/answer-canvas-fixtures";
import {
  FIT_LEVEL_POINTS,
  fitExplanation,
  playbackSteps,
  spokenLine,
} from "../src/features/q/answer-canvas-logic";

/**
 * 2026-10-12 investor test: an "8.8" mandate fit with no way to see what
 * it measured. The card explains the score it already shows (what it
 * measures, what each measure added, what was unknown, the method),
 * closed by default, and never computes a different number.
 */

afterEach(cleanup);

const LABELS = [
  "Stage",
  "Sector",
  "Geography",
  "Cheque compatibility",
  "Business model",
  "Thesis",
  "Round terms",
] as const;

/** The shape of the live 8.8 card: 4 Strong, 1 Partial, 2 Unknown of 7. */
function liveCard(said: string | null): QAnswerCard {
  const levels = [
    "STRONG",
    "STRONG",
    "STRONG",
    "UNKNOWN",
    "STRONG",
    "PARTIAL",
    "UNKNOWN",
  ] as const;
  return {
    key: "souqsheet",
    name: "Souqsheet",
    line: "seed · Nigeria",
    hue: 1,
    fit: { score: 8.8, measured: 5, of: 7 },
    reasons: ["Raising seed; you invest at seed."],
    measures: LABELS.map((label, at) => ({
      label,
      level: levels[at] ?? "UNKNOWN",
      value: null,
    })),
    view: null,
    said,
    sourceCount: 0,
    subject: null,
  };
}

const PROVENANCE =
  "Souqsheet: mandate fit 8.8 out of 10, not a quality score. 5 of 7 measures known (strong 10, good 7.5, partial 4, mismatch 0; unknown left out). No source documents yet.";

describe("fitExplanation", () => {
  it("shows how the live 8.8 is made: four Strong, one Partial, two unknown", () => {
    const how = fitExplanation(liveCard(null));
    expect(how?.score).toBe("8.8");
    expect(how?.sum).toBe("(10 + 10 + 10 + 10 + 4) ÷ 5 = 8.8");
    expect(how?.unknown).toEqual(["Cheque compatibility", "Round terms"]);
    // Good never occurs on a platform fit card, so the scale omits it.
    expect(how?.scale).toBe("Strong 10, Partial 4, Does not match 0");
  });

  it("uses the canonical platform points (ADR 0059 fitScoreOutOf10)", () => {
    const outcomes: FitOutcome[] = [
      "STRONG",
      "STRONG",
      "STRONG",
      "UNKNOWN",
      "STRONG",
      "PARTIAL",
      "UNKNOWN",
    ];
    const canonical = fitScoreOutOf10({
      band: "GOOD_FIT",
      parameters: outcomes.map((outcome) => ({ outcome })),
    });
    expect(canonical).toBe("8.8");
    expect(FIT_LEVEL_POINTS.STRONG).toBe(10);
    expect(FIT_LEVEL_POINTS.PARTIAL).toBe(4);
    expect(FIT_LEVEL_POINTS.MISMATCH).toBe(0);
  });

  it("never shows a sum that disagrees with the stored score", () => {
    const card = liveCard(null);
    const how = fitExplanation({
      ...card,
      fit: { score: 7.1, measured: 5, of: 7 },
    });
    expect(how?.sum).toBeNull();
    expect(how?.score).toBe("7.1");
  });

  it("has nothing to explain without a score", () => {
    expect(fitExplanation({ ...liveCard(null), fit: null })).toBeNull();
  });
});

describe("what Q says about a scored card", () => {
  it("leads with the insight, not the scoring method", () => {
    expect(spokenLine(liveCard(PROVENANCE))).toBe(
      "Souqsheet, 8.8 on mandate fit: Raising seed; you invest at seed.",
    );
    const block: QAnswerCardsBlock = {
      kind: "ANSWER_CARDS",
      shape: "RANKED",
      title: "Mandate fit: top one",
      cards: [liveCard(PROVENANCE)],
      followUps: [],
    };
    expect(playbackSteps(block, "")[0]?.said).not.toContain("good 7.5");
  });

  it("keeps Q's own line about a card", () => {
    const own = "Souqsheet is the one to look at first.";
    expect(spokenLine(liveCard(own))).toBe(own);
  });
});

describe("the card", () => {
  it("offers the explanation closed, and opens it on request", () => {
    const block: QAnswerCardsBlock = {
      kind: "ANSWER_CARDS",
      shape: "RANKED",
      title: "Mandate fit: top one",
      cards: [liveCard(PROVENANCE)],
      followUps: [],
    };
    render(<AnswerCanvas block={block} focus={0} said="" />);
    const how = document.querySelector("[data-ac-fit-how]");
    expect(how).not.toBeNull();
    expect((how as HTMLDetailsElement).open).toBe(false);
    const summary = screen.getByText("How 8.8 is worked out");
    fireEvent.click(summary);
    expect(screen.getByText("(10 + 10 + 10 + 10 + 4) ÷ 5 = 8.8")).toBeTruthy();
    expect(
      screen.getByText(/Not known yet: Cheque compatibility, Round terms\./u),
    ).toBeTruthy();
    expect(
      screen.getByText(/It is not a judgement of the business\./u),
    ).toBeTruthy();
  });

  it("explains every scored card of a demo answer", () => {
    render(<AnswerCanvas block={demoTop(3)} focus={0} said="" />);
    expect(
      document.querySelectorAll("[data-ac-fit-how]").length,
    ).toBeGreaterThan(0);
  });
});
