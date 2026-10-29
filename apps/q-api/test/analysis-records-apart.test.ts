import { describe, expect, it } from "vitest";

import type { AnalysisDocumentResult } from "@capital-q/q-core";

import {
  basisProblems,
  recordsCitedAsWeb,
} from "../src/composition/workforce/analysis.js";

/**
 * Live case A (2026-10-29): a sector report wrote "Their reported pricing
 * [S22] increases the burden on LedgerBridge ..." -- a Capital Q record in
 * a sentence citing a web source. Code sends such a draft back; a record
 * marked (Capital Q record) in its own sentence passes.
 */

function draft(
  body: string,
  topRecommendations: readonly string[] = [],
): AnalysisDocumentResult {
  return {
    title: "Nigerian B2B payments",
    summary: "The sector is growing [S1].",
    sections: [{ heading: "Implications for your thesis", body }],
    topRecommendations: [...topRecommendations],
    gaps: [],
  };
}

describe("Capital Q records stay apart from web sources", () => {
  it("flags a sentence naming a record that cites [S n]", () => {
    const mixed = draft(
      "Their reported pricing [S22] increases the burden on LedgerBridge to prove value.",
    );
    const issues = recordsCitedAsWeb(mixed, ["LedgerBridge"]);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.problem).toContain("LedgerBridge");
    expect(basisProblems(mixed, new Set([1, 22]), ["LedgerBridge"])).toEqual(
      issues,
    );
  });

  it("flags a record in a top recommendation that cites a web source", () => {
    const mixed = draft("Payments grew [S1].", [
      "Check LedgerBridge's licence against the CBN list [S4, S9].",
    ]);
    expect(recordsCitedAsWeb(mixed, ["LedgerBridge"])).toHaveLength(1);
  });

  it("passes a record marked apart, and a web sentence beside it", () => {
    const apart = draft(
      "Reported pricing is 1.5% [S22]. LedgerBridge declares B2B payables for distributors (Capital Q record).",
    );
    expect(recordsCitedAsWeb(apart, ["LedgerBridge"])).toEqual([]);
    expect(basisProblems(apart, new Set([1, 22]), ["LedgerBridge"])).toEqual(
      [],
    );
  });

  // Re-recorded case A: correct drafts were sent back twice because the
  // check read whole sentences, not the clause naming the record.
  it("passes a web clause and a marked record clause in one sentence", () => {
    const apart = draft(
      "Evidence: solutions include approval workflows [S42] (other; one source); LedgerBridge is recorded as addressing payables (Capital Q record).",
    );
    expect(recordsCitedAsWeb(apart, ["LedgerBridge"])).toEqual([]);
  });

  it("reads a table row's cells apart", () => {
    const table = draft(
      "| Bankly | Microfinance bank | Nigeria | [S8] |\n| LedgerBridge | B2B payables | Nigeria | (Capital Q record) |",
    );
    expect(recordsCitedAsWeb(table, ["LedgerBridge"])).toEqual([]);
  });

  it("still flags the record's own clause citing [S n]", () => {
    const mixed = draft(
      "Payments grew [S1]; LedgerBridge processes 4% of B2B volume [S9].",
    );
    expect(recordsCitedAsWeb(mixed, ["LedgerBridge"])).toHaveLength(1);
  });

  it("matches whole names only, and nothing without records", () => {
    const other = draft("LedgerBridgeway grew [S1].");
    expect(recordsCitedAsWeb(other, ["LedgerBridge"])).toEqual([]);
    expect(recordsCitedAsWeb(draft("LedgerBridge [S1]."), [])).toEqual([]);
  });
});
