import { describe, expect, it } from "vitest";

import { investorDiscoveryText } from "../src/q/investor-discovery-answer.js";

describe("investor discovery wording (live 2026-10-10)", () => {
  for (const [said, shown] of [
    ["middle east", "Middle East"],
    ["arab", "Arab"],
    ["gcc", "GCC"],
    ["gulf", "Gulf"],
  ] as const) {
    it(`"${said}" reads "${shown}"`, () => {
      const text = investorDiscoveryText([], {
        regionWords: [said],
        asked: 3,
        outcome: "NONE",
        aboutMyCompany: true,
      });
      expect(text).toContain(`from the ${shown} region`);
    });
  }
});

// Live 2026-10-24: "three Saudi family offices that back fintech" was told
// "a sector or a country would help" -- both had been said.
describe("nothing found: what was asked, in their words", () => {
  it("names the kind, sector and place, and asks for neither again", () => {
    const text = investorDiscoveryText([], {
      regionWords: ["saudi"],
      asked: 3,
      outcome: "NONE",
      aboutMyCompany: false,
      kinds: ["family offices"],
      sector: "fintech",
    });
    expect(text).toContain(
      "family offices backing fintech from the Saudi region",
    );
    expect(text).toContain("I'm not sure there are none");
    expect(text).not.toMatch(/a sector or a country/iu);
  });

  it("a place without a sector asks only for the sector", () => {
    const text = investorDiscoveryText([], {
      regionWords: ["kenyan"],
      asked: 5,
      outcome: "NONE",
      aboutMyCompany: false,
    });
    expect(text).toContain("A sector would help");
    expect(text).not.toMatch(/country/iu);
  });
});
