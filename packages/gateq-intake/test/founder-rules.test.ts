import { describe, expect, it } from "vitest";

import { founderRules } from "../src/index.js";

/**
 * gateqf-1 (2026-10-21): what a founder sees of how an investor's rules
 * stood when they sent it is the engine's frozen answer, by published
 * label only. Never the rule's configuration, never a re-check.
 */
describe("a founder's rules at submission", () => {
  it("reads the frozen qualification label by label, unknown never as a no", () => {
    expect(
      founderRules({
        outcome: "INSUFFICIENT_INFORMATION",
        criteria: [
          {
            label: "Pre-seed or seed",
            type: "STAGE",
            requiredness: "REQUIRED",
            status: "MATCH",
            // Whatever else a stored criterion carries is not passed on.
            config: { type: "STAGE", stages: ["seed"] },
          },
          {
            label: "Based in Europe",
            type: "GEOGRAPHY",
            requiredness: "PREFERRED",
            status: "NO_MATCH",
          },
          {
            label: "$500k to $3M",
            type: "RAISE_SIZE",
            requiredness: "REQUIRED",
            status: "UNKNOWN",
          },
          {
            label: "Never tobacco",
            type: "EXCLUDED_TAXONOMY",
            requiredness: "REQUIRED",
            status: "NOT_APPLICABLE",
          },
        ],
      }),
    ).toEqual([
      { label: "Pre-seed or seed", required: true, standing: "MEETS" },
      { label: "Based in Europe", required: false, standing: "DOES_NOT_MEET" },
      { label: "$500k to $3M", required: true, standing: "NOT_ANSWERED" },
    ]);
  });

  it("is empty for a qualification it cannot read", () => {
    expect(founderRules(null)).toEqual([]);
    expect(founderRules({ criteria: "nonsense" })).toEqual([]);
  });
});
