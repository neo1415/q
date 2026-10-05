import { z } from "zod";

import { UuidSchema } from "../common/ids.js";

/**
 * `/v1/gateq` — an investor organisation's inbound gateway (CQ-GATE-001).
 *
 *   gateway mode ≠ qualification outcome ≠ access decision
 *   GateQ published policy ≠ investor mandate
 *   qualified ≠ good company ≠ investment-ready ≠ recommended
 *
 * Two audiences on one prefix, and the split is deliberate. Everything
 * under `/v1/gateq/gateways` is the organisation's own configuration and
 * requires an authorised member of the organisation that owns it.
 * `/v1/gateq/public/{publicId}` is the only anonymous surface in the
 * product, and what it returns is a whitelist: a published gateway's own
 * public wording and the KINDS of thing it asks about, never the values it
 * was configured with.
 *
 * What is deliberately absent: anonymous application creation, document
 * upload and the applicant interview. Those are GATE-002.
 */

export const GATEQ_GATEWAYS_PATH = "/v1/gateq/gateways" as const;
export const GATEQ_GATEWAY_PATH = "/v1/gateq/gateways/:gatewayId" as const;
export const GATEQ_GATEWAY_VERSIONS_PATH =
  "/v1/gateq/gateways/:gatewayId/versions" as const;
export const GATEQ_GATEWAY_VERSION_PATH =
  "/v1/gateq/gateways/:gatewayId/versions/:versionId" as const;
export const GATEQ_GATEWAY_PUBLISH_PATH =
  "/v1/gateq/gateways/:gatewayId/versions/:versionId/publish" as const;
export const GATEQ_GATEWAY_QUALIFY_PATH =
  "/v1/gateq/gateways/:gatewayId/qualify" as const;
export const GATEQ_PUBLIC_GATEWAY_PATH = "/v1/gateq/public/:publicId" as const;

export const GatewayInboundModeDtoSchema = z.enum([
  "CLOSED",
  "QUALIFIED",
  "OPEN",
]);
export type GatewayInboundModeDto = z.infer<typeof GatewayInboundModeDtoSchema>;

export const CriterionRequirednessDtoSchema = z.enum(["REQUIRED", "PREFERRED"]);

export const CriterionTypeDtoSchema = z.enum([
  "TAXONOMY",
  "GEOGRAPHY",
  "STAGE",
  "RAISE_SIZE",
  "CHEQUE_COMPATIBILITY",
  "EXCLUDED_TAXONOMY",
]);

const DecimalAmountSchema = z
  .string()
  .regex(/^(0|[1-9][0-9]{0,15})(\.[0-9]{1,2})?$/);
const CurrencySchema = z.string().regex(/^[A-Z]{3}$/);

/**
 * One configured rule, as a client sends it.
 *
 * A closed discriminated union: there is no free-text sector here and no
 * escape hatch, because a gateway's stored authority is canonical taxonomy
 * node ids and a label a person typed is for display only.
 */
export const GatewayCriterionInputSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("TAXONOMY"),
      vocabularyCode: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
      allowedNodeIds: z.array(UuidSchema).min(1).max(64),
    })
    .strict(),
  z
    .object({
      type: z.literal("GEOGRAPHY"),
      allowedCountries: z
        .array(z.string().regex(/^[A-Z]{2}$/))
        .min(1)
        .max(64),
    })
    .strict(),
  z
    .object({
      type: z.literal("STAGE"),
      allowedStageCodes: z
        .array(z.string().regex(/^[a-z][a-z0-9_]{0,63}$/))
        .min(1)
        .max(16),
    })
    .strict(),
  z
    .object({
      type: z.literal("RAISE_SIZE"),
      currency: CurrencySchema,
      minAmount: DecimalAmountSchema.nullable(),
      maxAmount: DecimalAmountSchema.nullable(),
    })
    .strict(),
  z
    .object({
      type: z.literal("CHEQUE_COMPATIBILITY"),
      currency: CurrencySchema,
      minCheque: DecimalAmountSchema,
      maxCheque: DecimalAmountSchema.nullable(),
    })
    .strict(),
  z
    .object({
      type: z.literal("EXCLUDED_TAXONOMY"),
      vocabularyCode: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
      excludedNodeIds: z.array(UuidSchema).min(1).max(64),
    })
    .strict(),
]);

