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
      });
      expect(text).not.toContain(` ${said} investor`);
    });
  }
});
