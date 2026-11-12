import { describe, expect, it } from "vitest";

import { readSignal, type ReadinessInputs } from "../src/index.js";

const EMPTY: ReadinessInputs = {
  stageCode: "seed",
  profile: { description: false, website: false, categories: 0 },
  team: {
    founderCount: null,
    fullTimeFounderCount: null,
    teamSize: null,
    founderBackgrounds: 0,
    verifiedFounderIdentities: 0,
  },
  verification: { organisation: false, domain: false },
  claims: [],
  deck: null,
  dataRoom: null,
  raise: null,
  followUps: [],
};

/**
 * Metrics audit P1-14 (7 Nov): a deck or raise that failed to load read as
 * null, and null read as MISSING, so the founder saw a Gap for a read
 * failure. Unknown is never negative evidence (CLAUDE.md invariants).
 */
describe("a source that could not be read is unknown, never a Gap", () => {
  it("no deck uploaded is MISSING; a deck that failed to load is no signal", () => {
    expect(readSignal("deck.present", EMPTY)?.state).toBe("MISSING");
    expect(
      readSignal("deck.present", { ...EMPTY, unreadable: { deck: true } }),
    ).toBeNull();
  });

  it("no raise recorded is MISSING; a raise that failed to load is no signal", () => {
    for (const signal of [
      "raise.target",
      "raise.use_of_funds",
      "raise.terms",
    ] as const) {
      expect(readSignal(signal, EMPTY)?.state).toBe("MISSING");
      expect(
        readSignal(signal, { ...EMPTY, unreadable: { raise: true } }),
      ).toBeNull();
    }
  });
});
