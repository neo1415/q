import { describe, expect, it, vi } from "vitest";
import {
  derivedKnowledgeSensitivity,
  derivedKnowledgeVisibility,
} from "@capital-q/q-knowledge";
import type { OnboardingResponseValue } from "@capital-q/contracts";

import {
  createFinancialKnowledgeRecorder,
  createFounderFinancialCheck,
  createFounderWriteTargets,
  deckFinancialFigures,
  financialClaimFor,
  financialContradictions,
  parseDeckNumber,
  type DeckReading,
  type FinancialKnowledgePort,
} from "../src/index.js";

/**
 * Q.01 financials: each figure is the founder's own claim (USER_CLAIM,
 * SELF_REPORTED, founder_private), unknown stays unknown, and a stated
 * figure that disagrees with the founder's confirmed deck becomes one
 * CONTRADICTION question with both readings kept.
 */

const COMPANY = "11111111-1111-4111-8111-111111111111";
const ORG = "22222222-2222-4222-8222-222222222222";
const SESSION = "33333333-3333-4333-8333-333333333333";
const DOC = "44444444-4444-4444-8444-444444444444";

const select = (optionKey: string): OnboardingResponseValue => ({
  type: "SINGLE_SELECT",
  optionKey,
});
const range = (value: string): OnboardingResponseValue => ({
  type: "RANGE",
  value,
});
const values = (entries: Record<string, OnboardingResponseValue>) =>
  new Map(Object.entries(entries));

describe("financialClaimFor", () => {
  it("records money as a decimal string with its ISO currency", () => {
    const claim = financialClaimFor(
      "F5.monthly_revenue",
      values({
        "F5.fin_currency": select("usd"),
        "F5.monthly_revenue": range("18000.00"),
      }),
    );
    expect(claim).toEqual({
      stepKey: "F5.monthly_revenue",
      knowledgeKey: "financial.monthly_revenue",
      statement: "The founder said revenue last month was USD 18,000.",
      structuredValue: { kind: "MONEY", amount: "18000", currency: "USD" },
    });
  });

  it("never guesses a currency: no currency, no money claim", () => {
    expect(
      financialClaimFor("F5.cash", values({ "F5.cash": range("50000") })),
    ).toBeNull();
  });

  it("a skipped step is unknown, never zero", () => {
    expect(financialClaimFor("F5.monthly_burn", values({}))).toBeNull();
  });

  it("uses the raise's currency for the smallest cheque", () => {
    const claim = financialClaimFor(
      "F6.min_cheque",
      values({
        "F5.fin_currency": select("ngn"),
        "F6.currency": select("usd"),
        "F6.min_cheque": range("25000"),
      }),
    );
    expect(claim?.structuredValue).toEqual({
      kind: "MONEY",
      amount: "25000",
      currency: "USD",
    });
    expect(claim?.knowledgeKey).toBe("capital.min_cheque");
  });

  it("records margin, runway and trend in their own kinds", () => {
    const answers = values({
      "F5.gross_margin": range("72"),
      "F5.runway_months": range("14"),
      "F5.revenue_trend": select("growing"),
    });
    expect(
      financialClaimFor("F5.gross_margin", answers)?.structuredValue,
    ).toEqual({
      kind: "PERCENTAGE",
      value: "72",
    });
    expect(financialClaimFor("F5.runway_months", answers)?.knowledgeKey).toBe(
      "financial.runway_months",
    );
    expect(
      financialClaimFor("F5.revenue_trend", answers)?.structuredValue,
    ).toEqual({
      kind: "TEXT",
      value: "growing",
    });
  });
});

