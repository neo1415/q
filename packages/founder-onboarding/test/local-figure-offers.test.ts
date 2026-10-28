import { describe, expect, it, vi } from "vitest";

import type { OnboardingResponseValue } from "@capital-q/contracts";
import type { ExtractedBlock } from "@capital-q/evidence";
import {
  isLocalFigureProposal,
  LOCAL_FIGURE_SOURCE as RUNTIME_LOCAL_FIGURE_SOURCE,
} from "@capital-q/onboarding";

import {
  createFinancialKnowledgeRecorder,
  createFounderWriteTargets,
  createLocalFigureOffers,
  extractLocalFigures,
  LOCAL_FIGURE_SOURCE,
  localFigureOf,
  localFigureRefs,
  type FinancialKnowledgePort,
  type LocalFigureOfferDependencies,
} from "../src/index.js";

/**
 * Owner decision 2026-10-28: the figures code read from a founder's
 * financial document are offered as onboarding suggestions (Keep / Change /
 * Not this), once per document version, in the currency the document
 * states; what they keep becomes their own USER_CLAIM for that period.
 */

const COMPANY = "11111111-1111-4111-8111-111111111111";
const ORG = "22222222-2222-4222-8222-222222222222";
const SESSION = "33333333-3333-4333-8333-333333333333";
const DOC = "44444444-4444-4444-8444-444444444444";
const VERSION = "55555555-5555-4555-8555-555555555555";
const USER = "66666666-6666-4666-8666-666666666666";

const ACCOUNTS: readonly ExtractedBlock[] = [
  {
    kind: "heading",
    level: 1,
    text: "Management accounts — September 2026",
    locator: { page: 1, index: 0 },
  },
  {
    kind: "paragraph",
    text: "All figures in USD.",
    locator: { page: 1, index: 1 },
  },
  {
    kind: "table",
    rows: [
      ["Metric", "Aug 2026", "Sep 2026"],
      ["MRR", "48,000", "51,000"],
      ["Annualised MRR", "576,000", "612,000"],
      ["Net burn", "(61,000)", "(65,000)"],
      ["Closing cash", "375,000", "310,000"],
    ],
    locator: { page: 1, index: 2 },
  },
];

const document = {
  tenantId: "t",
  documentId: DOC,
  documentVersionId: VERSION,
  companyId: COMPANY,
  documentType: "MANAGEMENT_ACCOUNTS",
  title: "Q3 management accounts",
  createdByUserId: USER,
};

function harness(
  answers: Record<string, OnboardingResponseValue> = {},
  offeredBefore: readonly string[] = [],
) {
  const created: Parameters<
    LocalFigureOfferDependencies["createSuggestion"]
  >[0][] = [];
  const offered = new Set(offeredBefore);
  const offers = createLocalFigureOffers({
    sql: {} as never,
    sessions: {
      findActive: () => Promise.resolve({ id: SESSION } as never),
    },
    responses: {
      listCurrent: () =>
        Promise.resolve(
          Object.entries(answers).map(([stepKey, value]) => ({
            stepKey,
            value,
          })),
        ),
    },
    offeredFromVersion: () => Promise.resolve(new Set(offered)),
    createSuggestion: (command) => {
      created.push(command);
      offered.add(command.stepKey);
      return Promise.resolve({});
    },
  });
  return { offers, created };
}

