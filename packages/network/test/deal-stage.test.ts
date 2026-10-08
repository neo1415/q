import { describe, expect, it } from "vitest";

import {
  compileReport,
  dealNextSteps,
  draftPassNote,
  moneyText,
  projectDealStage,
  projectRelationshipState,
  reportDigest,
  type ReportFacts,
} from "../src/index.js";

/**
 * deal-stage.v1 (2026-10-08): the stage strip is a pure fold of the ONE
 * relationship's history. Legal moves, refused moves kept as anomalies,
 * the two clean ends, and the reports compiled from the record.
 */

type Event = Parameters<typeof projectDealStage>[0][number];
let sequence = 0;
const at = (day: number) =>
  `2026-10-${String(day).padStart(2, "0")}T10:00:00.000Z`;
const e = (
  eventType: string,
  day: number,
  payload: Record<string, unknown> = {},
  visibilityScope: Event["visibilityScope"] = "relationship_shared",
): Event => {
  sequence += 1;
  return { sequence, eventType, occurredAt: at(day), visibilityScope, payload };
};
const C1 = "00000000-0000-4000-8000-00000000c001";
const T1 = "00000000-0000-4000-8000-00000000d001";
const T2 = "00000000-0000-4000-8000-00000000d002";
const DOC = "00000000-0000-4000-8000-00000000e001";

function journey(): Event[] {
  sequence = 0;
  return [
    e("interest_expressed", 1),
    e("connection_accepted", 2),
    e("meeting_held", 3, { meetingId: C1 }),
    e("diligence_started", 4, { side: "INVESTOR" }),
    e("commitment_confirmed", 5, { commitmentId: C1, level: "SOFT" }),
    e("deal_terms_recorded", 6, { termsId: T1, version: 1, side: "INVESTOR" }),
    e("deal_terms_signed", 7, {
      termsId: T1,
      signedDocumentId: DOC,
      side: "COMPANY",
    }),
    e("commitment_received", 8, { commitmentId: C1 }),
    e("deal_closed", 9, {
      closeId: C1,
      termsId: T1,
      commitmentId: C1,
      side: "COMPANY",
    }),
  ];
}