describe("the financial write target and the Write Gate", () => {
  it("records through the port as the founder, for the session's own company", async () => {
    const record = vi.fn<FinancialKnowledgePort["record"]>(() =>
      Promise.resolve(null),
    );
    const handler = createFounderWriteTargets({
      outbox: {} as never,
      audit: {} as never,
      services: () => ({}) as never,
      financialKnowledge: () => ({ record }),
    }).find((target) => target.targetKey === "company.financial_claims");
    expect(handler).toBeDefined();
    const actorContext = { organisationId: ORG, userId: "u", tenantId: "t" };
    await handler?.apply(
      {
        tx: {} as never,
        actor: { context: actorContext } as never,
        session: {
          id: SESSION,
          organisationId: ORG,
          subject: { subjectType: "COMPANY", subjectId: COMPANY },
        } as never,
        step: {} as never,
        correlationId: "cor_test_financials",
        currentResponses: new Map([
          [
            "F5.fin_currency",
            { stepKey: "F5.fin_currency", value: select("gbp") },
          ],
        ]) as never,
        bindContext: () => Promise.reject(new Error("not used")),
      },
      {
        stepKey: "F5.monthly_burn",
        value: range("40000"),
        note: null,
      } as never,
    );
    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0]?.[0]).toMatchObject({
      actor: actorContext,
      companyId: COMPANY,
      sessionId: SESSION,
      claim: {
        knowledgeKey: "financial.burn_rate",
        structuredValue: { kind: "MONEY", amount: "40000", currency: "GBP" },
      },
    });
  });

  it("writes a founder_private, HIGHLY_CONFIDENTIAL source, a SELF_REPORTED item and a USER_CLAIM candidate", async () => {
    const sources: unknown[] = [];
    const items: unknown[] = [];
    const submitted: unknown[] = [];
    const recorder = createFinancialKnowledgeRecorder({
      evidence: {
        registerEvidenceSource: (command: unknown) => {
          sources.push(command);
          return Promise.resolve({
            id: "55555555-5555-4555-8555-555555555555",
          });
        },
        createEvidenceItem: (command: unknown) => {
          items.push(command);
          return Promise.resolve({
            id: "66666666-6666-4666-8666-666666666666",
          });
        },
      } as never,
      gate: {
        submit: (command: unknown) => {
          submitted.push(command);
          return Promise.resolve({ outcome: "PERSISTED" });
        },
      } as never,
    });
    await recorder.record({
      actor: { userId: "u" } as never,
      companyId: COMPANY as never,
      sessionId: SESSION,
      correlationId: "cor_test_financials",
      claim: {
        stepKey: "F5.cash",
        knowledgeKey: "financial.cash_balance",
        statement: "The founder said cash in the bank is USD 200,000.",
        structuredValue: { kind: "MONEY", amount: "200000", currency: "USD" },
      },
    });
    expect(sources[0]).toMatchObject({
      input: {
        sourceType: "USER_STATEMENT",
        visibilityScope: "founder_private",
        sensitivityClass: "HIGHLY_CONFIDENTIAL",
      },
    });
    expect(items[0]).toMatchObject({
      input: { evidenceStatus: "SELF_REPORTED" },
    });
    expect(submitted[0]).toMatchObject({
      candidate: {
        truthClassProposal: "USER_CLAIM",
        knowledgeKey: "financial.cash_balance",
        structuredValue: { kind: "MONEY", amount: "200000", currency: "USD" },
      },
    });
  });

  it("the gate keeps a founder-private figure founder-private (never network or public)", () => {
    expect(derivedKnowledgeVisibility(["founder_private"])).toBe(
      "founder_private",
    );
    expect(derivedKnowledgeSensitivity(["HIGHLY_CONFIDENTIAL"])).toBe(
      "HIGHLY_CONFIDENTIAL",
    );
  });
});

const deck = (overrides: Partial<DeckReading> = {}): DeckReading => ({
  documentId: DOC,
  confirmed: false,
  reviews: [{ section: "TRACTION", action: "CONFIRM" }],
  sections: [
    {
      section: "TRACTION",
      status: "PRESENT",
      summary: "Growing revenue.",
      pages: [7],
      confidence: "HIGH",
      facts: [
        {
          label: "MRR",
          value: "$14k",
          unknownReason: null,
          kind: "FIGURE",
          asOf: "May 2026",
          pages: [7],
          truthClass: "USER_CLAIM",
          evidenceStatus: "SELF_REPORTED",
          confidence: "HIGH",
        },
      ],
    },
    {
      section: "FINANCIALS",
      status: "PRESENT",
      summary: "Margins.",
      pages: [9],
      confidence: "HIGH",
      facts: [
        {
          label: "Gross margin",
          value: "68%",
          unknownReason: null,
          kind: "FIGURE",
          asOf: null,
          pages: [9],
          truthClass: "USER_CLAIM",
          evidenceStatus: "SELF_REPORTED",
          confidence: "HIGH",
        },
      ],
    },
  ] as never,
  ...overrides,
});

