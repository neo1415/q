import { describe, expect, it } from "vitest";

import { createFounderDocumentReview } from "../src/integration/review-service.js";

/**
 * Lane ob1: a private data-room document uploaded during onboarding is
 * acknowledged by its metadata and never read. The proof is structural:
 * no chunk is listed, no session looked up, no model called, no
 * suggestion made.
 */

function reviewWith(documentType: string, sensitivityClass = "CONFIDENTIAL") {
  const touched: string[] = [];
  const never = (what: string) => () => {
    touched.push(what);
    return Promise.reject(new Error(`${what} must not be reached`));
  };
  const review = createFounderDocumentReview({
    sql: {} as never,
    documents: {
      findInTenant: () =>
        Promise.resolve({
          id: "d0000000-0000-4000-8000-000000000001",
          companyId: "c0000000-0000-4000-8000-000000000002",
          documentType,
          sensitivityClass,
          title: "Private",
          createdByUserId: "b0000000-0000-4000-8000-000000000001",
        }),
    } as never,
    chunks: { listActiveByVersion: never("chunks") } as never,
    sessions: { findActive: never("session") } as never,
    responses: { listCurrent: never("responses") } as never,
    suggestions: { listPending: never("suggestions") } as never,
    createSuggestion: never("createSuggestion"),
    extraction: { extract: never("model") },
  });
  return { review, touched };
}

const event = {
  tenantId: "a0000000-0000-4000-8000-000000000001",
  documentId: "d0000000-0000-4000-8000-000000000001",
  documentVersionId: "e0000000-0000-4000-8000-000000000001",
} as never;

describe("onboarding document gate (ob1)", () => {
  it.each([
    "MANAGEMENT_ACCOUNTS",
    "FINANCIAL_MODEL",
    "LEGAL",
    "CORPORATE",
    "OTHER",
    "UNCLASSIFIED",
  ])(
    "%s is acknowledged by metadata only: nothing reads it",
    async (documentType) => {
      const { review, touched } = reviewWith(documentType);
      await expect(review.onDocumentReady(event)).resolves.toEqual({
        kind: "SKIPPED",
        reason: "NOT_FOR_ONBOARDING_READING",
      });
      expect(touched).toEqual([]);
    },
  );

  it("a highly confidential deck is not read either", async () => {
    const { review, touched } = reviewWith("PITCH_DECK", "HIGHLY_CONFIDENTIAL");
    await expect(review.onDocumentReady(event)).resolves.toMatchObject({
      reason: "NOT_FOR_ONBOARDING_READING",
    });
    expect(touched).toEqual([]);
  });

  it("a deck goes on to be read (it reaches the session lookup)", async () => {
    const { review, touched } = reviewWith("PITCH_DECK");
    await review.onDocumentReady(event).catch(() => undefined);
    expect(touched[0]).toBe("session");
  });
});
