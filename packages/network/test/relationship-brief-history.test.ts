import { describe, expect, it } from "vitest";

import { historyOf } from "../src/application/relationship-brief.js";

/**
 * Stress 2026-10-28 (J7-I, J7-F): the brief now carries what happened
 * between the two sides, from the history that side may see: Aster's
 * interest with its note, LedgerBridge's acceptance and the shared deck.
 */
const INTEREST = "40c21ea8-4455-4b35-9e2d-e4be817599e6";
const DECK = "4cfdc5e3-cd9b-4926-9558-b1ca6c714375";
const visible = [
  {
    sequence: 3,
    eventType: "connection_accepted",
    occurredAt: "2026-10-28T17:27:19.798Z",
    visibilityScope: "relationship_shared" as const,
    payload: { interestId: INTEREST },
  },
  {
    sequence: 2,
    eventType: "interest_expressed",
    occurredAt: "2026-10-28T17:21:38.752Z",
    visibilityScope: "relationship_shared" as const,
    payload: { interestId: INTEREST },
  },
  {
    sequence: 4,
    eventType: "document_shared",
    occurredAt: "2026-10-28T17:28:20.000Z",
    visibilityScope: "relationship_shared" as const,
    payload: { documentId: DECK },
  },
];
const interests = new Map([
  [
    INTEREST,
    {
      note: "Interested in your merchant payments traction.",
      expressedBy: "INVESTOR" as const,
    },
  ],
]);
const documentTitles = new Map([[DECK, "LedgerBridge seed deck"]]);

describe("historyOf", () => {
  it("the investor's side: their interest and note, the founder's accept and share", () => {
    expect(
      historyOf({ visible, side: "INVESTOR", interests, documentTitles }),
    ).toEqual([
      {
        kind: "INTEREST_EXPRESSED",
        at: "2026-10-28T17:21:38.752Z",
        by: "YOUR_SIDE",
        note: "Interested in your merchant payments traction.",
        document: null,
      },
      {
        kind: "CONNECTION_ACCEPTED",
        at: "2026-10-28T17:27:19.798Z",
        by: "OTHER_SIDE",
        note: null,
        document: null,
      },
      {
        kind: "DOCUMENT_SHARED",
        at: "2026-10-28T17:28:20.000Z",
        by: "OTHER_SIDE",
        note: null,
        document: "LedgerBridge seed deck",
      },
    ]);
  });

  it("the founder's side reads the same steps from their side; an unread note stays unknown", () => {
    const steps = historyOf({
      visible,
      side: "COMPANY",
      interests: new Map(),
      documentTitles: new Map(),
    });
    expect(steps.map((step) => [step.kind, step.by, step.note])).toEqual([
      ["INTEREST_EXPRESSED", "OTHER_SIDE", null],
      ["CONNECTION_ACCEPTED", "YOUR_SIDE", null],
      ["DOCUMENT_SHARED", "YOUR_SIDE", null],
    ]);
  });
});
