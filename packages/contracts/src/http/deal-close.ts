import { z } from "zod";

import { UtcTimestampSchema, UuidSchema } from "../common/index.js";
import { CurrencyCodeSchema } from "../common/money.js";
import { CommitmentAmountSchema } from "./commitments.js";

/**
 * Deal close (founder, 2026-10-08): the post-meeting journey on the ONE
 * canonical relationship -- terms, signature, close -- and the reports at
 * every stage. Never a deal record: the stage strip is the deterministic
 * deal-stage.v1 reading of the relationship's history. Money stays on the
 * existing commitment contract (commitments.ts).
 */

export const NETWORK_RELATIONSHIP_DEAL_PATH =
  "/v1/network/relationships/:relationshipId/deal" as const;
export const NETWORK_RELATIONSHIP_DEAL_TERMS_PATH =
  "/v1/network/relationships/:relationshipId/deal/terms" as const;
export const NETWORK_RELATIONSHIP_DEAL_SIGNED_PATH =
  "/v1/network/relationships/:relationshipId/deal/signed" as const;
export const NETWORK_RELATIONSHIP_DEAL_CLOSE_PATH =
  "/v1/network/relationships/:relationshipId/deal/close" as const;
export const NETWORK_RELATIONSHIP_DEAL_CHECKLIST_PATH =
  "/v1/network/relationships/:relationshipId/deal/checklist" as const;
export const NETWORK_RELATIONSHIP_REPORTS_PATH =
  "/v1/network/relationships/:relationshipId/reports" as const;
export const NETWORK_RELATIONSHIP_REPORT_PDF_PATH =
  "/v1/network/relationships/:relationshipId/reports/:reportId/pdf" as const;
export const NETWORK_RELATIONSHIP_AUDIT_EXPORT_PATH =
  "/v1/network/relationships/:relationshipId/audit-export" as const;

const withRelationship = (path: string, relationshipId: string) =>
  path.replace(":relationshipId", encodeURIComponent(relationshipId));
export const networkRelationshipDealPath = (relationshipId: string) =>
  withRelationship(NETWORK_RELATIONSHIP_DEAL_PATH, relationshipId);
export const networkRelationshipDealTermsPath = (relationshipId: string) =>
  withRelationship(NETWORK_RELATIONSHIP_DEAL_TERMS_PATH, relationshipId);
export const networkRelationshipDealSignedPath = (relationshipId: string) =>
  withRelationship(NETWORK_RELATIONSHIP_DEAL_SIGNED_PATH, relationshipId);
export const networkRelationshipDealClosePath = (relationshipId: string) =>
  withRelationship(NETWORK_RELATIONSHIP_DEAL_CLOSE_PATH, relationshipId);
export const networkRelationshipDealChecklistPath = (relationshipId: string) =>
  withRelationship(NETWORK_RELATIONSHIP_DEAL_CHECKLIST_PATH, relationshipId);
export const networkRelationshipReportsPath = (relationshipId: string) =>
  withRelationship(NETWORK_RELATIONSHIP_REPORTS_PATH, relationshipId);
export const networkRelationshipReportPdfPath = (
  relationshipId: string,
  reportId: string,
) =>
  withRelationship(
    NETWORK_RELATIONSHIP_REPORT_PDF_PATH,
    relationshipId,
  ).replace(":reportId", encodeURIComponent(reportId));
export const networkRelationshipAuditExportPath = (relationshipId: string) =>
  withRelationship(NETWORK_RELATIONSHIP_AUDIT_EXPORT_PATH, relationshipId);

export const DEAL_STAGE_CODES = [
  "MET",
  "DILIGENCE",
  "SOFT_COMMIT",
  "TERMS",
  "SIGNED",
  "FUNDS_RECEIVED",
  "CLOSED",
] as const;
export const DealStageCodeSchema = z.enum(DEAL_STAGE_CODES);
export type DealStageCode = z.infer<typeof DealStageCodeSchema>;

export const DEAL_STEP_CODES = [
  "START_DILIGENCE",
  "SOFT_COMMIT",
  "RECORD_TERMS",
  "MARK_SIGNED",
  "SEND_FUNDS",
  "CONFIRM_FUNDS",
  "CLOSE",
  "PASS",
] as const;
export const DealStepCodeSchema = z.enum(DEAL_STEP_CODES);
export type DealStepCode = z.infer<typeof DealStepCodeSchema>;

