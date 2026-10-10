import { describe, expect, it } from "vitest";

import { investorDiscoveryLaneOf } from "../src/fast-lane.js";

/**
 * Investors of a region are recognised by code, whatever the words
 * (live 2026-10-10: "who in the Middle East might back us? give me 3" fell
 * to the analyst and failed).
 */
describe("investorDiscoveryLaneOf", () => {
  const FOUND: readonly (readonly [string, number | null])[] = [
    ["I need the top three Arab investors that may be interested in this", 3],
    ["who in the Middle East might back us? give me 3", 3],
    ["any Gulf money that could back us?", null],
    ["Middle Eastern VCs for my raise", null],
    ["who in Qatar might back us", null],
    ["find me 2 Saudi family offices", 2],
    ["investors from the GCC please", null],
    ["Dubai funds that might invest in us", null],
    ["Gulf investors I could rehearse with", null],
    ["show me a few MENA angels", 3],
  ];
  for (const [said, count] of FOUND) {
    it(`"${said}" is an investor search`, () => {
      const lane = investorDiscoveryLaneOf(said);
      expect(lane?.questionKind).toBe("DISCOVER_INVESTORS");
      expect(lane?.discoverInvestors?.regions.length).toBeGreaterThan(0);
      expect(lane?.discoverInvestors?.count ?? null).toBe(count);
    });
  }

  for (const said of [
    "who are my investors?",
    "what do investors think of my deck?",
    "draft an email to the Gulf investors",
    "schedule a call with Arab investors",
    "tell me about Qatar",
    "startups in the Gulf",
    "who is Shadi Qishta?",
    "how is my fund doing",
  ]) {
    it(`"${said}" is not`, () => {
      expect(investorDiscoveryLaneOf(said)).toBeNull();
    });
  }

  it("caps the count at five and keeps region words as said", () => {
    const lane = investorDiscoveryLaneOf("give me 9 Qatari investors");
    expect(lane?.discoverInvestors?.count).toBe(5);
    expect(lane?.discoverInvestors?.regions).toEqual(["qatari"]);
  });
});
