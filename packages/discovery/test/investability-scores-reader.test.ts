import { describe, expect, it } from "vitest";

import type { DatabaseExecutor } from "@capital-q/database";

import { createPostgresInvestabilityScores } from "../src/index.js";

/**
 * Metrics audit P0-3 / P1-1: the Discover order reads only the current
 * Investability method, and never an early read (provisional), which may
 * rest on Q's unconfirmed reading of a deck.
 */
function fakeSql(rows: readonly Record<string, unknown>[]) {
  const calls: { text: string; values: unknown[] }[] = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ text: strings.join("?"), values });
    return Promise.resolve(rows);
  }) as unknown as DatabaseExecutor;
  return { sql, calls };
}

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const C = "00000000-0000-4000-8000-00000000000c";

describe("Investability as an ordering input", () => {
  it("filters on the current method version", async () => {
    const { sql, calls } = fakeSql([]);
    await createPostgresInvestabilityScores({
      sql,
      methodVersion: "investiq/v2+investability-inputs.v5",
    })([A]);
    expect(calls[0]?.text).toMatch(/method_version = \?/);
    expect(calls[0]?.values).toContain("investiq/v2+investability-inputs.v5");
  });

  it("never orders on an early read or an unscored row", async () => {
    const { sql } = fakeSql([
      { company_id: A, status: "SCORED", score: 70, provisional: "true" },
      { company_id: B, status: "SCORED", score: 60, provisional: "false" },
      {
        company_id: C,
        status: "INSUFFICIENT_EVIDENCE",
        score: null,
        provisional: null,
      },
    ]);
    const scores = await createPostgresInvestabilityScores({
      sql,
      methodVersion: "investiq/v2+investability-inputs.v5",
    })([A, B, C]);
    expect([...scores.entries()]).toEqual([[B, 60]]);
  });
});
