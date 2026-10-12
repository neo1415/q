import { describe, expect, it } from "vitest";

import { JobPlanResultV4Schema } from "../src/index.js";

const step = {
  key: "research",
  role: "RESEARCH",
  goal: "Research Ledgerfold and its fit, with sources.",
  tools: [],
  dependsOn: [],
};

describe("the lead Q's job plan", () => {
  it("keeps a limitation line of a real sentence or two (live 2026-10-12)", () => {
    // A 200-character ceiling refused the whole plan over one honest
    // "cannot" line, and the investor was told to reword a fine goal.
    const line =
      "Contacting the founder, sending anything outside Capital Q, or committing to terms on your behalf: each needs your explicit approval, and the team can only prepare those for you to review. ".repeat(
        2,
      );
    expect(line.length).toBeGreaterThan(300);
    const parsed = JobPlanResultV4Schema.safeParse({
      summary: "Research, a memo, a critique and founder questions.",
      steps: [step],
      cannot: [line.trim()],
    });
    expect(parsed.error?.issues ?? []).toEqual([]);
  });
});
