import { describe, expect, it } from "vitest";

import type { QAnswerCardsBlock } from "@capital-q/contracts";

import { answerCardsBlock } from "../src/q/answer-cards.js";
import {
  fitSweepCardsBlock,
  fitSweepSummary,
  fitsInOutcome,
} from "../src/q/fit-cards.js";
import { asComparison, withFitIntegrity } from "../src/q/fit-integrity.js";
import { fitFixture } from "./fit-fixture.js";

/**
 * Investor journeys on production, 2026-10-12 (savanna-seed):
 *   D7 "Compare Ledgerfold and F2 side by side" came back as RANKED cards
 *      ("Here are the same two companies, ranked") instead of the table.
 *   D2 every card's spoken line was scoring boilerplate, with a "good 7.5"
 *      the platform's fit scale does not have.
 */

const LEDGERFOLD = "3ab2cc02-160f-4812-a6b1-000000000001";
const F2 = "3ab2cc02-160f-4812-a6b1-000000000002";

function platformFits() {
  return [
    ...fitsInOutcome(
      fitFixture(F2, "F2", {
        STAGE: "STRONG",
        SECTOR: "STRONG",
        GEOGRAPHY: "PARTIAL",
        TRACTION: "PARTIAL",
      }),
    ),
    ...fitsInOutcome(
      fitFixture(LEDGERFOLD, "Ledgerfold", {
        STAGE: "STRONG",
        SECTOR: "STRONG",
        GEOGRAPHY: "STRONG",
        TRACTION: "PARTIAL",
      }),
    ),
  ];
}

const ASKED = "Compare Ledgerfold and F2 side by side";

describe("D7: an explicit comparison is the comparison table", () => {
  it("two named companies come back SIDE_BY_SIDE, in the order asked", () => {
    const ranked = fitSweepCardsBlock(
      platformFits(),
      "Fit against your mandate",
    );
    if (ranked === null) throw new Error("no block");
    expect(ranked.shape).toBe("RANKED");
    const compared = asComparison(ranked, ASKED);
    expect(compared.shape).toBe("SIDE_BY_SIDE");
    expect(compared.cards.map((card) => card.name)).toEqual([
      "Ledgerfold",
      "F2",
    ]);
    const text = fitSweepSummary({
      block: compared,
      scope: "PREVIOUS",
      place: null,
      considered: 2,
      asked: ASKED,
    });
    expect(text).not.toMatch(/ranked/iu);
    expect(text).toMatch(/side by side/iu);
    expect(text).toContain("Ledgerfold");
    expect(text).toContain("F2");
  });

  it("a model's RANKED cards for the same words become the table too", () => {
    const model = answerCardsBlock({
      shape: "RANKED",
      title: "Closest to your mandate",
      cards: ["F2", "Ledgerfold", "Ajopot"].map((name) => ({
        name,
        line: null,
        reasons: ["Fits the stage."],
        measures: [
          { label: "Stage", level: "STRONG", value: null },
          { label: "Sector", level: "GOOD", value: null },
          { label: "Traction", level: "PARTIAL", value: null },
        ],
        view: null,
        said: null,
        citations: [],
      })),
      followUps: [],
    });
    if (model === null) throw new Error("no block");
    const [out] = withFitIntegrity([model], { asked: ASKED, previous: [] });
    if (out?.kind !== "ANSWER_CARDS") throw new Error("no cards");
    expect(out.shape).toBe("SIDE_BY_SIDE");
    expect(out.cards.map((card) => card.name)).toEqual(["Ledgerfold", "F2"]);
  });

  it("a ranking request stays a ranking", () => {
    const ranked = fitSweepCardsBlock(
      platformFits(),
      "Fit against your mandate",
    );
    if (ranked === null) throw new Error("no block");
    expect(asComparison(ranked, "Rank Ledgerfold and F2 for me").shape).toBe(
      "RANKED",
    );
    expect(asComparison(ranked, "Compare the top two").shape).toBe("RANKED");
  });
});

