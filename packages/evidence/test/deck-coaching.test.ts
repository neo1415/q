import { describe, expect, it } from "vitest";

import {
  DECK_SECTIONS,
  DeckCoachingSchema,
  deckSectionForReaders,
  type DeckFact,
  type DeckSectionCode,
  type DeckSectionReading,
} from "@capital-q/contracts";

import { coachDeck, scoreDeckSection } from "../src/index.js";

/**
 * Overnight A6: the coaching rubric (research pitch-deck.md §4-§6). The
 * model's rung answers become a 0-5 score in code, identically for every
 * company; the minimum standard is the research's, and nothing about the
 * person is an input.
 */

const fact = (over: Partial<DeckFact> = {}): DeckFact => ({
  label: "Monthly revenue",
  value: "$41k",
  unknownReason: null,
  kind: "FIGURE",
  asOf: "Sep 2026",
  pages: [7],
  truthClass: "USER_CLAIM",
  evidenceStatus: "SELF_REPORTED",
  confidence: "HIGH",
  ...over,
});

const reading = (
  section: DeckSectionCode,
  rung: 0 | 1 | 2 | 3 | 4 | 5,
  over: Partial<DeckSectionReading> = {},
): DeckSectionReading => ({
  section,
  status: rung === 0 ? "NOT_IN_DECK" : "PRESENT",
  summary: rung === 0 ? null : "What the deck says.",
  pages: rung === 0 ? [] : [3],
  facts: rung >= 2 ? [fact()] : [],
  confidence: "MEDIUM",
  criteria: { clear: rung >= 3, strong: rung >= 4, exceptional: rung >= 5, note: null },
  ...over,
});

const full = (score: (code: DeckSectionCode) => 0 | 1 | 2 | 3 | 4 | 5) =>
  DECK_SECTIONS.map((code) => reading(code, score(code)));

describe("deck coaching rubric", () => {
  it("scores each rung 0-5 from the reading", () => {
    for (const rung of [0, 1, 2, 3, 4, 5] as const) {
      expect(scoreDeckSection(reading("MARKET", rung))).toBe(rung);
    }
    // A long, specific-sounding summary without the "Clear" rung is still Basic.
    expect(scoreDeckSection(reading("MARKET", 1, { summary: "x".repeat(90) }))).toBe(2);
  });

  it("puts a deck at the minimum standard only when every required section is Clear and the checks pass", () => {
    const at = coachDeck(full(() => 3).map((r) => (r.section === "THE_ASK" ? reading("THE_ASK", 4) : r)), 14);
    expect(DeckCoachingSchema.safeParse(at).success).toBe(true);
    expect(at.atMinimumStandard).toBe(true);
    expect(at.sectionsAtStandard).toBe(12);

    const marketBasic = coachDeck(
      full((code) => (code === "MARKET" ? 2 : code === "THE_ASK" ? 4 : 3)),
      14,
    );
    expect(marketBasic.atMinimumStandard).toBe(false);
    const market = marketBasic.sections.find((s) => s.section === "MARKET");
    expect(market).toMatchObject({ score: 2, level: "BASIC", requiredForMinimum: true, atStandard: false });
    expect(market?.improve).toContain("market size");

    // Competition is not part of the minimum: missing it alone does not fail.
    const noCompetition = coachDeck(
      full((code) => (code === "COMPETITION" ? 0 : code === "THE_ASK" ? 4 : 3)),
      14,
    );
    expect(noCompetition.atMinimumStandard).toBe(true);
    expect(noCompetition.sections.find((s) => s.section === "COMPETITION")?.gaps).toContain(
      "This isn't in the deck yet.",
    );
  });

  it("flags undated numbers with their slides, and contradictions", () => {
    const readings = full(() => 3).map((r) =>
      r.section === "TRACTION"
        ? reading("TRACTION", 3, { facts: [fact({ asOf: null, pages: [6] }), fact({ asOf: null, pages: [9] })] })
        : r.section === "FINANCIALS"
          ? reading("FINANCIALS", 3, { status: "CONTRADICTORY" })
          : r,
    );
    const coaching = coachDeck(readings, 14);
    const undated = coaching.checks.find((c) => c.code === "UNDATED_FIGURES");
    expect(undated).toMatchObject({ passed: false, words: "2 numbers have no date: slides 6 and 9" });
    expect(coaching.checks.find((c) => c.code === "CONTRADICTIONS")?.passed).toBe(false);
    expect(coaching.atMinimumStandard).toBe(false);
  });

  it("fills a missing section as Not in the deck, never a guess, and keeps the order", () => {
    const coaching = coachDeck([reading("TEAM", 4)], null);
    expect(coaching.sections.map((s) => s.section)).toEqual([...DECK_SECTIONS]);
    expect(coaching.sections[0]).toMatchObject({ section: "PROBLEM", score: 0, level: "MISSING" });
  });

  it("strips the rubric from what an investor receives", () => {
    const section = deckSectionForReaders(reading("PROBLEM", 4, { criteria: { clear: true, strong: true, exceptional: false, note: "secret coaching" } }));
    expect(JSON.stringify(section)).not.toContain("criteria");
    expect(JSON.stringify(section)).not.toContain("secret coaching");
  });
});
