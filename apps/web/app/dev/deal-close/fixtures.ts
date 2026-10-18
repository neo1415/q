import type { DealViewDto } from "@capital-q/contracts";

/**
 * Fictional deal views for the deal-close harness (2026-10-08): the same
 * DealViewDto the API answers, at each stage. Every name is fictional.
 */

const REL = "a0000000-0000-4000-8000-000000000001";
const DOC = "d0000000-0000-4000-8000-000000000001";
const SIGNED_DOC = "d0000000-0000-4000-8000-000000000002";
// Days below 10 are in October, the rest in September (fictional).
const day = (n: number) =>
  n < 10
    ? `2026-10-0${String(n)}T10:00:00.000Z`
    : `2026-09-${String(n)}T10:00:00.000Z`;

export type DealStageFixture = "soft" | "terms" | "ready" | "closed" | "passed";

const terms = (signed: boolean): NonNullable<DealViewDto["terms"]> => ({
  termsId: "c0000000-0000-4000-8000-000000000001",
  version: 1,
  status: signed ? "SIGNED" : "RECORDED",
  instrument: "SAFE",
  amount: "250000",
  currencyCode: "USD",
  valuationCap: "8000000",
  valuationBasis: "POST_MONEY",
  preMoneyValuation: null,
  discountPercent: null,
  proRata: true,
  otherTerms: null,
  termsDocumentId: DOC,
  recordedBySide: "INVESTOR",
  recordedBy: "Ada Obi",
  recordedAt: day(1),
  signedDocumentId: signed ? SIGNED_DOC : null,
  signedBy: signed ? "Femi Ade" : null,
  signedAt: signed ? day(2) : null,
});

export function dealFixture(
  stage: DealStageFixture,
  side: "INVESTOR" | "COMPANY",
): DealViewDto {
  const reached: Record<string, string | null> = {
    MET: day(18),
    DILIGENCE: day(22),
    SOFT_COMMIT: day(29),
    TERMS:
      stage === "terms" || stage === "ready" || stage === "closed"
        ? day(1)
        : null,
    SIGNED: stage === "ready" || stage === "closed" ? day(2) : null,
    FUNDS_RECEIVED: stage === "ready" || stage === "closed" ? day(6) : null,
    CLOSED: stage === "closed" ? day(7) : null,
  };
  if (stage === "passed") {
    reached["SOFT_COMMIT"] = null;
  }
  const order = [
    "MET",
    "DILIGENCE",
    "SOFT_COMMIT",
    "TERMS",
    "SIGNED",
    "FUNDS_RECEIVED",
    "CLOSED",
  ] as const;
  const current =
    [...order].reverse().find((stage) => reached[stage] !== null) ?? null;
  const nextSteps: DealViewDto["nextSteps"] =
    stage === "soft"
      ? side === "INVESTOR"
        ? ["RECORD_TERMS", "SEND_FUNDS", "PASS"]
        : ["RECORD_TERMS", "CONFIRM_FUNDS"]
      : stage === "terms"
        ? side === "INVESTOR"
          ? ["RECORD_TERMS", "MARK_SIGNED", "SEND_FUNDS", "PASS"]
          : ["RECORD_TERMS", "MARK_SIGNED", "CONFIRM_FUNDS"]
        : stage === "ready"
          ? ["CLOSE"]
          : [];
  const closed = stage === "closed";
  return {
    relationshipId: REL,
    side,
    stageVersion: "deal-stage.v1",
    stages: order.map((stage) => ({
      stage,
      reachedAt: reached[stage] ?? null,
    })),
    current,
    end: closed
      ? { kind: "CLOSED", at: day(7) }
      : stage === "passed"
        ? { kind: "PASSED", at: day(5) }
        : null,
    nextSteps,
    terms:
      stage === "soft" || stage === "passed" ? null : terms(stage !== "terms"),
    termsHistory: [],
    close: closed
      ? {
          closedOn: "2026-10-07",
          closedBySide: "COMPANY",
          closedBy: "Femi Ade",
          note: null,
        }
      : null,
    checklist: closed
      ? side === "COMPANY"
        ? [
            {
              code: "SIGNED_DOCS_FILED",
              label: "Signed documents filed",
              done: true,
              doneAt: day(2),
              fromRecord: true,
            },
            {
              code: "FUNDS_COUNTED",
              label: "Funds received and counted in the round",
              done: true,
              doneAt: day(6),
              fromRecord: true,
            },
            {
              code: "CAP_TABLE_UPDATED",
              label: "Cap table updated",
              done: false,
              doneAt: null,
              fromRecord: false,
            },
            {
              code: "UPDATE_LIST_ADDED",
              label: "Investor added to your update list",
              done: false,
              doneAt: null,
              fromRecord: false,
            },
            {
              code: "UPDATE_CADENCE_AGREED",
              label: "Update cadence agreed",
              done: false,
              doneAt: null,
              fromRecord: false,
            },
          ]
        : [
            {
              code: "SIGNED_DOCS_FILED",
              label: "Signed documents filed",
              done: true,
              doneAt: day(2),
              fromRecord: true,
            },
            {
              code: "PORTFOLIO_ENTRY_CONFIRMED",
              label: "Portfolio entry confirmed",
              done: false,
              doneAt: null,
              fromRecord: false,
            },
            {
              code: "REPORTING_CADENCE_SET",
              label: "Reporting cadence set",
              done: false,
              doneAt: null,
              fromRecord: false,
            },
          ]
      : [],
    updateCadence: closed
      ? "Monthly updates for the first six months, then quarterly: short, with the numbers, the asks and what changed."
      : null,
    passNoteDraft: null,
    sharedDocumentIds: [DOC, SIGNED_DOC],
    reports: [
      ...(closed
        ? [
            {
              reportId: "e0000000-0000-4000-8000-000000000003",
              kind: "CLOSING" as const,
              version: 1,
              title: "Closing report: Tensorgate",
              visibility: "relationship_shared" as const,
              ownerSide: "COMPANY" as const,
              generatedBy: "Femi Ade",
              createdAt: day(7),
              contentSha256: "c".repeat(64),
            },
          ]
        : []),
      ...(stage === "passed" && side === "INVESTOR"
        ? [
            {
              reportId: "e0000000-0000-4000-8000-000000000004",
              kind: "PASS" as const,
              version: 1,
              title: "Pass report: Tensorgate",
              visibility: "investor_private" as const,
              ownerSide: "INVESTOR" as const,
              generatedBy: "Ada Obi",
              createdAt: day(5),
              contentSha256: "d".repeat(64),
            },
          ]
        : []),
      ...(side === "INVESTOR" && stage !== "passed"
        ? [
            {
              reportId: "e0000000-0000-4000-8000-000000000002",
              kind: "INVESTMENT_MEMO" as const,
              version: 1,
              title: "Investment memo: Tensorgate",
              visibility: "investor_private" as const,
              ownerSide: "INVESTOR" as const,
              generatedBy: "Ada Obi",
              createdAt: day(29),
              contentSha256: "b".repeat(64),
            },
          ]
        : []),
      {
        reportId: "e0000000-0000-4000-8000-000000000001",
        kind: "DILIGENCE",
        version: 2,
        title: "Diligence report: Tensorgate",
        visibility: "relationship_shared",
        ownerSide: "INVESTOR",
        generatedBy: "Ada Obi",
        createdAt: day(28),
        contentSha256: "a".repeat(64),
      },
    ],
  };
}
