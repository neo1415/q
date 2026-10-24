import { describe, expect, it } from "vitest";

import { pipelineSummaryLine } from "../src/pipeline-summary.js";

/**
 * Coordinator 23 Oct 2026: "Show me my fundraising pipeline" said only
 * "Opening your pipeline…". The move says what is in it first.
 */
describe("what is in their pipeline, in one line", () => {
  it("a founder's three investors, the one waiting on them named", () => {
    expect(
      pipelineSummaryLine("COMPANY", [
        {
          counterpart: { name: "Savanna Seed Partners" },
          state: "CONNECTED",
          lastMessage: { from: "YOU" },
        },
        {
          counterpart: { name: "Zino Aviation" },
          state: "INTEREST_EXPRESSED",
          lastMessage: { from: "THEM" },
        },
        {
          counterpart: { name: "Rift Valley" },
          state: "CONNECTED",
          lastMessage: { from: "THEM" },
        },
      ]),
    ).toBe(
      "3 investors: Savanna Seed Partners connected; Zino Aviation and Rift Valley waiting for your reply.",
    );
  });

  it("an investor's companies; an empty pipeline is said as empty", () => {
    expect(
      pipelineSummaryLine("INVESTOR", [
        { counterpart: { name: "Ledgerfold" }, state: "IN_DILIGENCE" },
      ]),
    ).toBe("1 company: Ledgerfold in diligence.");
    expect(pipelineSummaryLine("COMPANY", [])).toBe(
      "No investors in your pipeline yet.",
    );
  });

  it("many are counted, not listed", () => {
    const rows = Array.from({ length: 8 }, (_, i) => ({
      counterpart: { name: `Fund ${String(i)}` },
      state: i < 5 ? "CONNECTED" : "INTEREST_EXPRESSED",
    }));
    expect(pipelineSummaryLine("COMPANY", rows)).toBe(
      "8 investors: 5 connected; 3 interest expressed.",
    );
  });
});
