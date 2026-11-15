import { describe, expect, it } from "vitest";

import {
  deckFigureCards,
  deckReadLine,
  uploadEventOf,
  uploadNote,
} from "../src/features/onboarding-conversation/upload-lines";

/**
 * Live founder onboarding, 2026-11-15
 * (docs/ai-handoff/audits/2026-11-15-founder-onboarding-live.md): the deck
 * "mangrove-tally-fictional-deck.pdf", its four page-cited figure cards and
 * its findings, in the run's own shape.
 */

const FILE = "mangrove-tally-fictional-deck.pdf";
const UPLOADED_AT = Date.parse("2026-11-15T09:35:50.000Z");

const PENDING = [
  {
    approvalId: "a1",
    summary: `Keep your MRR of USD 42,000 for October 2026, from ${FILE} (page 3)`,
    requestedAt: "2026-11-15T09:36:42.000Z",
  },
  {
    approvalId: "a2",
    summary: `Keep your paying customers of 1,850 for October 2026, from ${FILE} (page 3)`,
    requestedAt: "2026-11-15T09:36:42.000Z",
  },
  {
    approvalId: "a3",
    summary: `Keep your monthly burn of USD 55,000 for October 2026, from ${FILE} (page 4)`,
    requestedAt: "2026-11-15T09:36:43.000Z",
  },
  // Not this upload's: an older card, and a reply waiting to be sent.
  {
    approvalId: "old",
    summary:
      "Keep your MRR of USD 30,000 for August 2026, from old.pdf (page 2)",
    requestedAt: "2026-11-14T09:00:00.000Z",
  },
  {
    approvalId: "reply",
    summary: "Reply to Tensorgate",
    requestedAt: "2026-11-15T09:37:00.000Z",
  },
];

const FOUND = [
  {
    label: "The Problem",
    value:
      "Small retailers in Lagos keep their books in paper notebooks and lose track of credit sales.",
  },
  {
    label: "Solution",
    value: "A WhatsApp-first bookkeeping app for informal retailers.",
  },
];

describe("D1: Q says what the deck said, and offers its figures here", () => {
  it("only this upload's page-cited figure cards", () => {
    const cards = deckFigureCards(PENDING, UPLOADED_AT);
    expect(cards.map((card) => card.approvalId)).toEqual(["a1", "a2", "a3"]);
  });

  it("the line names what the company does and each figure with its page, saving nothing", () => {
    const line = deckReadLine(
      FILE,
      FOUND,
      deckFigureCards(PENDING, UPLOADED_AT),
    );
    expect(line).toMatch(
      new RegExp(`^I've read ${FILE.replace(/\./gu, "\\.")}\\.`, "u"),
    );
    expect(line).toContain(
      "Solution: A WhatsApp-first bookkeeping app for informal retailers",
    );
    expect(line).toContain("MRR of USD 42,000 for October 2026");
    expect(line).toContain("(page 3)");
    expect(line).toContain("(page 4)");
    expect(line).toMatch(/None of this is saved until you confirm it/u);
    // Never the generic read-back of the record.
    expect(line).not.toMatch(/saved so far|Still to cover/u);
  });

  it("with no figures yet, it still says what it read, and claims no figures", () => {
    const line = deckReadLine(FILE, FOUND, []);
    expect(line).not.toMatch(/figure/u);
    expect(line).toMatch(/It says: The Problem:/u);
  });
});

describe("D5: the screen's upload notes are an event, not the founder's words", () => {
  it("every note is recognised, with its file", () => {
    for (const kind of [
      "READ_BACK",
      "STILL_READING",
      "READING_NOW",
      "UNCLASSIFIED",
      "PRIVATE",
      "FINISHED_READING",
      "WAITING_FOR_COMPANY",
    ] as const) {
      expect(uploadEventOf(uploadNote(kind, FILE))).toBe(FILE);
    }
  });

  it("the run's exact line is one", () => {
    expect(
      uploadEventOf(
        `I've just uploaded ${FILE}. Read back what you found in it and check it with me.`,
      ),
    ).toBe(FILE);
  });

  it("their own words about a deck stay theirs", () => {
    expect(uploadEventOf("I've just uploaded the deck.")).toBeNull();
    expect(uploadEventOf("We have 1,850 paying retailers.")).toBeNull();
  });
});