describe("deck figures and contradictions", () => {
  it("parses a deck's own figures exactly, without floats", () => {
    expect(parseDeckNumber("$14k")).toEqual({
      amount: "14000",
      currency: "USD",
      percent: false,
    });
    expect(parseDeckNumber("₦1.25m")?.amount).toBe("1250000");
    expect(parseDeckNumber("USD 18,000")?.amount).toBe("18000");
    expect(parseDeckNumber("68%")).toMatchObject({
      amount: "68",
      percent: true,
    });
    expect(parseDeckNumber("$14k to $18k")).toBeNull();
    expect(parseDeckNumber("growing fast")).toBeNull();
  });

  it("only counts sections the founder confirmed", () => {
    expect(deckFinancialFigures(deck()).map((f) => f.stepKey)).toEqual([
      "F5.monthly_revenue",
    ]);
    expect(
      deckFinancialFigures(deck({ confirmed: true })).map((f) => f.stepKey),
    ).toEqual(["F5.monthly_revenue", "F5.gross_margin"]);
    expect(
      deckFinancialFigures(
        deck({ reviews: [{ section: "TRACTION", action: "DISMISS" }] }),
      ),
    ).toEqual([]);
  });

  it("asks which is current when the stated figure differs, keeping both readings", () => {
    const questions = financialContradictions(
      values({
        "F5.fin_currency": select("usd"),
        "F5.monthly_revenue": range("18000"),
      }),
      deckFinancialFigures(deck()),
    );
    expect(questions).toHaveLength(1);
    const [question] = questions;
    expect(question).toMatchObject({
      stepKey: "F5.monthly_revenue",
      factKey: "financial.monthly_revenue",
      reason: "CONTRADICTION",
      question:
        "Your deck says monthly revenue is USD 14,000; you told me USD 18,000. Which is current?",
      readings: [
        "Pitch deck, page 7 (as of May 2026): USD 14,000",
        "What you told Q: USD 18,000",
      ],
      sourceRefs: [{ sourceType: "EVIDENCE_DOCUMENT", sourceId: DOC }],
    });
    expect(question?.options.map((o) => o.value)).toEqual([
      { type: "RANGE", value: "14000" },
      { type: "RANGE", value: "18000" },
    ]);
  });

  it("asks nothing when the figures agree, or when the currencies differ", () => {
    expect(
      financialContradictions(
        values({
          "F5.fin_currency": select("usd"),
          "F5.monthly_revenue": range("14000.00"),
        }),
        deckFinancialFigures(deck()),
      ),
    ).toEqual([]);
    expect(
      financialContradictions(
        values({
          "F5.fin_currency": select("ngn"),
          "F5.monthly_revenue": range("18000"),
        }),
        deckFinancialFigures(deck()),
      ),
    ).toEqual([]);
  });
});

describe("the worker's financial check", () => {
  const session = {
    id: SESSION,
    journeyType: "founder",
    status: "ACTIVE",
    subject: { subjectType: "COMPANY", subjectId: COMPANY },
  };
  const answers = [
    { stepKey: "F5.fin_currency", value: select("usd") },
    { stepKey: "F5.monthly_revenue", value: range("18000") },
  ];

  function check(
    earlier: readonly { reason: string; readings: string[]; status: string }[],
  ) {
    const recordQuestions = vi.fn(() => Promise.resolve([]));
    const deckReading = vi.fn(() => Promise.resolve(deck()));
    return {
      recordQuestions,
      deckReading,
      service: createFounderFinancialCheck({
        sql: {} as never,
        sessions: { findById: () => Promise.resolve(session) },
        responses: { listCurrent: () => Promise.resolve(answers) },
        questions: { listForFact: () => Promise.resolve(earlier) },
        deckReading,
        recordQuestions,
      }),
    };
  }

  it("records the contradiction as an interview question", async () => {
    const { service, recordQuestions } = check([]);
    const outcome = await service.onResponseCommitted({
      sessionId: SESSION,
      stepKey: "F5.monthly_revenue",
      responseId: "r",
    });
    expect(outcome).toEqual({ kind: "CHECKED", asked: 1 });
    expect(recordQuestions).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: SESSION }),
    );
  });

  it("never re-asks a disagreement the founder already settled", async () => {
    const { service, recordQuestions } = check([
      {
        reason: "CONTRADICTION",
        status: "ANSWERED",
        readings: ["Pitch deck, page 7 (as of May 2026): USD 14,000", "x"],
      },
    ]);
    const outcome = await service.onResponseCommitted({
      sessionId: SESSION,
      stepKey: "F5.monthly_revenue",
      responseId: "r",
    });
    expect(outcome.asked).toBe(0);
    expect(recordQuestions).not.toHaveBeenCalled();
  });

  it("ignores every other step without reading anything", async () => {
    const { service, deckReading } = check([]);
    const outcome = await service.onResponseCommitted({
      sessionId: SESSION,
      stepKey: "F1.description",
      responseId: "r",
    });
    expect(outcome.kind).toBe("SKIPPED");
    expect(deckReading).not.toHaveBeenCalled();
  });
});
