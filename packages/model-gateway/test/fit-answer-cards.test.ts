import { describe, expect, it } from "vitest";

import { withoutRecommendationClaims } from "@capital-q/q-core";

import {
  cardRaiseWords,
  fitAnswerCardsBlock,
  fitSweepCardsBlock,
  fitCardsSummary,
  fitsInOutcome,
  groundedFitWords,
  hasOrphanListItems,
  type RunFit,
} from "../src/q/fit-cards.js";
import { analystResultBlocks } from "../src/q/result-blocks.js";

import { fitFixture } from "./fit-fixture.js";

/**
 * Zino live 2026-10-07 (run 1d4f4c27): "List the companies… and their
 * scores against the mandate, including pros and cons" came back as
 * "Pros: … Cons: …" with no names and no cards, plus a "Q would like to
 * know" card beside the answer.
 */

const PORTSIDE = fitFixture(
  "7b62eab6-39b9-4cb6-884a-878301f6928f",
  "Portside",
  {
    STAGE: "STRONG",
    SECTOR: "STRONG",
    BUSINESS_MODEL: "STRONG",
    GEOGRAPHY: "PARTIAL",
  },
);
const BARIDI = fitFixture("7e5a7a76-857a-4528-9641-08c7bab9cc22", "Baridi", {
  STAGE: "STRONG",
  SECTOR: "STRONG",
  GEOGRAPHY: "STRONG",
  BUSINESS_MODEL: "MISMATCH",
});
const NSUO = fitFixture(
  "b439cd80-55d4-491a-922f-95650c38a056",
  "Nsuo Labs",
  { STAGE: "STRONG", GEOGRAPHY: "STRONG", SECTOR: "PARTIAL" },
  "PARTIAL_FIT",
);

const ZINO_FITS: readonly RunFit[] = [PORTSIDE, BARIDI, NSUO].flatMap(
  (outcome) => fitsInOutcome(outcome),
);

