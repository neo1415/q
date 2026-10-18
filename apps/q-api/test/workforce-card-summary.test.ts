import { describe, expect, it } from "vitest";

import { cardSummary } from "../src/composition/workforce/job-actions.js";

/** Live 2026-10-12: the plan card read "... for your approval. The res". */
describe("a team job's card line", () => {
  it("ends on a sentence or a word, within 200 characters", () => {
    const long =
      "Q's team: Research Ledgerfold and its fit with Savanna Seed Partners, prepare and independently critique an investment memo, revise it, then file founder diligence questions for your approval. The results and approval items can be shown after the plan runs.";
    const line = cardSummary(long);
    expect(line.length).toBeLessThanOrEqual(200);
    expect(line).toBe(
      "Q's team: Research Ledgerfold and its fit with Savanna Seed Partners, prepare and independently critique an investment memo, revise it, then file founder diligence questions for your approval.",
    );
    const words = cardSummary(`Q's team: ${"word ".repeat(60)}`);
    expect(words.length).toBeLessThanOrEqual(200);
    expect(words.endsWith("word…")).toBe(true);
    expect(cardSummary("Q's team: short.")).toBe("Q's team: short.");
  });
});