export const DEAL_INSTRUMENTS = [
  "SAFE",
  "CONVERTIBLE_NOTE",
  "PRICED_EQUITY",
  "OTHER",
] as const;
export const DealInstrumentSchema = z.enum(DEAL_INSTRUMENTS);
export type DealInstrument = z.infer<typeof DealInstrumentSchema>;

export const RELATIONSHIP_REPORT_KINDS = [
  "MEETING_SUMMARY",
  "DILIGENCE",
  "INVESTMENT_MEMO",
  "CLOSING",
  "PASS",
] as const;
export const RelationshipReportKindSchema = z.enum(RELATIONSHIP_REPORT_KINDS);
export type RelationshipReportKind = z.infer<
  typeof RelationshipReportKindSchema
>;

export const RelationshipReportVisibilitySchema = z.enum([
  "investor_private",
  "founder_private",
  "relationship_shared",
]);

/** Exact percent, 0 to under 100, at most two decimals. */
const PercentSchema = z
  .string()
  .trim()
  .regex(/^(?:0|[1-9]\d?)(?:\.\d{1,2})?$/);

/** The terms as one side records them. Unknown stays unknown (absent). */
export const RecordDealTermsRequestSchema = z
  .object({
    instrument: DealInstrumentSchema,
    amount: CommitmentAmountSchema,
    currencyCode: CurrencyCodeSchema,
    valuationCap: CommitmentAmountSchema.optional(),
    valuationBasis: z.enum(["PRE_MONEY", "POST_MONEY"]).optional(),
    preMoneyValuation: CommitmentAmountSchema.optional(),
    discountPercent: PercentSchema.optional(),
    proRata: z.boolean().optional(),
    otherTerms: z.string().trim().min(1).max(2000).optional(),
    /** A document shared with this relationship (data room). */
    termsDocumentId: UuidSchema.optional(),
  })
  .strict()
  .refine(
    (terms) =>
      terms.valuationCap === undefined || terms.preMoneyValuation === undefined,
    { message: "a cap or a pre-money valuation, not both" },
  )
  .refine(
    (terms) =>
      terms.valuationCap === undefined || terms.valuationBasis !== undefined,
    { message: "say whether the cap is pre- or post-money" },
  );
export type RecordDealTermsRequest = z.infer<
  typeof RecordDealTermsRequestSchema
>;

export const MarkDealSignedRequestSchema = z
  .object({
    termsId: UuidSchema,
    /** The signed copy, shared with this relationship. */
    signedDocumentId: UuidSchema,
  })
  .strict();
export type MarkDealSignedRequest = z.infer<typeof MarkDealSignedRequestSchema>;

export const CloseDealRequestSchema = z
  .object({ note: z.string().trim().min(1).max(1000).optional() })
  .strict();
export type CloseDealRequest = z.infer<typeof CloseDealRequestSchema>;

export const TickDealChecklistRequestSchema = z
  .object({ item: z.string().regex(/^[A-Z][A-Z_]{2,47}$/) })
  .strict();

export const GenerateRelationshipReportRequestSchema = z
  .object({ kind: RelationshipReportKindSchema })
  .strict();
export type GenerateRelationshipReportRequest = z.infer<
  typeof GenerateRelationshipReportRequestSchema
>;

export const DealTermsDtoSchema = z
  .object({
    termsId: UuidSchema,
    version: z.number().int().min(1),
    status: z.enum(["RECORDED", "SIGNED", "SUPERSEDED"]),
    instrument: DealInstrumentSchema,
    amount: z.string(),
    currencyCode: CurrencyCodeSchema,
    valuationCap: z.string().nullable(),
    valuationBasis: z.enum(["PRE_MONEY", "POST_MONEY"]).nullable(),
    preMoneyValuation: z.string().nullable(),
    discountPercent: z.string().nullable(),
    proRata: z.boolean().nullable(),
    otherTerms: z.string().nullable(),
    termsDocumentId: UuidSchema.nullable(),
    recordedBySide: z.enum(["INVESTOR", "COMPANY"]),
    recordedBy: z.string().nullable(),
    recordedAt: UtcTimestampSchema,
    signedDocumentId: UuidSchema.nullable(),
    signedBy: z.string().nullable(),
    signedAt: UtcTimestampSchema.nullable(),
  })
  .strict();
export type DealTermsDto = z.infer<typeof DealTermsDtoSchema>;