describe("D2: a card's spoken line leads with the insight", () => {
  const said = (block: QAnswerCardsBlock, name: string) => {
    const [out] = withFitIntegrity([block], { asked: "top two", previous: [] });
    if (out?.kind !== "ANSWER_CARDS") throw new Error("no cards");
    return out.cards.find((card) => card.name === name)?.said ?? "";
  };

  it("platform fit: insight first, labelled mandate fit, the platform's own scale", () => {
    const block = fitSweepCardsBlock(
      platformFits(),
      "Fit against your mandate",
    );
    if (block === null) throw new Error("no block");
    const line = said(block, "Ledgerfold");
    // (10 + 10 + 10 + 4) / 4 = 8.5: the number is the computed one.
    expect(line).toMatch(
      /^Ledgerfold is strong on stage, sector and geography, partial on traction/u,
    );
    expect(line).toContain("mandate fit 8.5 out of 10");
    expect(line).toContain("not a quality score");
    expect(line).not.toMatch(/good 7\.5/u);
    expect(line).toMatch(/strong 10, partial 4, mismatch 0/u);
    expect(line.length).toBeLessThanOrEqual(300);
  });

  it("a model-measured card says its own scale, distinct from the platform's", () => {
    const block = answerCardsBlock({
      shape: "RANKED",
      title: "Closest to your mandate",
      cards: [
        {
          name: "Ajopot",
          line: null,
          reasons: ["Fits the stage."],
          measures: [
            { label: "Stage", level: "STRONG", value: null },
            { label: "Sector", level: "GOOD", value: null },
            { label: "Traction", level: "PARTIAL", value: null },
          ],
          view: null,
          said: "Ajopot is a 9.9 out of 10, the best company.",
          citations: [],
        },
      ],
      followUps: [],
    });
    if (block === null) throw new Error("no block");
    const line = said(block, "Ajopot");
    expect(line).toMatch(/^Ajopot is strong on stage, good on sector/u);
    expect(line).not.toContain("9.9");
    expect(line).toContain("7.2 out of 10");
    expect(line).toMatch(/good 7\.5/u);
    expect(line).toMatch(/Q's reading/u);
  });
});

describe("QA U2: no mandate fit or comparison table for things that are not records", () => {
  // Live 24 Oct 2026, run ae00a0fa: a founder's two pitch videos.
  const videos = () => {
    const block = answerCardsBlock({
      shape: "SIDE_BY_SIDE",
      title: "Maji Loop pitch videos",
      cards: ["Maji Loop pitch video", "Maji Loop: pitch summary"].map(
        (name) => ({
          name,
          line: null,
          reasons: ["Covers the product and the raise."],
          measures: [
            { label: "Investor access", level: "GOOD", value: null },
            { label: "Story coverage", level: "GOOD", value: null },
            { label: "Evidence depth", level: "PARTIAL", value: null },
          ],
          view: null,
          said: null,
          citations: [],
        }),
      ),
      followUps: [],
    });
    if (block === null) throw new Error("no block");
    return block;
  };

  it("a founder's pitch videos carry no mandate fit and are not the comparison table", () => {
    const [out] = withFitIntegrity([videos()], {
      asked: "How is my pitch video doing, and how can I make it better?",
      previous: [],
      mandate: false,
    });
    if (out?.kind !== "ANSWER_CARDS") throw new Error("no cards");
    expect(out.cards.every((card) => card.fit === null)).toBe(true);
    expect(out.title).not.toMatch(/mandate fit/iu);
    expect(out.shape).toBe("RANKED");
  });

  it("an investor's comparison of companies they named stays the table", () => {
    const [out] = withFitIntegrity([videos()], {
      asked: "Compare Maji Loop pitch video and Maji Loop: pitch summary",
      previous: [],
      mandate: true,
    });
    if (out?.kind !== "ANSWER_CARDS") throw new Error("no cards");
    expect(out.shape).toBe("SIDE_BY_SIDE");
  });
});
