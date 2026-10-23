import { describe, expect, it } from "vitest";

import {
  asksForComparison,
  asksForPipelineSummary,
  comparisonLead,
  pipelineLead,
} from "../src/q/early-lead.js";

/**
 * Lead 2026-10-16 (live: first text 6.2 s for "summarise my pipeline this
 * month", 7.6 s for a comparison): an analysis answer opens with one
 * grounded line from the run's own authorised reads. Counts and declared
 * fields only; unknown stays unknown.
 */

const NOW = new Date("2026-10-16T10:00:00Z");
const row = (
  state: string,
  stateSince: string,
  from: string | null = null,
) => ({
  state,
  stateSince,
  lastMessage: from === null ? null : { from },
});

describe("which asks open with a line from their records", () => {
  it("reads a pipeline summary and a comparison", () => {
    expect(asksForPipelineSummary("summarise my pipeline this month")).toBe(
      true,
    );
    expect(
      asksForPipelineSummary("give me an overview of my relationships"),
    ).toBe(true);
    expect(asksForPipelineSummary("how is my pipeline looking?")).toBe(true);
    expect(asksForPipelineSummary("what does Tensorgate do?")).toBe(false);
    expect(
      asksForComparison("compare Tensorgate and Ledgerfold on traction"),
    ).toBe(true);
    expect(asksForComparison("tell me about Tensorgate")).toBe(false);
  });
});

describe("pipelineLead", () => {
  it("counts by stage, furthest first, and what moved this month", () => {
    const data = {
      relationships: [
        row("CONNECTED", "2026-10-03T00:00:00Z", "THEM"),
        row("IN_DILIGENCE", "2026-09-20T00:00:00Z"),
        row("CONNECTED", "2026-08-01T00:00:00Z"),
        row("INTEREST_EXPRESSED", "2026-10-10T00:00:00Z"),
      ],
    };
    expect(pipelineLead(data, "summarise my pipeline this month", NOW)).toBe(
      "You have 4 relationships on Capital Q: 1 in diligence, 2 connected and 1 interest expressed. 2 changed stage this month, and 1 is waiting on your reply.",
    );
  });

  it("says none plainly, and nothing when the read is not one", () => {
    expect(
      pipelineLead({ relationships: [] }, "summarise my pipeline", NOW),
    ).toBe("You don't have any relationships on Capital Q yet.");
    expect(pipelineLead(null, "summarise my pipeline", NOW)).toBeNull();
    expect(pipelineLead({ other: 1 }, "summarise my pipeline", NOW)).toBeNull();
  });
});

describe("comparisonLead", () => {
  const profile = (
    canonicalName: string,
    currentStageCode: string | null,
    headquartersCountry: string | null,
  ) => ({
    companyId: canonicalName,
    canonicalName,
    currentStageCode,
    headquartersCity: null,
    headquartersCountry,
    foundedDate: null,
    shortDescription: null,
  });

  it("says each one's declared stage and place, and an undeclared one as such", () => {
    expect(
      comparisonLead([
        profile("Tensorgate", "seed", "US"),
        profile("Ledgerfold", null, null),
      ]),
    ).toBe(
      "Tensorgate: seed stage, based in United States. Ledgerfold: stage not declared, location not declared. That is what each declares on Capital Q.",
    );
    expect(comparisonLead([profile("Tensorgate", "seed", "US")])).toBeNull();
  });
});

// QA F-25 (23 Oct 2026): "Show me my fundraising pipeline" read the empty
// Capital page and said the pipeline was empty beside three relationship
// cards. Their pipeline, asked in any words, opens from the relationships.
describe("their own pipeline, in any words", () => {
  it("is a pipeline question", () => {
    for (const asked of [
      "Show me my fundraising pipeline.",
      "what's in my pipeline?",
      "Show me our investor pipeline",
    ]) {
      expect(asksForPipelineSummary(asked)).toBe(true);
    }
    expect(asksForPipelineSummary("What is a sales pipeline?")).toBe(false);
  });

  it("counts the relationships the cards show, never an empty pipeline", () => {
    const lead = pipelineLead(
      {
        relationships: [
          row("INTEREST_EXPRESSED", "2026-10-05T09:00:00Z"),
          row("CONNECTED", "2026-10-10T09:00:00Z"),
          row("CONNECTED", "2026-10-12T09:00:00Z"),
        ],
      },
      "Show me my fundraising pipeline.",
      NOW,
    );
    expect(lead).toBe(
      "You have 3 relationships on Capital Q: 2 connected and 1 interest expressed.",
    );
  });
});
