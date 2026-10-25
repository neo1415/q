import { describe, expect, it } from "vitest";

import { createFounderDocumentReview } from "../src/integration/review-service.js";

/**
 * Live e2e 25 Oct: a re-uploaded deck that added nothing new left no trace,
 * and the screen waited on it in silence. A review that read the document
 * records that it finished, with its count of new offers (zero included);
 * one whose model could not read it records nothing (§46: not "nothing new").
 */

const SESSION = "f0000000-0000-4000-8000-000000000001";
const event = {
  tenantId: "a0000000-0000-4000-8000-000000000001",
  documentId: "d0000000-0000-4000-8000-000000000001",
  documentVersionId: "e0000000-0000-4000-8000-000000000001",
} as never;

function outcome(blocked: "MODEL_UNAVAILABLE" | null) {
  return {
    candidates: [],
    taxonomy: [],
    conflicts: [],
    ambiguities: [],
    missing: [],
    proposed: [],
    summary: "Nothing new.",
    blocked,
    telemetry: {
      promptBundleVersion: null,
      providerCode: null,
      modelCode: null,
      passageCount: 1,
      documentCount: 1,
      candidateCount: 0,
      conflictCount: 0,
      ambiguityCount: 0,
      rejectedCandidateCount: 0,
      rejectedCitationCount: 0,
      latencyMs: 1,
      costUsd: 0,
    },
  };
}

function reviewWith(blocked: "MODEL_UNAVAILABLE" | null) {
  const recorded: unknown[] = [];
  const review = createFounderDocumentReview({
    sql: (() => Promise.resolve([])) as never,
    documents: {
      findInTenant: () =>
        Promise.resolve({
          id: "d0000000-0000-4000-8000-000000000001",
          companyId: "c0000000-0000-4000-8000-000000000002",
          documentType: "PITCH_DECK",
          sensitivityClass: "CONFIDENTIAL",
          title: "Deck",
          createdByUserId: "b0000000-0000-4000-8000-000000000001",
        }),
    } as never,
    chunks: {
      listActiveByVersion: () =>
        Promise.resolve([
          {
            content: "Tamarind Ledger: payroll for Ghanaian SMEs.",
            chunkIndex: 0,
            locator: { slide: 1 },
          },
        ]),
    } as never,
    sessions: { findActive: () => Promise.resolve({ id: SESSION }) } as never,
    responses: { listCurrent: () => Promise.resolve([]) } as never,
    suggestions: { listPending: () => Promise.resolve([]) } as never,
    createSuggestion: () => Promise.reject(new Error("nothing to offer")),
    extraction: { extract: () => Promise.resolve(outcome(blocked)) },
    recordReview: (review) => {
      recorded.push(review);
      return Promise.resolve();
    },
  });
  return { review, recorded };
}

describe("a finished document review is recorded", () => {
  it("with nothing new: recorded with zero new offers", async () => {
    const { review, recorded } = reviewWith(null);
    await expect(review.onDocumentReady(event)).resolves.toMatchObject({
      kind: "PREPARED",
      suggestionsCreated: 0,
    });
    expect(recorded).toEqual([
      {
        tenantId: "a0000000-0000-4000-8000-000000000001",
        sessionId: SESSION,
        documentId: "d0000000-0000-4000-8000-000000000001",
        documentVersionId: "e0000000-0000-4000-8000-000000000001",
        suggestionsCreated: 0,
      },
    ]);
  });

  it("a model that could not read it records nothing", async () => {
    const { review, recorded } = reviewWith("MODEL_UNAVAILABLE");
    await review.onDocumentReady(event);
    expect(recorded).toEqual([]);
  });
});