describe("local figure offers (the worker hook)", () => {
  it("offers each figure with a step, with its provenance, and proposes the stated currency", async () => {
    const { offers, created } = harness();
    const result = await offers.onDocumentProcessed({
      document,
      blocks: ACCOUNTS,
    });
    expect(result).toMatchObject({ kind: "OFFERED", offered: 4 });
    expect(created.map((c) => c.stepKey)).toEqual([
      "F5.fin_currency",
      "F5.monthly_revenue",
      "F5.monthly_burn",
      "F5.cash",
    ]);
    const mrr = created[1];
    expect(mrr?.suggestedValue).toEqual({ type: "RANGE", value: "51000" });
    expect(mrr?.rationale).toContain("Q3 management accounts");
    expect(mrr?.rationale).toContain("September 2026");
    expect(mrr?.rationale).toContain("no model saw this document");
    expect(isLocalFigureProposal(mrr?.sourceRefs ?? [])).toBe(true);
    expect(localFigureOf(mrr?.sourceRefs ?? [])).toMatchObject({
      measure: "monthly_revenue",
      period: { granularity: "MONTH", key: "2026-09" },
      currency: "USD",
      documentId: DOC,
      documentVersionId: VERSION,
      where: "page 1, table 1, row 2",
    });
    // Annual revenue has no question in the journey: read, not offered.
    expect(result).toMatchObject({ read: 4, notOffered: 1 });
  });

  it("is idempotent per document version: a second run offers nothing", async () => {
    const { offers, created } = harness();
    await offers.onDocumentProcessed({ document, blocks: ACCOUNTS });
    const first = created.length;
    const again = await offers.onDocumentProcessed({
      document,
      blocks: ACCOUNTS,
    });
    expect(created).toHaveLength(first);
    expect(again).toMatchObject({ offered: 0, alreadyOffered: 3 });
  });

  it("never offers a figure equal to their answer, nor one in another currency", async () => {
    const { offers, created } = harness({
      "F5.fin_currency": { type: "SINGLE_SELECT", optionKey: "ngn" },
      "F5.monthly_revenue": { type: "RANGE", value: "51000" },
    });
    const result = await offers.onDocumentProcessed({
      document,
      blocks: ACCOUNTS,
    });
    // USD figures for a founder who reports in NGN are never relabelled.
    expect(created).toEqual([]);
    expect(result).toMatchObject({ offered: 0 });
  });

  it("skips what is not a founder's financial document", async () => {
    const { offers, created } = harness();
    expect(
      await offers.onDocumentProcessed({
        document: { ...document, documentType: "PITCH_DECK" },
        blocks: ACCOUNTS,
      }),
    ).toMatchObject({ kind: "SKIPPED", reason: "NOT_FINANCIAL" });
    expect(created).toEqual([]);
  });

  it("uses the onboarding runtime's own marker", () => {
    expect(LOCAL_FIGURE_SOURCE).toBe(RUNTIME_LOCAL_FIGURE_SOURCE);
  });
});

