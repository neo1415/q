import { describe, expect, it } from "vitest";

import { pipelineSummaryLine } from "../src/pipeline-summary.js";

/**
 * Coordinator 23 Oct 2026: "Show me my fundraising pipeline" said only
 * "Opening your pipeline…". The move says what is in it first.
 */
describe("what is in their pipeline, in one line", () => {
  it("a founder's three investors, each counted in its own state", () => {
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
      "3 investors: Savanna Seed Partners and Rift Valley connected; Zino Aviation awaiting reply.",
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
      "8 investors: 5 connected; 3 awaiting reply.",
    );
  });

  it("counts match the Relationships page's chips (acceptance 4 Nov 2026)", () => {
    // The page: All 12 · Awaiting reply 3 · Connected 8 · In diligence 1.
    // One connected company's last message was theirs; Q used to drop it
    // from "connected" and say "7 connected; 1 waiting for your reply".
    const rows = [
      { counterpart: { name: "Ajopot" }, state: "IN_DILIGENCE" },
      ...Array.from({ length: 8 }, (_, i) => ({
        counterpart: { name: `Connected ${String(i)}` },
        state: "CONNECTED",
        lastMessage: { from: i === 0 ? ("THEM" as const) : ("YOU" as const) },
      })),
      ...Array.from({ length: 3 }, (_, i) => ({
        counterpart: { name: `Awaiting ${String(i)}` },
        state: "INTEREST_EXPRESSED",
      })),
    ];
    const line = pipelineSummaryLine("INVESTOR", rows);
    expect(line).toBe(
      "12 companies: 1 in diligence; 8 connected; 3 awaiting reply.",
    );
    expect(line).not.toMatch(/waiting (?:for|on) you/u);
  });
});
