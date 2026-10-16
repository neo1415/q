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
const FIRM = "c0000000-0000-4000-8000-000000000001";
const OTHER_FIRM = "c0000000-0000-4000-8000-000000000002";

function world(
  documentType: string,
  sensitivityClass = "CONFIDENTIAL",
  owner: { companyId: string | null; ownerOrganisationId: string | null } = {
    companyId: null,
    ownerOrganisationId: FIRM,
  },
  /** False: an unpaged document (Word, plain text), with no page text. */
  paged = true,
) {
  const narratives: string[] = [];
  const pageReads: unknown[] = [];
  const extractionReads: unknown[] = [];
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
          organisationId: FIRM,
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
          ...owner,
          createdByUserId: USER,
        }),
    },
    pages: {
      listByVersion: (_sql, tenantId, document) => {
        pageReads.push({ tenantId, ...document });
        return Promise.resolve(
          paged
            ? [
                {
                  text: "We write $250k seed cheques in USD across West Africa.",
                },
              ]
            : [],
        );
      },
    },
    extractionText: {
      read: (query) => {
        extractionReads.push(query);
        return Promise.resolve(
          "Thesis: we write seed cheques in USD across East Africa.",
        );
      },
    },
  });
  return { review, narratives, proposed, pageReads, extractionReads };
}

const event = {
  tenantId: TENANT,
  documentId: "d0000000-0000-4000-8000-000000000001",
  documentVersionId: "e0000000-0000-4000-8000-000000000001",
};

describe("investor document reading (ob1)", () => {
  it("a firm's fund deck with no company yields proposals from its own extracted pages", async () => {
    // ob2 2026-10-16: knowledge passages are cut only for a company's
    // documents, so a firm's deck must be read from its extracted pages.
    const { review, narratives, proposed, pageReads } = world("FUND_DECK");
    const result = await review.onDocumentReady(event);
    expect(result).toMatchObject({ kind: "PREPARED", suggestionsCreated: 1 });
    expect(pageReads).toEqual([
      {
        tenantId: TENANT,
        documentId: event.documentId,
        documentVersionId: event.documentVersionId,
        ownerOrganisationId: FIRM,
      },
    ]);
    expect(narratives[0]).toContain("seed cheques in USD");
    // Proposals only: nothing is saved until the investor confirms.
    expect(proposed).toEqual([
      {
        stepKey: "I2.currency",
        sourceRefs: [
          { sourceType: "EVIDENCE_DOCUMENT", sourceId: event.documentId },
        ],
      },
    ]);
  });

  it("an unpaged thesis (Word, plain text) is read from its own extraction, same scope", async () => {
    const { review, narratives, proposed, pageReads, extractionReads } = world(
      "INVESTMENT_THESIS",
      "CONFIDENTIAL",
      { companyId: null, ownerOrganisationId: FIRM },
      false,
    );
    const result = await review.onDocumentReady(event);
    expect(result).toMatchObject({ kind: "PREPARED", suggestionsCreated: 1 });
    expect(pageReads).toHaveLength(1);
    expect(extractionReads).toEqual([
      {
        tenantId: TENANT,
        documentId: event.documentId,
        documentVersionId: event.documentVersionId,
        ownerOrganisationId: FIRM,
        maxChars: 12_000,
      },
    ]);
    expect(narratives[0]).toContain("seed cheques in USD across East Africa");
    expect(proposed.map((p) => p.stepKey)).toEqual(["I2.currency"]);
  });

  it("a paged deck never falls back to its extraction", async () => {
    const { review, extractionReads } = world("FUND_DECK");
    await review.onDocumentReady(event);
    expect(extractionReads).toEqual([]);
  });

  it("an LP letter yields no proposals and its pages are never read", async () => {
    const { review, narratives, proposed, pageReads, extractionReads } = world(
      "LP_LETTER",
      "CONFIDENTIAL",
      undefined,
      false,
    );
    await expect(review.onDocumentReady(event)).resolves.toEqual({
      kind: "SKIPPED",
      reason: "NOT_FOR_ONBOARDING_READING",
    });
    expect(pageReads).toEqual([]);
    expect(extractionReads).toEqual([]);
    expect(narratives).toEqual([]);
    expect(proposed).toEqual([]);
  });

  it.each([
    ["another firm's", { companyId: null, ownerOrganisationId: OTHER_FIRM }],
    ["an unowned", { companyId: null, ownerOrganisationId: null }],
    [
      "a company's",
      {
        companyId: "a1000000-0000-4000-8000-000000000001",
        ownerOrganisationId: FIRM,
      },
    ],
  ])(
    "%s fund deck is never read into this firm's mandate",
    async (_label, owner) => {
      // Unpaged, so the extraction would be the next thing read.
      const { review, narratives, proposed, pageReads, extractionReads } =
        world("FUND_DECK", "CONFIDENTIAL", owner, false);
      await expect(review.onDocumentReady(event)).resolves.toEqual({
        kind: "SKIPPED",
        reason: "NOT_FOR_ONBOARDING_READING",
      });
      expect(pageReads).toEqual([]);
      expect(extractionReads).toEqual([]);
      expect(narratives).toEqual([]);
      expect(proposed).toEqual([]);
    },
  );

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
