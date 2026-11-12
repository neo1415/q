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

/**
 * Metrics audit P1-15 (owner 12 Nov): a deck section at the rubric's
 * standard is the company's claim supported by its own document, as read
 * by Q; never independently verified.
 */
describe("a deck section is the company's claim, never verified", () => {
  it("labels the line USER_CLAIM / DOCUMENT_SUPPORTED with Q's reading named", () => {
    const deck: ReadinessInputs["deck"] = {
      documentId: "11111111-1111-4111-8111-111111111111",
      sections: [
        {
          section: "PROBLEM",
          score: 3,
          level: "STRONG",
          atStandard: true,
          improve: null,
        },
      ],
    };
    const result = readSignal("deck.section.PROBLEM", {
      ...EMPTY,
      deck,
    });
    const line = result?.evidence[0];
    expect(line?.truthClass).toBe("USER_CLAIM");
    expect(line?.evidenceStatus).toBe("DOCUMENT_SUPPORTED");
    expect(line?.note).toMatch(/not independently verified/u);
    expect(line?.truthClass).not.toBe("VERIFIED");
  });
});
