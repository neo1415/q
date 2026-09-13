import { describe, expect, it } from "vitest";

import { narrativeFlags } from "../src/integration/mandate-review-service.js";

/**
 * CQ-PRE-REC-001 §24: a firm exclusion in the investor's own words is
 * recognised deterministically beside the model's reading, and still only
 * ever becomes a question; a soft dislike becomes an AVOID proposal.
 */
describe("narrativeFlags", () => {
  it("reads a firm negative as an exclusion to confirm and a soft one as avoid", () => {
    expect(
      narrativeFlags(
        "We mostly invest $250k to $1m at Seed and Series A, mostly fintech and B2B SaaS in Africa. I don't love hardware, and never show me gambling.",
      ),
    ).toEqual([
      {
        code: "hardware_heavy",
        kind: "AVOID",
        quote: "I don't love hardware",
      },
      {
        code: "gambling",
        kind: "EXCLUSION",
        quote: "never show me gambling",
      },
    ]);
  });

  it("leaves a flag word with no negative around it to the model", () => {
    expect(
      narrativeFlags("We like hardware and crypto infrastructure."),
    ).toEqual([]);
  });

  it("does not match inside other words", () => {
    expect(narrativeFlags("never tokenised, no armsmiths")).toEqual([]);
  });
});
