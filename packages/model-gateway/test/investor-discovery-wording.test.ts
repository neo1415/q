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

// Coordinator 2026-10-24: the known firms, then public firms named apart
// as unconfirmed, and no rehearsal offered for a list.
describe("known firms and public finds", () => {
  const one = (name: string, source: "KNOWN_ENTITY" | "WEB") =>
    ({
      card: { subject: { displayName: name } },
      role: "INVESTOR",
      fit: [],
      source,
    }) as unknown as Parameters<typeof investorDiscoveryText>[0][number];

  it("names the public ones apart, unconfirmed", () => {
    const text = investorDiscoveryText(
      [
        one("AlRayan Investment LLC", "KNOWN_ENTITY"),
        one("Doha Tech Angels", "KNOWN_ENTITY"),
        one("Qatar Development Bank", "KNOWN_ENTITY"),
        one("Qatar Investment Authority", "WEB"),
      ],
      {
        regionWords: ["qatar"],
        asked: 3,
        outcome: "FOUND",
        aboutMyCompany: false,
      },
    );
    expect(text).toContain(
      "Here are three Qatar investors who could fit: AlRayan Investment LLC, Doha Tech Angels and Qatar Development Bank.",
    );
    expect(text).toContain(
      "From a public web search, not confirmed: Qatar Investment Authority.",
    );
    expect(text).not.toMatch(/rehearsal/iu);
  });
});
