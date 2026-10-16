import { describe, expect, it } from "vitest";

import { createMandateReview } from "../src/integration/mandate-review-service.js";
import type { MandateSynthesis } from "../src/intelligence/contracts.js";

/**
 * Lane ob1 (owner decision 2026-10-16): an investor's own fund deck or
 * investment thesis is read by the same path as their narrative, into
 * proposals they confirm, only for the mandate fields an upload may
 * inform. An LP letter is never read.
 */

const TENANT = "a0000000-0000-4000-8000-000000000001";
const USER = "b0000000-0000-4000-8000-000000000001";
const SESSION = "f0000000-0000-4000-8000-000000000001";

function world(documentType: string, sensitivityClass = "CONFIDENTIAL") {
  const narratives: string[] = [];
  const proposed: { stepKey: string; sourceRefs: unknown }[] = [];
  const reading: MandateSynthesis = {
    constraints: [],
    taxonomy: [],
    columns: [
      { dimension: "currency", value: "USD", quote: "cheques in USD" },
      // A reading may name a discovery mode; a document may not propose it.
      { dimension: "discovery_mode", value: "exploratory", quote: "broad" },
    ],
    ambiguities: [],
    inferences: [],
    tensions: [],
    refused: [],
    missing: [],
    summary: "",
    blocked: null,
    telemetry: { providerCode: "test" },
  } as unknown as MandateSynthesis;
  const review = createMandateReview({
    sql: {} as never,
    sessions: {
      findById: () =>
        Promise.resolve({
          id: SESSION,
          userId: USER,
          tenantId: TENANT,
          journeyType: "investor",
          status: "ACTIVE",
          version: 4,
        }),
      findLatestActive: () => Promise.resolve({ id: SESSION }),
    } as never,
    responses: { listCurrent: () => Promise.resolve([]) } as never,
    suggestions: { listPending: () => Promise.resolve([]) } as never,
    synthesis: {
      synthesise: (request) => {
        narratives.push(request.narrative);
        return Promise.resolve(reading);
      },
    },
    taxonomy: { resolve: () => Promise.resolve([]) },
    createSuggestion: (command) => {
      proposed.push({
        stepKey: command.stepKey,
        sourceRefs: command.sourceRefs,
      });
      return Promise.resolve(null);
    },
    recordQuestions: () => Promise.resolve(null),
    documents: {
      findInTenant: () =>
        Promise.resolve({
          documentType,
          sensitivityClass,
          companyId: null,
          createdByUserId: USER,
        }),
    },
    chunks: {
      listActiveByVersion: () =>
        Promise.resolve([
          { content: "We write $250k seed cheques in USD across West Africa." },
        ]),
    },
  });
  return { review, narratives, proposed };
}

const event = {
  tenantId: TENANT,
  documentId: "d0000000-0000-4000-8000-000000000001",
  documentVersionId: "e0000000-0000-4000-8000-000000000001",
};

describe("investor document reading (ob1)", () => {
  it.each(["FUND_DECK", "INVESTMENT_THESIS"])(
    "%s feeds proposals for the fields an upload may inform, citing the document",
    async (documentType) => {
      const { review, narratives, proposed } = world(documentType);
      const result = await review.onDocumentReady(event);
      expect(result.kind).toBe("PREPARED");
      expect(narratives[0]).toContain("seed cheques in USD");
      expect(proposed.map((p) => p.stepKey)).toEqual(["I2.currency"]);
      expect(proposed[0]?.sourceRefs).toEqual([
        { sourceType: "EVIDENCE_DOCUMENT", sourceId: event.documentId },
      ]);
    },
  );

  it.each([
    ["LP_LETTER", "CONFIDENTIAL"],
    ["FUND_DECK", "HIGHLY_CONFIDENTIAL"],
    ["MANAGEMENT_ACCOUNTS", "CONFIDENTIAL"],
  ])("%s (%s) is never read", async (documentType, sensitivity) => {
    const { review, narratives, proposed } = world(documentType, sensitivity);
    await expect(review.onDocumentReady(event)).resolves.toEqual({
      kind: "SKIPPED",
      reason: "NOT_FOR_ONBOARDING_READING",
    });
    expect(narratives).toEqual([]);
    expect(proposed).toEqual([]);
  });
});