export const GatewayDraftCriterionSchema = z
  .object({
    position: z.number().int().min(1).max(64),
    requiredness: CriterionRequirednessDtoSchema,
    label: z.string().min(1).max(120),
    config: GatewayCriterionInputSchema,
  })
  .strict();

export const CreateGatewayRequestSchema = z
  .object({
    /** Resolved against the caller's own organisation; never trusted as authority. */
    investorOrganisationId: UuidSchema,
    name: z.string().min(1).max(160),
  })
  .strict();
export type CreateGatewayRequest = z.infer<typeof CreateGatewayRequestSchema>;

export const GatewayDraftRequestSchema = z
  .object({
    inboundMode: GatewayInboundModeDtoSchema,
    publicTitle: z.string().min(1).max(160),
    publicDescription: z.string().min(1).max(2000).nullable().optional(),
    criteria: z.array(GatewayDraftCriterionSchema).max(64),
  })
  .strict();
export type GatewayDraftRequest = z.infer<typeof GatewayDraftRequestSchema>;

export const QualifyCompanyRequestSchema = z
  .object({ companyId: UuidSchema })
  .strict();

export const GatewayDtoSchema = z
  .object({
    id: UuidSchema,
    publicId: z.string(),
    name: z.string(),
    status: z.enum(["ACTIVE", "DISABLED"]),
    createdAt: z.string(),
  })
  .strict();
export type GatewayDto = z.infer<typeof GatewayDtoSchema>;

export const GatewayVersionDtoSchema = z
  .object({
    id: UuidSchema,
    versionNumber: z.number().int().min(1),
    status: z.enum(["DRAFT", "PUBLISHED", "SUPERSEDED", "ARCHIVED"]),
    inboundMode: GatewayInboundModeDtoSchema,
    publicTitle: z.string(),
    publicDescription: z.string().nullable(),
    publishedAt: z.string().nullable(),
  })
  .strict();
export type GatewayVersionDto = z.infer<typeof GatewayVersionDtoSchema>;

export const GatewayPolicyDtoSchema = z
  .object({
    gateway: GatewayDtoSchema,
    version: GatewayVersionDtoSchema,
    criteria: z.array(GatewayDraftCriterionSchema.extend({ id: UuidSchema })),
  })
  .strict();
export type GatewayPolicyDto = z.infer<typeof GatewayPolicyDtoSchema>;

/**
 * What a qualification tells the organisation.
 *
 * Reason codes, never prose: REC-007's lesson is that a natural-language
 * layer belongs above a deterministic one, and Q may turn one of these
 * into a sentence without ever deciding which one it is. No number of any
 * kind appears here, because a number would be a score.
 */
export const QualificationCriterionDtoSchema = z
  .object({
    criterionId: UuidSchema,
    label: z.string(),
    requiredness: CriterionRequirednessDtoSchema,
    dimension: CriterionTypeDtoSchema,
    status: z.enum(["MATCH", "NO_MATCH", "UNKNOWN"]),
    reasonCode: z.string().max(64),
    observed: z.string().max(64).nullable(),
  })
  .strict();

export const QualificationResultDtoSchema = z
  .object({
    gatewayId: UuidSchema,
    gatewayVersionNumber: z.number().int().min(1),
    inboundMode: GatewayInboundModeDtoSchema,
    outcome: z.enum(["QUALIFIED", "NOT_QUALIFIED", "INSUFFICIENT_INFORMATION"]),
    access: z.enum(["MAY_APPLY", "MAY_NOT_APPLY", "NEEDS_INFORMATION"]),
    accessReasonCode: z.string().max(64),
    criteria: z.array(QualificationCriterionDtoSchema).max(64),
    evaluatedAt: z.string(),
  })
  .strict();
