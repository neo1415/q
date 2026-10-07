import { describe, expect, it } from "vitest";

import {
  DECK_SECTIONS,
  type CompanyDeckView,
  type DeckFact,
  type DeckSection,
} from "@capital-q/contracts";

import { assumptionBoardText, buildAssumptionBoard } from "../src/index.js";

const COMPANY = "11111111-1111-4111-8111-111111111111";

const fact = (overrides: Partial<DeckFact>): DeckFact => ({
  label: "Annual recurring revenue",
  value: "₦38m",
  unknownReason: null,
  kind: "FIGURE",
  asOf: null,
  pages: [9],
  truthClass: "USER_CLAIM",
  evidenceStatus: "SELF_REPORTED",
  confidence: "MEDIUM",
  ...overrides,
});

const sections = (
  filled: Partial<Record<DeckSection["section"], readonly DeckFact[]>>,
): DeckSection[] =>
  DECK_SECTIONS.map((code) => {
    const facts = filled[code] ?? [];
    return {
      section: code,
      status: facts.length === 0 ? "NOT_IN_DECK" : "PRESENT",
      summary: null,
      pages: [],
      facts: [...facts],
      confidence: "MEDIUM",
    };
  });

const view = (overrides: Partial<CompanyDeckView>): CompanyDeckView => ({
  viewer: "INVESTOR",
  companyId: COMPANY,
  deck: {
    documentId: "22222222-2222-4222-8222-222222222222",
    title: "Deck",
    versionNumber: 1,
    pageCount: 12,
    uploadedAt: "2026-10-01T10:00:00.000Z",
    downloadable: false,
    scanned: true,
  },
  extraction: {
    extractionId: "33333333-3333-4333-8333-333333333333",
    readAt: "2026-10-02T10:00:00.000Z",
    versionNumber: 1,
    confirmed: true,
    sections: sections({
      TRACTION: [
        fact({ evidenceStatus: "DOCUMENT_SUPPORTED" }),
        fact({ label: "Monthly growth", value: "18%", pages: [10] }),
      ],
      MARKET: [
        fact({
          label: "SMEs in Lagos",
          value: "41,000",
          truthClass: "Q_INFERENCE",
          evidenceStatus: "DOCUMENT_SUPPORTED",
        }),
      ],
      PROBLEM: [
        fact({ kind: "TEXT", label: "Ledgers are reconciled by hand" }),
      ],
    }),
  },
  coaching: null,
  ...overrides,
});

describe("assumption board (Q.07)", () => {
  it("keeps truth and evidence apart and never evidences an inference", () => {
    const board = buildAssumptionBoard(view({}));
    expect(board?.basis).toBe("CONFIRMED_DECK_READING");
    const byLabel = new Map(board?.assumptions.map((a) => [a.label, a]));
    expect(byLabel.get("Annual recurring revenue")?.standing).toBe("EVIDENCED");
    expect(byLabel.get("Monthly growth")?.standing).toBe("CLAIMED");
    const inferred = byLabel.get("SMEs in Lagos");
    expect(inferred?.standing).toBe("CLAIMED");
    expect(inferred?.truthClass).toBe("Q_INFERENCE");
    expect(inferred?.question).toContain("Q read");
  });

  it("asks about missing key sections as unknown, never as a negative", () => {
    const board = buildAssumptionBoard(view({}));
    const burn = board?.assumptions.find((a) => a.id === "FINANCIALS:unknown");
    expect(burn?.standing).toBe("UNKNOWN");
    expect(burn?.value).toBeNull();
    expect(burn?.truthClass).toBeNull();
    expect(burn?.unknownReason).toBe("NOT_IN_DECK");
    expect(burn?.question).toMatch(/burn/);
    expect(board?.counts.unknown).toBeGreaterThanOrEqual(3);
  });

  it("tests only figures outside the key sections", () => {
    const board = buildAssumptionBoard(view({}));
    expect(board?.assumptions.some((a) => a.sectionLabel === "Problem")).toBe(
      false,
    );
  });

  it("is for investor readers only (the owner gets none)", () => {
    expect(buildAssumptionBoard(view({ viewer: "OWNER" }))).toBeNull();
  });

  it("never reads an unconfirmed reading, even if one arrived", () => {
    const base = view({});
    const unconfirmed = view({
      extraction:
        base.extraction === null
          ? null
          : { ...base.extraction, confirmed: false },
    });
    const board = buildAssumptionBoard(unconfirmed);
    expect(board?.basis).toBe("NOTHING_SHARED");
    expect(board?.assumptions.every((a) => a.value === null)).toBe(true);
    expect(
      board?.assumptions.every((a) => a.unknownReason === "NOT_SHARED"),
    ).toBe(true);
    expect(JSON.stringify(board)).not.toContain("₦38m");
  });

  it("with no deck shared, every key claim is not known yet", () => {
    const board = buildAssumptionBoard(view({ deck: null }));
    if (board === null) throw new Error("expected a board");
    expect(board.basis).toBe("NOTHING_SHARED");
    expect(board.counts).toEqual({ evidenced: 0, claimed: 0, unknown: 5 });
    expect(assumptionBoardText("Ledgerline", board)).toContain("not known yet");
  });
});