export const RelationshipReportSummaryDtoSchema = z
  .object({
    reportId: UuidSchema,
    kind: RelationshipReportKindSchema,
    version: z.number().int().min(1),
    title: z.string(),
    visibility: RelationshipReportVisibilitySchema,
    ownerSide: z.enum(["INVESTOR", "COMPANY"]),
    generatedBy: z.string().nullable(),
    createdAt: UtcTimestampSchema,
    contentSha256: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();
export type RelationshipReportSummaryDto = z.infer<
  typeof RelationshipReportSummaryDtoSchema
>;

export const DealViewDtoSchema = z
  .object({
    relationshipId: UuidSchema,
    side: z.enum(["INVESTOR", "COMPANY"]),
    stageVersion: z.literal("deal-stage.v1"),
    stages: z.array(
      z
        .object({
          stage: DealStageCodeSchema,
          reachedAt: UtcTimestampSchema.nullable(),
        })
        .strict(),
    ),
    current: DealStageCodeSchema.nullable(),
    end: z
      .object({
        kind: z.enum(["CLOSED", "PASSED"]),
        at: UtcTimestampSchema,
      })
      .strict()
      .nullable(),
    nextSteps: z.array(DealStepCodeSchema),
    terms: DealTermsDtoSchema.nullable(),
    termsHistory: z.array(DealTermsDtoSchema),
    close: z
      .object({
        closedOn: z.string(),
        closedBySide: z.enum(["INVESTOR", "COMPANY"]),
        closedBy: z.string().nullable(),
        note: z.string().nullable(),
      })
      .strict()
      .nullable(),
    checklist: z.array(
      z
        .object({
          code: z.string(),
          label: z.string(),
          done: z.boolean(),
          doneAt: UtcTimestampSchema.nullable(),
          fromRecord: z.boolean(),
        })
        .strict(),
    ),
    updateCadence: z.string().nullable(),
    /** A drafted pass note (investor side, while a pass is possible). */
    passNoteDraft: z.string().nullable(),
    /** Documents shared with this relationship, to attach to terms. */
    sharedDocumentIds: z.array(UuidSchema),
    reports: z.array(RelationshipReportSummaryDtoSchema),
  })
  .strict();
export type DealViewDto = z.infer<typeof DealViewDtoSchema>;

export const DealActionResultDtoSchema = z
  .object({
    relationshipId: UuidSchema,
    deduplicated: z.boolean(),
  })
  .strict();
export type DealActionResultDto = z.infer<typeof DealActionResultDtoSchema>;

/** A compiled report's content (deal-report.v1). */
export const RelationshipReportContentSchema = z
  .object({
    compiler: z.string(),
    kind: RelationshipReportKindSchema,
    title: z.string(),
    subtitle: z.string(),
    sections: z.array(
      z
        .object({
          heading: z.string(),
          body: z.string(),
          rows: z.array(
            z
              .object({
                label: z.string(),
                value: z.string(),
                /** Who recorded it and when: the provenance line. */
                source: z.string(),
              })
              .strict(),
          ),
        })
        .strict(),
    ),
    gaps: z.array(z.string()),
    notice: z.string(),
  })
  .strict();
export type RelationshipReportContent = z.infer<
  typeof RelationshipReportContentSchema
>;

export const RelationshipReportDtoSchema =
  RelationshipReportSummaryDtoSchema.extend({
    content: RelationshipReportContentSchema,
  }).strict();
export type RelationshipReportDto = z.infer<typeof RelationshipReportDtoSchema>;

/**
 * A respectful note for a pass (research 2026-10-08: pass fast, clearly,
 * with one honest line). Deterministic from the reason code; the investor
 * approves or edits it, and it reaches the founder only if they share it.
 */
const PASS_REASON_LINES: Readonly<Record<string, string>> = {
  STAGE: "it's earlier than our fund invests",
  SECTOR: "it sits outside the sectors our fund covers",
  GEOGRAPHY: "it's outside the markets our fund invests in",
  TRACTION: "we'd want to see more traction before we invest",
  TEAM: "we don't think we're the right partner for the team at this point",
  VALUATION: "we couldn't get comfortable with the valuation",
  BUSINESS_MODEL: "we couldn't get comfortable with the business model yet",
  MARKET: "we weren't able to get conviction on the market",
  TIMING: "the timing isn't right for our fund",
  ROUND: "the round's structure doesn't fit our fund",
};

export function draftPassNote(input: {
  readonly companyName: string;
  readonly reasonCode: string | null;
}): string {
  const reason =
    input.reasonCode === null ? undefined : PASS_REASON_LINES[input.reasonCode];
  const why = reason === undefined ? "" : `: ${reason}`;
  return `Thank you for the time and openness through our conversations about ${input.companyName}. We've decided not to proceed at this stage${why}. We'd be glad to hear how things develop, and we wish you and the team every success.`;
}