describe("answer cards from this run's fits", () => {
  it("keeps Round Terms and counts all applicable canonical parameters", () => {
    const fits = fitsInOutcome(PORTSIDE);
    const card = fitSweepCardsBlock(fits, "Mandate fit")?.cards[0];
    expect(card?.measures).toHaveLength(9);
    expect(card?.measures.at(-1)).toMatchObject({ level: "UNKNOWN" });
    expect(card?.fit).toEqual({ score: 8.5, measured: 4, of: 9 });
  });

  it("counts a known ninth parameter among the evidence behind the canonical score", () => {
    const fits = fitsInOutcome(
      fitFixture("7b62eab6-39b9-4cb6-884a-878301f6928f", "Portside", {
        STAGE: "STRONG",
        SECTOR: "STRONG",
        ROUND_TERMS: "PARTIAL",
      }),
    );
    const card = fitSweepCardsBlock(fits, "Mandate fit")?.cards[0];
    expect(card?.fit).toEqual({ score: 8, measured: 3, of: 9 });
    expect(card?.measures.at(-1)).toMatchObject({ level: "PARTIAL" });
  });
  it("builds ranked cards with names, a score out of 10 and one-line pros and cons", () => {
    const block = fitAnswerCardsBlock(ZINO_FITS, "Here are the companies.");
    expect(block).not.toBeNull();
    expect(block?.shape).toBe("RANKED");
    const names = block?.cards.map((card) => card.name) ?? [];
    expect(names).toEqual(["Portside", "Nsuo Labs", "Baridi"]);
    for (const card of block?.cards ?? []) {
      expect(card.fit?.score).toBeGreaterThan(0);
      expect(card.fit?.score).toBeLessThanOrEqual(10);
      expect(card.reasons.length).toBeGreaterThan(0);
      expect(card.subject?.kind).toBe("COMPANY");
      expect(card.said).toMatch(/out of 10/u);
    }
    // A known mismatch remains negative evidence, never an unknown or partial.
    expect(block?.cards[2]?.reasons.at(-1)).toMatch(/outside your mandate/u);
    expect(
      block?.cards[2]?.measures.find((m) => m.label === "Business model")
        ?.level,
    ).toBe("MISMATCH");
    expect(block?.cards[2]?.fit).toEqual({ score: 7.5, measured: 4, of: 9 });
  });

  it("keeps to the companies the answer names, and needs at least two", () => {
    const block = fitAnswerCardsBlock(ZINO_FITS, "Portside and Nsuo Labs.");
    expect(block?.cards.map((card) => card.name)).toEqual([
      "Portside",
      "Nsuo Labs",
    ]);
    expect(fitAnswerCardsBlock(ZINO_FITS.slice(0, 1), "Portside.")).toBeNull();
  });

  it("lets the platform's own score stand in the words, and still removes an invented one", () => {
    const computed = groundedFitWords(ZINO_FITS);
    const portside = fitAnswerCardsBlock(ZINO_FITS, "")?.cards.find(
      (card) => card.name === "Portside",
    );
    const score = String(portside?.fit?.score).replace(/\.0$/u, "");
    const text = `Portside is ${score}/10, a good fit. Tarmacly is 9/10.`;
    const guarded = withoutRecommendationClaims(text, {
      dimensions: [],
      computed,
    });
    expect(guarded.text).toContain("Portside");
    expect(guarded.text).not.toContain("Tarmacly");
    expect(guarded.removed).toBe(1);
  });

  it("says the gist by name when the guard left orphan pros and cons", () => {
    expect(hasOrphanListItems("Pros: seed stage. Cons: round unknown.")).toBe(
      true,
    );
    expect(hasOrphanListItems("Portside's pros: seed stage.")).toBe(false);
    const block = fitAnswerCardsBlock(ZINO_FITS, "");
    const summary = block === null ? "" : fitCardsSummary(block);
    expect(summary).toMatch(/^I've scored 3 companies/u);
    expect(summary).toContain("Portside and Nsuo Labs");
    expect(summary).toMatch(/on screen/u);
  });
});

describe("a question back beside an answer", () => {
  const question = { question: "Want me to fetch Termly's profile next?" };

  it("is no card when Q answered", () => {
    const blocks = analystResultBlocks({
      result: {
        answer:
          "I've reached out to eight companies so far. Portside and Souqsheet fit your mandate best; the other six are earlier or outside your sectors. They're on screen with pros and cons.",
        insufficientEvidence: false,
        clarifyingQuestions: [question],
      },
      subjects: [],
    });
    expect(
      (blocks ?? []).some((block) => block.kind === "CLARIFICATION_REQUEST"),
    ).toBe(false);
  });

  it("is a card only when Q genuinely could not answer", () => {
    const blocks = analystResultBlocks({
      result: {
        answer: "I couldn't tell which fund you meant.",
        insufficientEvidence: true,
        clarifyingQuestions: [question],
      },
      subjects: [],
    });
    expect(
      (blocks ?? []).some((block) => block.kind === "CLARIFICATION_REQUEST"),
    ).toBe(true);
  });
});

describe("R2: Q's company card says the raise the Discover card says", () => {
  const money = { amount: "4000000", currency: "USD" };
  const base = {
    truthClass: "USER_CLAIM" as const,
    evidenceStatus: "SELF_REPORTED" as const,
    visibility: "network_visible" as const,
  };
  it("labels a pitch claim as their pitch, never as the disclosed raise", () => {
    expect(
      cardRaiseWords({
        raise: null,
        raiseView: {
          ...base,
          source: "PITCH_CLAIM",
          money,
          asOf: null,
          pitch: {
            pitchId: "38579af4-cfa2-4fd8-9381-d9f562768c03",
            atSeconds: 43,
          },
        },
      }),
    ).toBe("$4 million (from their pitch)");
  });
  it("a disclosed raise is said plainly; NONE says nothing", () => {
    expect(
      cardRaiseWords({
        raise: money,
        raiseView: {
          ...base,
          source: "DISCLOSED_OBJECTIVE",
          money,
          asOf: "2026-09-01T00:00:00.000Z",
          pitch: null,
        },
      }),
    ).toBe("$4 million");
    expect(
      cardRaiseWords({
        // The legacy field cannot override the one read.
        raise: money,
        raiseView: {
          source: "NONE",
          money: null,
          truthClass: "UNKNOWN",
          evidenceStatus: "NO_EVIDENCE",
          visibility: null,
          asOf: null,
          pitch: null,
        },
      }),
    ).toBeNull();
  });
  it("without the read, the disclosed raise as before", () => {
    expect(cardRaiseWords({ raise: money })).toBe("$4 million");
  });

  // Owner 23 Oct 2026 (Halyard): the card says the row's own reason, not
  // a generic "Cheque compatibility not known yet" Q then explained wrongly.
  it("an unknown cheque row says its exact reason on the card", () => {
    const halyard = fitFixture(
      "4b1d5a9e-2f1c-4c1e-9a51-0c6b3e2a7d11",
      "Halyard Security",
      { STAGE: "STRONG", SECTOR: "STRONG", GEOGRAPHY: "STRONG" },
    );
    const data = halyard.result.data as {
      profile: { parameters: Record<string, unknown>[] };
    };
    data.profile.parameters = data.profile.parameters.map((p) =>
      p["parameter"] === "CHEQUE_SIZE"
        ? {
            ...p,
            reason:
              "Raising £3M; your cheque is in EUR and no exchange rate is stored, so not compared.",
            unknownReason: "CURRENCY_DIFFERS_NO_RATE",
          }
        : p,
    );
    const card = fitSweepCardsBlock(fitsInOutcome(halyard), "Mandate fit")
      ?.cards[0];
    expect(card?.reasons).toContain(
      "Raising £3M; your cheque is in EUR and no exchange rate is stored, so not compared.",
    );
    expect(card?.reasons.join(" ")).not.toContain(
      "Cheque compatibility not known yet",
    );
  });
});
