import { describe, expect, it } from "vitest";

import { DECK_SECTIONS, type DeckSectionReading } from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";

import {
  createInvestabilityDeckPort,
  type InvestabilityDeckRoom,
} from "../src/investability/composition.js";

/**
 * The deck reaches Investability only when it is open to ALL investors
 * (Context Firewall). Of Q's reading, confirmed or corrected sections are
 * evidence; sections not reviewed yet are unconfirmed reads (ADR 0075);
 * a section the founder marked as wrong never counts at all.
 */

const sql = (() => Promise.resolve([])) as unknown as DatabaseExecutor;

const reading = (code: string): DeckSectionReading => ({
  section: code as DeckSectionReading["section"],
  status: "PRESENT",
  summary: `${code} summary`,
  pages: [1],
  facts: [],
  confidence: "MEDIUM",
  criteria: { clear: true, strong: false, exceptional: false, note: null },
});

function room(
  level: "PUBLIC" | "PRIVATE",
  audience: string,
): InvestabilityDeckRoom {
  return {
    currentDeck: () =>
      Promise.resolve({
        documentId: "d1",
        tenantId: "t1",
        title: "Deck",
        versionId: "v1",
        versionNumber: 1,
        uploadedAt: "2026-10-01T00:00:00.000Z",
        downloadAudience: audience,
        scanned: true,
        level,
      }),
    extractionFor: () =>
      Promise.resolve({
        id: "x1",
        documentId: "d1",
        documentVersionId: "v1",
        pageCount: 12,
        sections: DECK_SECTIONS.map(reading),
        createdAt: "2026-10-02T00:00:00.000Z",
        confirmed: false,
        readingNumber: 1,
        setAside: [],
        readAgain: { used: 0, pending: false },
        reviews: [
          { section: "TRACTION", action: "CONFIRM", correction: null },
          { section: "TEAM", action: "DISMISS", correction: null },
        ],
      }),
  };
}

describe("investability deck port", () => {
  it("never reads a deck that is not open to all investors", async () => {
    const port = createInvestabilityDeckPort(sql, room("PRIVATE", "OWNER"));
    expect(await port("c1")).toBeNull();
  });

  it("confirmed sections are evidence, unreviewed are unconfirmed, dismissed never count", async () => {
    const port = createInvestabilityDeckPort(sql, room("PUBLIC", "OWNER"));
    const deck = await port("c1");
    if (deck === null) throw new Error("expected a deck");
    const present = deck.sections
      .filter((s) => s.status === "PRESENT")
      .map((s) => s.section);
    expect(present).toEqual(["TRACTION"]);
    const unconfirmed = (deck.unconfirmed ?? []).map((s) => s.section);
    expect(unconfirmed).not.toContain("TEAM");
    expect(unconfirmed).not.toContain("TRACTION");
    expect(unconfirmed).toHaveLength(DECK_SECTIONS.length - 2);
  });
});
