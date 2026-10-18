import { describe, expect, it } from "vitest";

import {
  DECK_SECTIONS,
  unknownDeckSection,
  type DeckFact,
  type DeckSectionCode,
  type DeckSectionReading,
} from "@capital-q/contracts";

import {
  deckFigureIndex,
  unverifiedFigures,
  verifyDeckReading,
} from "../src/index.js";

/**
 * F26: the three seeded readings that told founders their own deck
 * contradicted itself, with figures that appear nowhere in the deck.
 */
const criteria = { clear: true, strong: false, exceptional: false, note: null };

function reading(
  code: DeckSectionCode,
  section: Partial<DeckSectionReading>,
): DeckSectionReading[] {
  return DECK_SECTIONS.map((c) =>
    c === code
      ? {
          ...unknownDeckSection(c),
          status: "PRESENT",
          confidence: "MEDIUM",
          pages: [8],
          criteria,
          ...section,
        }
      : { ...unknownDeckSection(c), criteria },
  );
}

const fact = (value: string, over: Partial<DeckFact> = {}): DeckFact => ({
  label: "Figure",
  value,
  unknownReason: null,
  kind: "FIGURE",
  asOf: null,
  pages: [8],
  truthClass: "USER_CLAIM",
  evidenceStatus: "SELF_REPORTED",
  confidence: "MEDIUM",
  ...over,
});

const at = (sections: DeckSectionReading[], code: DeckSectionCode) =>
  sections.find((s) => s.section === code);

describe("the deck figure check (F26)", () => {
  it("Termly: ₦5bn is not in the deck, so the contradiction is set aside", () => {
    const deck =
      "Slide 8 — Business model. Partner microfinance banks extend a ₦2.5bn credit line; we earn a spread.";
    const out = verifyDeckReading(
      reading("BUSINESS_MODEL", {
        status: "CONTRADICTORY",
        summary:
          "The deck cites ₦2.5bn and a ₦5bn partner-microfinance credit line, repeated slide 8 text.",
        facts: [
          fact("₦2.5bn"),
          fact("₦5bn", { unknownReason: "CONTRADICTORY" }),
        ],
      }),
      deck,
    );
    const section = at(out.sections, "BUSINESS_MODEL");
    expect(section?.status).toBe("UNCLEAR");
    expect(section?.summary).toBeNull();
    expect(section?.facts.map((f) => f.value)).toEqual(["₦2.5bn"]);
    expect(out.setAside).toEqual([
      { section: "BUSINESS_MODEL", figures: ["5bn"] },
    ]);
  });

  it("Mizan: 4% is not 1.4%", () => {
    const deck = "Slide 3: 1.4% fee. Slide 8: Fee of 1.4% of each financing.";
    const out = verifyDeckReading(
      reading("BUSINESS_MODEL", {
        status: "CONTRADICTORY",
        summary:
          "Most slides state a 1.4% financing fee, while slide 8 states 4%.",
        facts: [fact("1.4%")],
      }),
      deck,
    );
    expect(at(out.sections, "BUSINESS_MODEL")?.status).toBe("UNCLEAR");
    expect(out.setAside[0]?.figures).toEqual(["4%"]);
    expect(unverifiedFigures("a 1.4% fee", deckFigureIndex(deck))).toEqual([]);
  });

  it("Akshar: 241,000 is not 410,000", () => {
    const deck = "Over 410,000 students assessed. Chart: 410,000 (2025).";
    const out = verifyDeckReading(
      reading("TRACTION", {
        status: "CONTRADICTORY",
        summary:
          "The chart appears to show 241,000 students assessed, which conflicts with over 410,000.",
        facts: [fact("410,000 students"), fact("241,000 students")],
      }),
      deck,
    );
    const section = at(out.sections, "TRACTION");
    expect(section?.status).toBe("UNCLEAR");
    expect(section?.facts.map((f) => f.value)).toEqual(["410,000 students"]);
  });

  it("keeps a real contradiction, and normalises how figures are written", () => {
    const deck =
      "Revenue ₦2.5 billion (slide 4). Revenue NGN 3bn (slide 9). Retention 96 %. 1 140 paying.";
    const real = reading("FINANCIALS", {
      status: "CONTRADICTORY",
      summary: "Slide 4 says ₦2.5bn revenue but slide 9 says ₦3 billion.",
      facts: [fact("₦2,500,000,000"), fact("96%")],
    });
    const out = verifyDeckReading(real, deck);
    expect(out.sections).toEqual(real);
    expect(out.setAside).toEqual([]);
  });

  it("drops a figure Q says the deck states when it does not; leaves Q's own inferences and small counts", () => {
    const deck = "We have 3 founders and ₦38m MRR as of June 2026.";
    const out = verifyDeckReading(
      reading("TRACTION", {
        facts: [
          fact("₦38m MRR"),
          fact("₦45m MRR"),
          fact("₦456m ARR", { truthClass: "Q_INFERENCE" }),
          fact("3 founders"),
        ],
      }),
      deck,
    );
    const section = at(out.sections, "TRACTION");
    expect(section?.status).toBe("PRESENT");
    expect(section?.facts.map((f) => f.value)).toEqual([
      "₦38m MRR",
      "₦456m ARR",
      "3 founders",
    ]);
  });
});
