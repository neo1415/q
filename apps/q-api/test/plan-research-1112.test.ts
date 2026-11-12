import { describe, expect, it } from "vitest";

import {
  planNeedsPublicResearch,
  planResearch,
} from "../src/composition/workforce/plan-research.js";

/**
 * Production 12 Nov: all 15 stored plans ran with research NONE. The goals
 * below are those plans' own, as filed, plus the asks that should reach out.
 */
describe("a plan reaches out only when the ask turns on the outside world", () => {
  it("market, comparables, competition, regulation, diligence, valuation", () => {
    for (const ask of [
      "Prepare an investment plan for Ajopot: how do its unit economics compare with similar companies in its market?",
      "Run diligence on Ajopot over the next two weeks and reach a well-supported decision",
      "Benchmark our pricing against competitors in Kenya",
      "Plan our go-to-market for Ghana",
      "What do the regulations and licensing in Nigeria mean for our launch plan?",
      "Check Ledgerline's unit economics against its peers",
      "Set our valuation expectations for the seed round from comparable rounds",
    ]) {
      expect(planNeedsPublicResearch(ask), ask).toBe(true);
    }
  });

  it("work on their own records stays internal and fast", () => {
    for (const ask of [
      "Keep your investor pipeline moving: clear pending approvals, answer waiting messages",
      "Follow up this week with Ledgerline, Maji Loop and Clinicrest, prioritising the warmest",
      "Check in this week with the two connected founders you choose",
      "Understand why investor interest has not progressed and respond to investors",
      "Check Silo Credit's loan book quality this week and decide whether to proceed",
      "Raise USD 1.2 million for LedgerBridge over the next eight weeks",
      "List the companies in my marketplace feed I saved last week",
    ]) {
      expect(planNeedsPublicResearch(ask), ask).toBe(false);
    }
  });

  it("never lowers what the reader asked for", () => {
    expect(planResearch("SELF", "follow up with founders")).toBe("SELF");
    expect(planResearch("BOTH", "compare with peers")).toBe("BOTH");
    expect(planResearch("NONE", "compare with peers")).toBe("MARKET");
    expect(planResearch("NONE", "clear my approvals")).toBe("NONE");
  });
});
