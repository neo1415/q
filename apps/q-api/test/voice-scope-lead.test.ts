import { SPOKEN_FACTS_VERSION, type SpokenFacts } from "@capital-q/q-core";
import { describe, expect, it } from "vitest";

import { scopeLeadOf, withScopeLead } from "../src/voice/scope-lead.js";

/**
 * D5 (audit 14 Nov 2026, run 2709d60c): Q wrote "Leaving out the ones I've
 * already shown, here are the next best: Clearwater 9.5 …"; the voice said
 * "The strongest fit is Clearwater". Q's scope is said before the ranking.
 */

const ranked = (fallback: string): SpokenFacts => ({
  version: SPOKEN_FACTS_VERSION,
  kind: "RANKED",
  requested: null,
  items: [
    {
      name: "Clearwater",
      score: "9.5",
      about: null,
      strengths: [],
      unknowns: [],
    },
    {
      name: "Tensorgate",
      score: "9",
      about: null,
      strengths: [],
      unknowns: [],
    },
  ],
  ties: [],
  alsoLevel: 0,
  others: [],
  mustSay: ["Clearwater", "Tensorgate"],
  caveat: null,
  next: null,
  onScreen: true,
  place: null,
  talkAbout: false,
  fallback,
});

const FALLBACK =
  "The strongest fits for your mandate: Clearwater at 9.5; then Tensorgate at 9. They're on screen. Want me to go through one?";

describe("Q's scope is said before a spoken ranking (D5)", () => {
  it("keeps 'leaving out the ones already shown'", () => {
    const written = `Leaving out the ones I've already shown, here are the next best. ${FALLBACK}`;
    const spoken = withScopeLead(ranked(FALLBACK), written);
    expect(spoken.fallback).toBe(
      `Leaving out the ones I've already shown, here are the next best. ${FALLBACK}`,
    );
  });

  it("keeps 'beyond the ones I've already shown'", () => {
    const written =
      "Beyond the ones I've already shown, I have only two more companies to put against your mandate, not five. Your top two: Clearwater at 9.5; then Tensorgate at 9.";
    expect(scopeLeadOf(ranked(FALLBACK), written)).toBe(
      "Beyond the ones I've already shown, I have only two more companies to put against your mandate, not five.",
    );
  });

  it("never says a template opener (founder live 2026-10-08)", () => {
    expect(
      scopeLeadOf(
        ranked(FALLBACK),
        `I've scored your top 10 companies against your mandate. ${FALLBACK}`,
      ),
    ).toBeNull();
  });

  it("adds nothing when the answer opens on the ranking itself", () => {
    expect(scopeLeadOf(ranked(FALLBACK), FALLBACK)).toBeNull();
    expect(
      scopeLeadOf(ranked(FALLBACK), "Your top two: Clearwater at 9.5."),
    ).toBeNull();
  });

  it("never speaks written structure", () => {
    expect(
      scopeLeadOf(ranked(FALLBACK), "## Top fits\nClearwater leads."),
    ).toBeNull();
  });

  it("only for rankings", () => {
    const record: SpokenFacts = { ...ranked(FALLBACK), kind: "RECORD" };
    expect(
      scopeLeadOf(record, "Leaving out the ones I've already shown. x"),
    ).toBeNull();
  });
});
