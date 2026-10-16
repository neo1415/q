import { describe, expect, it } from "vitest";

import {
  FOUNDER_PROFILE_SECTIONS,
  FOUNDER_PROFILE_SECTIONS_VERSION,
} from "../src/index.js";

/** Owner template (2026-10-16): 14 sections, in order; Closing never asked. */
describe("founder profile sections", () => {
  it("are the owner's 14 sections, in the template's order and wording", () => {
    expect(FOUNDER_PROFILE_SECTIONS.map((s) => s.title)).toEqual([
      "Opportunity and Economics",
      "The Problem",
      "Solution",
      "How It Works",
      "Business Model",
      "Our Vision",
      "Our Team",
      "Go-to-Market Strategy",
      "Competitive Landscape",
      "Moats",
      "Roadmap",
      "Why Us? Why Now?",
      "Our Ask",
      "Closing",
    ]);
    expect(FOUNDER_PROFILE_SECTIONS.map((s) => s.order)).toEqual(
      FOUNDER_PROFILE_SECTIONS.map((_, i) => i + 1),
    );
    expect(FOUNDER_PROFILE_SECTIONS_VERSION).toMatch(
      /^founder-profile-sections-/,
    );
  });

  it("ranks for investors uniquely, and never asks for Closing", () => {
    const ranks = FOUNDER_PROFILE_SECTIONS.map((s) => s.investorRank);
    expect(new Set(ranks).size).toBe(ranks.length);
    const closing = FOUNDER_PROFILE_SECTIONS.find((s) => s.key === "closing");
    expect(closing?.askable).toBe(false);
    expect(closing?.question).toBeNull();
    for (const s of FOUNDER_PROFILE_SECTIONS.filter((x) => x.askable)) {
      expect(s.stepKeys.length).toBeGreaterThan(0);
    }
  });
});
