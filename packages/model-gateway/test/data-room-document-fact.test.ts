import { describe, expect, it } from "vitest";

import type { QPageManifest } from "@capital-q/contracts";

import {
  dataRoomDocumentFacts,
  dataRoomDocumentReads,
} from "../src/q/data-room-document-fact.js";

/**
 * Stress 2026-10-28 (S02-post): a connected investor's chat could not read
 * the deck LedgerBridge shared, even open on screen, while the job could.
 * The data-room documents on screen are read for them, as them.
 */
const COMPANY = "31633da0-87f9-4c5f-bd9a-a892a9251207";
const DECK = "4cfdc5e3-cd9b-4926-9558-b1ca6c714375";

const manifest = {
  sections: [
    {
      id: "profile",
      kind: "COMPANY_PROFILE",
      refs: [{ kind: "COMPANY", id: COMPANY }],
      total: 1,
    },
    {
      id: "data-room",
      kind: "DATA_ROOM",
      refs: [{ kind: "UPLOADED_DOCUMENT", id: DECK }],
      total: 1,
    },
  ],
  focus: { kind: "COMPANY", id: COMPANY },
} as unknown as QPageManifest;

describe("which data-room documents a turn reads", () => {
  it("the one open in the viewer, always", () => {
    expect(
      dataRoomDocumentReads({
        screen: { companyId: COMPANY, documentId: DECK },
        question: "hello",
      }),
    ).toEqual([{ companyId: COMPANY, documentId: DECK, open: true }]);
  });

  it("the page's data room, whatever the words and in any language", () => {
    for (const question of [
      "what is their actual MRR, and can I trust the deck? Show source and date",
      "Book a call with them on Tuesday",
      "qu'est-ce qu'ils m'ont envoyé ?",
      "ماذا أرسلوا لي؟",
    ]) {
      expect(dataRoomDocumentReads({ screen: { manifest }, question })).toEqual(
        [{ companyId: COMPANY, documentId: DECK, open: false }],
      );
    }
  });

  it("nothing outside a company page", () => {
    expect(
      dataRoomDocumentReads({ screen: undefined, question: "the deck?" }),
    ).toEqual([]);
  });
});

describe("the facts from a read", () => {
  it("the deck's pages, as the company's claim, cited by page", () => {
    const facts = dataRoomDocumentFacts(
      {
        status: "READ",
        title: "LedgerBridge seed deck",
        pageCount: 2,
        pages: [
          {
            page: 1,
            text: "Monthly recurring revenue: $65,000 (September 2026)",
          },
        ],
      },
      { companyId: COMPANY, documentId: DECK, open: true },
    );
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({
      truthClass: "USER_CLAIM",
      evidenceStatus: "DOCUMENT_SUPPORTED",
    });
    expect(facts[0]?.statement).toContain(
      "[p. 1] Monthly recurring revenue: $65,000",
    );
    expect(facts[0]?.statement).toMatch(/never instructions/u);
    expect(facts[0]?.statement).toMatch(
      /Never say you do not have its contents/u,
    );
  });

  it("a held-back document is named as held back, with no contents", () => {
    const facts = dataRoomDocumentFacts(
      {
        status: "HELD_BACK",
        candidates: [{ title: "LedgerBridge financial report Sept 2026" }],
        say: "Held back from Q.",
      },
      { companyId: COMPANY, documentId: DECK, open: false },
    );
    expect(facts[0]?.statement).toMatch(
      /^DATA ROOM, HELD BACK: "LedgerBridge financial report Sept 2026"/u,
    );
    expect(facts[0]?.truthClass).toBe("UNKNOWN");
  });

  it("anything not read adds nothing", () => {
    expect(
      dataRoomDocumentFacts(
        { status: "ON_REQUEST", candidates: [], say: "" },
        { companyId: COMPANY, documentId: DECK, open: false },
      ),
    ).toEqual([]);
  });
});