describe("deal-stage.v1", () => {
  it("reads the whole journey to a clean close, with a date for each stage", () => {
    const projection = projectDealStage(journey());
    expect(projection.current).toBe("CLOSED");
    expect(projection.end).toEqual({ kind: "CLOSED", at: at(9) });
    expect(projection.reached).toEqual({
      MET: at(3),
      DILIGENCE: at(4),
      SOFT_COMMIT: at(5),
      TERMS: at(6),
      SIGNED: at(7),
      FUNDS_RECEIVED: at(8),
      CLOSED: at(9),
    });
    expect(projection.anomalies).toEqual([]);
    expect(projection.termsId).toBe(T1);
  });

  it("is deterministic: order delivered and duplicates do not matter", () => {
    const events = journey();
    const shuffled = [...events].reverse().concat(events.slice(0, 3));
    expect(projectDealStage(shuffled)).toEqual(projectDealStage(events));
  });

  it("keeps the relationship state in its own vocabulary: closed reads INVESTED, never a new state", () => {
    const projection = projectRelationshipState(journey());
    expect(projection?.state).toBe("INVESTED");
    expect(projection?.anomalies).toEqual([]);
    expect(projection?.unrecognised).toBe(0);
  });

  it("refuses terms before a soft commit, and a close before money arrived (anomalies, nothing moves)", () => {
    sequence = 0;
    const events = [
      e("meeting_held", 1),
      e("deal_terms_recorded", 2, {
        termsId: T1,
        version: 1,
        side: "INVESTOR",
      }),
      e("deal_terms_signed", 3, {
        termsId: T1,
        signedDocumentId: DOC,
        side: "INVESTOR",
      }),
      e("deal_closed", 4, {
        closeId: C1,
        termsId: T1,
        commitmentId: C1,
        side: "INVESTOR",
      }),
    ];
    const projection = projectDealStage(events);
    expect(projection.current).toBe("MET");
    expect(projection.end).toBeNull();
    expect(projection.anomalies.map((a) => a.eventType)).toEqual([
      "deal_terms_recorded",
      "deal_terms_signed",
      "deal_closed",
    ]);
  });

  it("a signature for a superseded version is an anomaly; a revision unsigns", () => {
    sequence = 0;
    const events = [
      e("commitment_confirmed", 1, { commitmentId: C1, level: "SOFT" }),
      e("deal_terms_recorded", 2, {
        termsId: T1,
        version: 1,
        side: "INVESTOR",
      }),
      e("deal_terms_signed", 3, {
        termsId: T1,
        signedDocumentId: DOC,
        side: "COMPANY",
      }),
      e("deal_terms_recorded", 4, { termsId: T2, version: 2, side: "COMPANY" }),
      e("deal_terms_signed", 5, {
        termsId: T1,
        signedDocumentId: DOC,
        side: "COMPANY",
      }),
    ];
    const projection = projectDealStage(events);
    expect(projection.termsId).toBe(T2);
    expect(projection.reached.SIGNED).toBeNull();
    expect(projection.anomalies).toEqual([
      { sequence: 5, eventType: "deal_terms_signed" },
    ]);
  });

  it("a withdrawn commitment un-reaches the soft commit; a receipt never does", () => {
    sequence = 0;
    const withdrawn = projectDealStage([
      e("commitment_confirmed", 1, { commitmentId: C1, level: "SOFT" }),
      e("commitment_withdrawn", 2, { commitmentId: C1 }),
    ]);
    expect(withdrawn.reached.SOFT_COMMIT).toBeNull();
    expect(withdrawn.current).toBeNull();
    sequence = 0;
    const received = projectDealStage([
      e("commitment_confirmed", 1, { commitmentId: C1, level: "SOFT" }),
      e("commitment_received", 2, { commitmentId: C1 }),
      e("commitment_withdrawn", 3, { commitmentId: C1 }),
    ]);
    expect(received.reached.FUNDS_RECEIVED).toBe(at(2));
    expect(received.reached.SOFT_COMMIT).toBe(at(1));
  });

  it("a pass ends the strip; nothing moves after it; resuming reopens it", () => {
    sequence = 0;
    const passed = [
      e("meeting_held", 1),
      e("relationship_passed", 2, {
        passId: C1,
        side: "INVESTOR",
        reasonShared: false,
      }),
      e("deal_terms_recorded", 3, { termsId: T1, version: 1, side: "COMPANY" }),
    ];
    const projection = projectDealStage(passed);
    expect(projection.end).toEqual({ kind: "PASSED", at: at(2) });
    expect(projection.anomalies.map((a) => a.eventType)).toEqual([
      "deal_terms_recorded",
    ]);
    expect(
      dealNextSteps({
        projection,
        relationshipState: "PASSED",
        side: "INVESTOR",
      }),
    ).toEqual([]);
    const resumed = projectDealStage([
      ...passed,
      e("relationship_resumed", 4, { side: "INVESTOR" }),
    ]);
    expect(resumed.end).toBeNull();
  });

  it("offers each side only its legal next steps", () => {
    sequence = 0;
    const soft = projectDealStage([
      e("meeting_held", 1),
      e("commitment_confirmed", 2, { commitmentId: C1, level: "SOFT" }),
    ]);
    expect(
      dealNextSteps({
        projection: soft,
        relationshipState: "MEETING_HELD",
        side: "INVESTOR",
      }),
    ).toEqual(["RECORD_TERMS", "SEND_FUNDS", "PASS"]);
    expect(
      dealNextSteps({
        projection: soft,
        relationshipState: "MEETING_HELD",
        side: "COMPANY",
      }),
    ).toEqual(["RECORD_TERMS", "CONFIRM_FUNDS"]);
    const ready = projectDealStage(journey().slice(0, 8));
    expect(
      dealNextSteps({
        projection: ready,
        relationshipState: "INVESTED",
        side: "COMPANY",
      }),
    ).toEqual(["CLOSE"]);
    expect(
      dealNextSteps({
        projection: projectDealStage(journey()),
        relationshipState: "INVESTED",
        side: "COMPANY",
      }),
    ).toEqual([]);
  });
});