export type QualificationResultDto = z.infer<
  typeof QualificationResultDtoSchema
>;

/**
 * The anonymous projection of a published gateway (§19–§20).
 *
 * A whitelist, and the shape is the enforcement: there is no field here
 * for a mandate, a member, a draft, a node id, an internal identifier or a
 * rejection rule, so none of them can be returned by forgetting to remove
 * one. `criteria` carries the kind of thing asked about and the label the
 * organisation chose — enough for a founder to decide whether to apply,
 * and not the organisation's commercial position.
 */
export const PublicGatewayDtoSchema = z
  .object({
    publicId: z.string(),
    organisationDisplayName: z.string(),
    title: z.string(),
    description: z.string().nullable(),
    inboundMode: GatewayInboundModeDtoSchema,
    acceptingApplications: z.boolean(),
    criteria: z
      .array(
        z
          .object({
            label: z.string(),
            requiredness: CriterionRequirednessDtoSchema,
            dimension: CriterionTypeDtoSchema,
          })
          .strict(),
      )
      .max(64),
    publishedAt: z.string(),
    /**
     * The organisation's photo and cover, short-lived signed URLs, only
     * where its own Q Card shows them to the public (founder ask
     * 2026-10-04). Absent or null: nothing to show.
     */
    organisationPhotoUrl: z.string().url().nullable().optional(),
    organisationCoverUrl: z.string().url().nullable().optional(),
  })
  .strict();
export type PublicGatewayDto = z.infer<typeof PublicGatewayDtoSchema>;

// ---------------------------------------------------------------------------
// P7 · reading a mandate into a DRAFT gate policy
// ---------------------------------------------------------------------------

export const GATEQ_GATEWAY_POLICY_EXTRACTIONS_PATH =
  "/v1/gateq/gateways/:gatewayId/policy-extractions" as const;

export const GATEQ_MANDATE_TEXT_MAX_CHARS = 20_000;

/**
 * The investor's mandate, pasted or read from a text file in their browser.
 * Consequential enough to be idempotent: one `clientRequestId` is one
 * reading, however often a flaky connection retries it.
 */
export const PolicyExtractionRequestSchema = z
  .object({
    text: z.string().trim().min(1).max(GATEQ_MANDATE_TEXT_MAX_CHARS),
    sourceKind: z.enum(["PASTED_TEXT", "UPLOADED_FILE"]),
    clientRequestId: z
      .string()
      .min(8)
      .max(128)
      .regex(/^[A-Za-z0-9:_-]+$/),
  })
  .strict();
export type PolicyExtractionRequest = z.infer<
  typeof PolicyExtractionRequestSchema
>;

export const MandateDimensionDtoSchema = z.enum([
  "STAGE",
  "GEOGRAPHY",
  "SECTOR",
  "CHEQUE",
]);

/** One proposed criterion. A draft: nothing is a rule until published. */
export const PolicyProposalDtoSchema = z
  .object({
    dimension: MandateDimensionDtoSchema,
    requiredness: CriterionRequirednessDtoSchema,
    label: z.string().min(1).max(120),
    config: GatewayCriterionInputSchema,
    valueLabels: z.array(z.string().max(200)).max(64),
    quote: z.string().max(240),
  })
  .strict();
export type PolicyProposalDto = z.infer<typeof PolicyProposalDtoSchema>;

export const PolicyExtractionDtoSchema = z
  .object({
    extractionId: UuidSchema,
    readerVersion: z.string().max(64),
    proposals: z.array(PolicyProposalDtoSchema).max(64),
    /** What the mandate never said. Unknown, not "anything goes". */
    notFound: z.array(MandateDimensionDtoSchema).max(4),
    /** Places named negatively. Reported for the investor; never a rule. */
    excludedPlaces: z.array(z.string().max(200)).max(64),
    deduplicated: z.boolean(),
  })
  .strict();
export type PolicyExtractionDto = z.infer<typeof PolicyExtractionDtoSchema>;