describe("confirmation becomes the founder's own claim", () => {
  const candidate = extractLocalFigures(ACCOUNTS).candidates.find(
    (c) => c.measure === "monthly_revenue",
  );
  const refs = localFigureRefs(candidate ?? (undefined as never), {
    documentId: DOC,
    documentVersionId: VERSION,
  });

  async function keep(
    value: string,
    modality: "SUGGESTION_ACCEPT" | "SUGGESTION_EDIT",
  ) {
    const record = vi.fn<FinancialKnowledgePort["record"]>(() =>
      Promise.resolve(null),
    );
    const handler = createFounderWriteTargets({
      outbox: {} as never,
      audit: {} as never,
      services: () => ({}) as never,
      financialKnowledge: () => ({ record }),
    }).find((target) => target.targetKey === "company.financial_claims");
    await handler?.apply(
      {
        tx: {} as never,
        actor: {
          context: { organisationId: ORG, userId: USER, tenantId: "t" },
        } as never,
        session: {
          id: SESSION,
          organisationId: ORG,
          subject: { subjectType: "COMPANY", subjectId: COMPANY },
        } as never,
        step: {} as never,
        correlationId: "cor_test_local_figures",
        // Their raise is in GBP and no reporting currency is chosen: the
        // figure keeps the currency its document states.
        currentResponses: new Map([
          [
            "F6.currency",
            {
              stepKey: "F6.currency",
              value: { type: "SINGLE_SELECT", optionKey: "gbp" },
            },
          ],
        ]) as never,
        bindContext: () => Promise.reject(new Error("not used")),
        resolvingSuggestion: {
          id: "77777777-7777-4777-8777-777777777777",
          sessionId: SESSION,
          stepKey: "F5.monthly_revenue",
          targetField: "financial.monthly_revenue",
          suggestedValue: { type: "RANGE", value: "51000" },
          sourceRefs: refs,
          confidence: "0.9",
          status: "PENDING",
          modelRunId: null,
          createdAt: "2026-10-28T00:00:00.000Z",
          resolvedAt: null,
        } as never,
      },
      {
        stepKey: "F5.monthly_revenue",
        value: { type: "RANGE", value },
        note: null,
        sourceModality: modality,
      } as never,
    );
    return record.mock.calls[0]?.[0];
  }

  it("kept: USD 51,000 for September 2026, the document named, never relabelled", async () => {
    const call = await keep("51000", "SUGGESTION_ACCEPT");
    expect(call?.claim).toMatchObject({
      knowledgeKey: "financial.monthly_revenue",
      statement:
        "The founder confirmed monthly revenue for September 2026 was USD 51,000, as stated in their financial document.",
      structuredValue: {
        kind: "MONEY",
        amount: "51000",
        currency: "USD",
        origin: "DOCUMENT_FIGURE",
        measure: "monthly_revenue",
        period: "2026-09",
        periodGranularity: "MONTH",
        documentId: DOC,
        documentVersionId: VERSION,
        confirmation: "KEPT",
      },
      fromDocument: {
        externalReference: `document-figure:${VERSION}:monthly_revenue:2026-09`,
        validFrom: "2026-09-01T00:00:00.000Z",
        validTo: "2026-10-01T00:00:00.000Z",
      },
    });
  });

  it("changed: their corrected figure is theirs, still for that period", async () => {
    const call = await keep("50500", "SUGGESTION_EDIT");
    expect(call?.claim.statement).toBe(
      "The founder stated monthly revenue for September 2026 was USD 50,500, correcting the figure read from their financial document.",
    );
    expect(call?.claim.structuredValue).toMatchObject({
      amount: "50500",
      confirmation: "EDITED",
    });
  });

  it("is recorded as a USER_STATEMENT (founder_private), SELF_REPORTED, USER_CLAIM over the period", async () => {
    const claim = (await keep("51000", "SUGGESTION_ACCEPT"))?.claim;
    const sources: { input: Record<string, unknown> }[] = [];
    const submitted: { candidate: Record<string, unknown> }[] = [];
    const items: { input: Record<string, unknown> }[] = [];
    await createFinancialKnowledgeRecorder({
      evidence: {
        registerEvidenceSource: (command: never) => {
          sources.push(command);
          return Promise.resolve({
            id: "88888888-8888-4888-8888-888888888888",
          });
        },
        createEvidenceItem: (command: never) => {
          items.push(command);
          return Promise.resolve({
            id: "99999999-9999-4999-8999-999999999999",
          });
        },
      } as never,
      gate: {
        submit: (command: never) => {
          submitted.push(command);
          return Promise.resolve({ outcome: "PERSISTED" });
        },
      } as never,
    }).record({
      actor: { userId: USER } as never,
      companyId: COMPANY as never,
      sessionId: SESSION,
      correlationId: "cor_test_local_figures",
      claim: claim ?? (undefined as never),
    });
    expect(sources[0]?.input).toMatchObject({
      sourceType: "USER_STATEMENT",
      visibilityScope: "founder_private",
      externalReference: `document-figure:${VERSION}:monthly_revenue:2026-09`,
    });
    expect(items[0]?.input).toMatchObject({ evidenceStatus: "SELF_REPORTED" });
    expect(submitted[0]?.candidate).toMatchObject({
      truthClassProposal: "USER_CLAIM",
      validFrom: "2026-09-01T00:00:00.000Z",
      validTo: "2026-10-01T00:00:00.000Z",
      reason: "USER_CONFIRMED_DOCUMENT_FIGURE",
    });
    // The document's text is not part of the claim: only the figure.
    expect(JSON.stringify(submitted)).not.toContain("48,000");
  });
});
