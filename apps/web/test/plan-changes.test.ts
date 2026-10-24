import { describe, expect, it } from "vitest";

import { readChanges, readPlan } from "@/features/work/plan-words";

/**
 * F-29 (QA 2026-10-23): the mandate change card showed cut prose, not
 * what changes. Its preview is one field per line, before → after, and
 * the approval lays it out as Was / Now.
 */
describe("a change card reads as before and after (F-29)", () => {
  it("each field with what it was and what it becomes", () => {
    expect(
      readChanges(
        "Earliest stage: Seed → Pre-seed\nCheque: USD from 100,000 → USD from 50,000\nLatest stage: Series A (no change)",
      ),
    ).toEqual([
      {
        label: "Earliest stage",
        before: "Seed",
        after: "Pre-seed",
        unchanged: false,
      },
      {
        label: "Cheque",
        before: "USD from 100,000",
        after: "USD from 50,000",
        unchanged: false,
      },
      {
        label: "Latest stage",
        before: null,
        after: "Series A",
        unchanged: true,
      },
    ]);
  });

  it("long words stay whole, and a message is never read as a change list", () => {
    const long = `In your words: Seed fintech. → ${"We back trade infrastructure. ".repeat(20).trim()}`;
    expect(readChanges(long)?.[0]?.after).toHaveLength(
      long.length - "In your words: Seed fintech. → ".length,
    );
    expect(readChanges("Hi Amara, thanks for the deck.")).toBeNull();
    expect(readChanges("Earliest stage: Pre-seed")).toBeNull();
    expect(readPlan("Hi Amara, thanks for the deck.").quote).toBe(
      "Hi Amara, thanks for the deck.",
    );
  });
});