describe("pass note", () => {
  it("is respectful, names the company, and carries the reason only as one honest line", () => {
    const note = draftPassNote({
      companyName: "Tensorgate",
      reasonCode: "STAGE",
    });
    expect(note).toContain("Tensorgate");
    expect(note).toContain("earlier than our fund invests");
    expect(note).toMatch(/every success/);
    expect(
      draftPassNote({ companyName: "Tensorgate", reasonCode: null }),
    ).not.toContain(":");
  });
});

describe("reports (deal-report.v1)", () => {
  const facts = (overrides: Partial<ReportFacts> = {}): ReportFacts => ({
    companyName: "Tensorgate",
    investorName: "Northwind Ventures",
    relationshipState: "INVESTED",
    generatedAt: at(10),
    projection: projectDealStage(journey()),
    history: journey().map((event) => ({
      sequence: event.sequence,
      eventType: event.eventType,
      occurredAt: event.occurredAt,
      actor: "Ada Obi",
    })),
    meetings: [],
    diligence: {
      requests: [
        {
          title: "Cap table",
          askedAt: at(4),
          askedBy: "Ada Obi",
          fulfilledAt: null,
          declinedAt: null,
        },
      ],
      questions: [
        {
          question: "What is monthly burn?",
          askedAt: at(4),
          askedBy: "Ada Obi",
          answer: "USD 40k",
          answeredAt: at(5),
          evidenceStatus: "SELF_REPORTED",
        },
      ],
    },
    commitment: {
      amount: "250000",
      currencyCode: "USD",
      level: "SOFT",
      status: "RECEIVED",
      statedBy: "Ada Obi",
      statedAt: at(5),
      confirmedBy: "Femi Ade",
      confirmedAt: at(5),
      receivedBy: "Femi Ade",
      receivedAt: at(8),
      roundName: null,
    },
    terms: [
      {
        version: 1,
        status: "SIGNED",
        instrument: "SAFE",
        amount: "250000",
        currencyCode: "USD",
        valuationCap: "8000000.5",
        valuationBasis: "POST_MONEY",
        preMoneyValuation: null,
        discountPercent: null,
        proRata: null,
        otherTerms: null,
        recordedBy: "Ada Obi",
        recordedAt: at(6),
        signedBy: "Femi Ade",
        signedAt: at(7),
        signedDocumentId: DOC,
        termsDocumentId: null,
      },
    ],
    close: { closedOn: "2026-10-09", closedBy: "Femi Ade", note: null },
    pass: null,
    ...overrides,
  });

  it("prints exact money without a float", () => {
    expect(moneyText("8000000.5", "USD")).toBe("USD 8,000,000.50");
    expect(moneyText("250000", "NGN")).toBe("NGN 250,000.00");
  });

  it("the closing report states terms, money, the close and the approvals chain with who and when", () => {
    const content = compileReport("CLOSING", facts());
    const text = JSON.stringify(content);
    expect(content.title).toBe("Closing report: Tensorgate");
    expect(text).toContain("USD 8,000,000.50 post-money");
    expect(text).toContain("Funds received");
    expect(text).toContain("Investment closed");
    expect(text).toContain("Femi Ade");
    expect(content.gaps).toEqual([]);
    expect(content.notice).toMatch(/both sides can read/);
  });

  it("the diligence report lists what was asked, answered and still open; unknown stays a gap", () => {
    const content = compileReport("DILIGENCE", facts());
    expect(content.gaps).toEqual(["Open request: Cap table"]);
    expect(JSON.stringify(content)).toContain("USD 40k (self reported)");
  });

  it("the memo names its gaps instead of guessing and is private to the investor", () => {
    const content = compileReport("INVESTMENT_MEMO", facts());
    expect(content.gaps).toContain("Pro-rata rights are not stated.");
    expect(content.gaps).toContain("No terms document is attached.");
    expect(content.notice).toMatch(/never shared with the company/);
  });

  it("compiles the same record to the same content and digest", () => {
    const a = compileReport("CLOSING", facts());
    const b = compileReport("CLOSING", facts());
    expect(reportDigest(a)).toBe(reportDigest(b));
    expect(reportDigest(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(
      reportDigest(compileReport("CLOSING", facts({ companyName: "Other" }))),
    ).not.toBe(reportDigest(a));
  });
});
