import { z } from "zod";

import { createUuidIdSchema } from "@capital-q/contracts";
import { TenantIdSchema, UserIdSchema } from "@capital-q/security";

/**
 * GateQ contracts (CQ-GATE-001; doc 11, doc 13, GateQ supplementary spec).
 *
 *   gateway mode ≠ qualification outcome ≠ access decision
 *   GateQ policy ≠ investor mandate
 *   qualified ≠ good company ≠ investment-ready ≠ recommended
 *   unknown ≠ no match
 *
 * A gateway is an investor organisation's front door: the policy it
 * publishes about what it is willing to be approached about. It answers
 * exactly one question — does this application satisfy this organisation's
 * published inbound policy — and nothing it produces is a score, a ranking
 * input, a quality judgement or a relationship.
 */

export const GatewayIdSchema = createUuidIdSchema("GatewayId");
export type GatewayId = z.infer<typeof GatewayIdSchema>;

export const GatewayVersionIdSchema = createUuidIdSchema("GatewayVersionId");
export type GatewayVersionId = z.infer<typeof GatewayVersionIdSchema>;

export const GatewayCriterionIdSchema =
  createUuidIdSchema("GatewayCriterionId");
export type GatewayCriterionId = z.infer<typeof GatewayCriterionIdSchema>;

/**
 * The opaque public handle. It appears in a link, an embed or a QR code, so
 * it must be unguessable and it must grant nothing: every private read is
 * authorised separately, and a caller holding one of these can see only the
 * published public projection of a published gateway.
 */
export const GatewayPublicIdSchema = z
  .string()
  .regex(/^gq_[0-9a-hjkmnp-tv-z]{26}$/, "expected an opaque gateway public id");
export type GatewayPublicId = z.infer<typeof GatewayPublicIdSchema>;

/**
 * How the organisation's front door is set (§2).
 *
 * This is the door, not the visitor. It says whether unsolicited inbound is
 * possible at all and under what condition — it never says anything about a
 * particular company, which is what a qualification outcome is for.
 */
export const GATEWAY_INBOUND_MODES = [
  /** No unsolicited inbound. Not a rejection of anyone in particular. */
  "CLOSED",
  /** Inbound only where the published required criteria are satisfied. */
  "QUALIFIED",
  /** Inbound from anyone; fit may still be described, and it does not gate. */
  "OPEN",
] as const;
export const GatewayInboundModeSchema = z.enum(GATEWAY_INBOUND_MODES);
export type GatewayInboundMode = z.infer<typeof GatewayInboundModeSchema>;

/** A version's lifecycle. At most one PUBLISHED version per gateway. */
export const GATEWAY_VERSION_STATUSES = [
  "DRAFT",
  "PUBLISHED",
  /** Replaced by a later publication. Kept so historical results stay attributable. */
  "SUPERSEDED",
  /** Withdrawn without a replacement; the gateway has no published policy. */
  "ARCHIVED",
] as const;
export const GatewayVersionStatusSchema = z.enum(GATEWAY_VERSION_STATUSES);
export type GatewayVersionStatus = z.infer<typeof GatewayVersionStatusSchema>;

export const GATEWAY_STATUSES = ["ACTIVE", "DISABLED"] as const;
export const GatewayStatusSchema = z.enum(GATEWAY_STATUSES);
export type GatewayStatus = z.infer<typeof GatewayStatusSchema>;

// ---------------------------------------------------------------------------
// Criteria
// ---------------------------------------------------------------------------

/**
 * Whether a criterion can stop an application (§8).
 *
 * Two values, no weights and no threshold. A numeric score here would be a
 * second ranker with none of REC-005's governance, and doc 19 §53 leaves
 * calibrated scoring open until outcome data exists.
 */
export const CRITERION_REQUIREDNESS = ["REQUIRED", "PREFERRED"] as const;
export const CriterionRequirednessSchema = z.enum(CRITERION_REQUIREDNESS);
export type CriterionRequiredness = z.infer<typeof CriterionRequirednessSchema>;

/**
 * What the engine concluded about one criterion.
 *
 * `UNKNOWN` is a first-class answer and never a soft NO_MATCH (§9). If
 * Capital Q does not know a company's revenue, the honest statement is that
 * nobody has said — not that the company fails. Absence is never zero.
 */
export const CRITERION_STATUSES = ["MATCH", "NO_MATCH", "UNKNOWN"] as const;
export const CriterionStatusSchema = z.enum(CRITERION_STATUSES);
export type CriterionStatus = z.infer<typeof CriterionStatusSchema>;

/**
 * The criterion types this version of GateQ can actually evaluate.
 *
 * Each one is backed by canonical, already-authoritative data: taxonomy
 * assignments, the company's declared country and stage, and its capital
 * objective. Nothing here is inferred, and nothing here reads observed
 * behaviour, a recommendation score or a Q conclusion.
 */
export const CRITERION_TYPES = [
  /** ACTIVE classifications under the allowed nodes of one vocabulary. */
  "TAXONOMY",
  /** The company's declared headquarters country, against an allow list. */
  "GEOGRAPHY",
  /** The company's declared current stage, against an allow list. */
  "STAGE",
  /** The company's raise target, against a configured band. */
  "RAISE_SIZE",
  /** The gateway's cheque range against the company's raise target. */
  "CHEQUE_COMPATIBILITY",
  /** A published hard exclusion: a proven classification under an excluded node. */
  "EXCLUDED_TAXONOMY",
] as const;
export const CriterionTypeSchema = z.enum(CRITERION_TYPES);
export type CriterionType = z.infer<typeof CriterionTypeSchema>;

/**
 * Dimensions the Product Specification names that this version deliberately
 * cannot evaluate, with the reason each one is not safely computable today.
 *
 * They are absent from `CRITERION_TYPES` rather than present and always
 * UNKNOWN, so a gateway cannot publish a policy Capital Q would never be
 * able to answer. Exported because a gap that lives only in a document
 * stops being true the first time somebody forgets it.
 */
export const UNSUPPORTED_CRITERION_DIMENSIONS = [
  {
    dimension: "REVENUE",
    reason:
      "No canonical revenue exists on a company. Financials are document-derived evidence with their own truth class and disclosure scope; reading one here would make an unverified extraction into inbound policy.",
  },
  {
    dimension: "TRACTION",
    reason:
      "No canonical traction measure exists. Every candidate signal today is either narrative, Q inference, or observed platform behaviour, and none of those is declared company truth.",
  },
  {
    dimension: "READINESS",
    reason:
      "`marketplace_readiness_state` is a marketplace lifecycle state, not an assessment, and no governed InvestIQ projection exists. Readiness is also a separate axis from fit: a company can be ready and out of scope, or in scope and not ready.",
  },
] as const;

const DecimalAmountSchema = z
  .string()
  .regex(/^(0|[1-9][0-9]{0,15})(\.[0-9]{1,2})?$/, "expected a decimal amount");
const CurrencySchema = z.string().regex(/^[A-Z]{3}$/, "expected ISO 4217");
const NodeIdSchema = z.string().uuid();

/**
 * The configured shape of one criterion, discriminated by type.
 *
 * Stored as a bounded JSONB payload and validated here at every boundary:
 * it is a closed union with a version, not arbitrary user JSON. Taxonomy
 * always references canonical node ids — a label is for display and is
 * never the stored authority (§11).
 */
export const CriterionConfigSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("TAXONOMY"),
      vocabularyCode: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
      /** Canonical node ids. A company matching any of them, or a descendant, matches. */
      allowedNodeIds: z.array(NodeIdSchema).min(1).max(64),
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
      /** Inclusive bounds; either may be absent, and an absent bound does not narrow. */
      minAmount: DecimalAmountSchema.nullable(),
      maxAmount: DecimalAmountSchema.nullable(),
    })
    .strict()
    .refine((c) => c.minAmount !== null || c.maxAmount !== null, {
      message: "a raise band needs at least one bound",
    }),
  z
    .object({
      type: z.literal("CHEQUE_COMPATIBILITY"),
      currency: CurrencySchema,
      /**
       * The gateway's own cheque range, declared here rather than read from
       * the mandate: a published GateQ rule must have GateQ provenance
       * (§7, §17), even where the two happen to agree.
       */
      minCheque: DecimalAmountSchema,
      maxCheque: DecimalAmountSchema.nullable(),
    })
    .strict(),
  z
    .object({
      type: z.literal("EXCLUDED_TAXONOMY"),
      vocabularyCode: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
      /** A proven ACTIVE classification under any of these excludes the company. */
      excludedNodeIds: z.array(NodeIdSchema).min(1).max(64),
    })
    .strict(),
]);
export type CriterionConfig = z.infer<typeof CriterionConfigSchema>;

export const GatewayCriterionSchema = z
  .object({
    id: GatewayCriterionIdSchema,
    versionId: GatewayVersionIdSchema,
    /** Display order in the investor's own configuration surface. */
    position: z.number().int().min(1).max(64),
    requiredness: CriterionRequirednessSchema,
    /** A short investor-authored label. Display only; never the authority. */
    label: z.string().min(1).max(120),
    config: CriterionConfigSchema,
  })
  .strict();
export type GatewayCriterion = z.infer<typeof GatewayCriterionSchema>;

/** What a caller supplies to put a criterion on a draft. */
export const NewGatewayCriterionSchema = GatewayCriterionSchema.omit({
  id: true,
  versionId: true,
});
export type NewGatewayCriterion = z.infer<typeof NewGatewayCriterionSchema>;

// ---------------------------------------------------------------------------
// Gateway and version
// ---------------------------------------------------------------------------

export const GatewaySchema = z
  .object({
    id: GatewayIdSchema,
    tenantId: TenantIdSchema,
    /**
     * The owning investor organisation. One organisation may hold several
     * gateways — a fund, a programme, an accelerator cohort — so nothing
     * here assumes a single front door.
     */
    investorOrganisationId: z.string().uuid(),
    organisationId: z.string().uuid(),
    publicId: GatewayPublicIdSchema,
    /** Investor-authored, shown publicly once a version is published. */
    name: z.string().min(1).max(160),
    status: GatewayStatusSchema,
    /** Provenance only. Authority is the organisation's, never this person's. */
    createdByUserId: UserIdSchema,
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict();
export type Gateway = z.infer<typeof GatewaySchema>;

export const GatewayVersionSchema = z
  .object({
    id: GatewayVersionIdSchema,
    gatewayId: GatewayIdSchema,
    tenantId: TenantIdSchema,
    /** Monotonic per gateway, starting at 1. A published number is never reused. */
    versionNumber: z.number().int().min(1),
    status: GatewayVersionStatusSchema,
    inboundMode: GatewayInboundModeSchema,
    /** Public-facing wording. Never private notes, never rejection logic. */
    publicTitle: z.string().min(1).max(160),
    publicDescription: z.string().min(1).max(2000).nullable(),
    /** The engine contract this version's results were produced under. */
    qualificationPolicyVersion: z.string().min(1).max(64),
    createdByUserId: UserIdSchema,
    publishedByUserId: UserIdSchema.nullable(),
    publishedAt: z.string().datetime({ offset: true }).nullable(),
    supersededAt: z.string().datetime({ offset: true }).nullable(),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict()
  .refine((v) => v.status !== "PUBLISHED" || v.publishedAt !== null, {
    message: "a published version has a publication time",
  })
  .refine((v) => v.status !== "DRAFT" || v.publishedAt === null, {
    // A superseded or archived version keeps its publication time: it was
    // published once, and a stored result still names it.
    message: "a draft has never been published",
  });
export type GatewayVersion = z.infer<typeof GatewayVersionSchema>;

/** A version with the criteria it carries. The unit the engine evaluates. */
export const GatewayPolicySchema = z
  .object({
    gateway: GatewaySchema,
    version: GatewayVersionSchema,
    criteria: z.array(GatewayCriterionSchema).max(64),
  })
  .strict();
export type GatewayPolicy = z.infer<typeof GatewayPolicySchema>;

// ---------------------------------------------------------------------------
// The public projection (§19)
// ---------------------------------------------------------------------------

/**
 * Everything an anonymous caller may learn about a published gateway, and
 * nothing else.
 *
 * It is a whitelist rather than a redaction, because a redaction is a list
 * of things somebody remembered to remove. There is no private mandate
 * here, no member, no draft, no internal configuration, no evidence, no
 * provider and no rejection logic. The criteria summary says what the
 * organisation is looking for, in the investor's own words, because that is
 * the point of a front door — it does not say how a decision is computed.
 */
export const PublicCriterionSummarySchema = z
  .object({
    label: z.string().min(1).max(120),
    requiredness: CriterionRequirednessSchema,
    /** The kind of thing asked about. Never the configured values. */
    dimension: CriterionTypeSchema,
  })
  .strict();
export type PublicCriterionSummary = z.infer<
  typeof PublicCriterionSummarySchema
>;

export const PublicGatewaySchema = z
  .object({
    publicId: GatewayPublicIdSchema,
    organisationDisplayName: z.string().min(1).max(200),
    title: z.string().min(1).max(160),
    description: z.string().min(1).max(2000).nullable(),
    inboundMode: GatewayInboundModeSchema,
    /**
     * Whether an application could be started at all. A CLOSED gateway is
     * still a real, visible front door that says it is not open (§20) —
     * never a 404, which would leak that the id was wrong rather than that
     * the door was shut.
     */
    acceptingApplications: z.boolean(),
    criteria: z.array(PublicCriterionSummarySchema).max(64),
    publishedAt: z.string().datetime({ offset: true }),
  })
  .strict();
export type PublicGateway = z.infer<typeof PublicGatewaySchema>;

// ---------------------------------------------------------------------------
// The company projection the engine evaluates (§12)
// ---------------------------------------------------------------------------

/**
 * The only company data qualification ever sees.
 *
 * Bounded on purpose. There is no founder-private memory here, no
 * conversation, no document, no data-room object and no Q inference —
 * not because a rule forbids reading them but because this type has
 * nowhere to put them. Derived intelligence inherits the sensitivity of
 * its source, so the way to keep private material out of an inbound
 * decision is to keep it out of the input.
 *
 * Every field is nullable, and null means nobody has said. It never means
 * zero and it never means no.
 */
export const CompanyQualificationProjectionSchema = z
  .object({
    companyId: z.string().uuid(),
    tenantId: z.string().uuid(),
    /** ACTIVE canonical classifications: node id with its vocabulary. */
    classifications: z
      .array(
        z
          .object({
            vocabularyCode: z.string().min(1).max(64),
            nodeId: NodeIdSchema,
            /** Ancestors of the assigned node, so an allowed parent matches. */
            ancestorNodeIds: z.array(NodeIdSchema).max(16),
          })
          .strict(),
      )
      .max(64),
    /** Declared headquarters country, ISO-3166-1 alpha-2. */
    headquartersCountry: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .nullable(),
    /** Declared current stage code. */
    currentStageCode: z.string().min(1).max(64).nullable(),
    /** The open capital objective's target, if the company has declared one. */
    raise: z
      .object({
        amount: DecimalAmountSchema,
        currency: CurrencySchema,
      })
      .strict()
      .nullable(),
  })
  .strict();
export type CompanyQualificationProjection = z.infer<
  typeof CompanyQualificationProjectionSchema
>;

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

/**
 * Bounded machine-readable reasons (§14).
 *
 * These are for a later natural-language layer to read, not for a person.
 * Q may turn one into a sentence; Q never decides which one it is.
 */
export const CRITERION_REASON_CODES = [
  "TAXONOMY_NODE_MATCHED",
  "TAXONOMY_ANCESTOR_MATCHED",
  "TAXONOMY_NO_OVERLAP",
  "TAXONOMY_NOT_CLASSIFIED",
  "GEOGRAPHY_COUNTRY_ALLOWED",
  "GEOGRAPHY_COUNTRY_NOT_ALLOWED",
  "GEOGRAPHY_NOT_DECLARED",
  "STAGE_ALLOWED",
  "STAGE_NOT_ALLOWED",
  "STAGE_NOT_DECLARED",
  "RAISE_WITHIN_BAND",
  "RAISE_BELOW_BAND",
  "RAISE_ABOVE_BAND",
  "RAISE_NOT_DECLARED",
  "RAISE_CURRENCY_DIFFERS",
  "CHEQUE_FITS_RAISE",
  "CHEQUE_EXCEEDS_RAISE",
  "CHEQUE_CURRENCY_DIFFERS",
  "EXCLUSION_MATCHED",
  "EXCLUSION_NOT_MATCHED",
  "EXCLUSION_NOT_ASSESSABLE",
] as const;
export const CriterionReasonCodeSchema = z.enum(CRITERION_REASON_CODES);
export type CriterionReasonCode = z.infer<typeof CriterionReasonCodeSchema>;

export const CriterionResultSchema = z
  .object({
    criterionId: GatewayCriterionIdSchema,
    type: CriterionTypeSchema,
    requiredness: CriterionRequirednessSchema,
    label: z.string().min(1).max(120),
    status: CriterionStatusSchema,
    reasonCode: CriterionReasonCodeSchema,
    /**
     * A safe, bounded reference to what was observed — a country code, a
     * stage code, a currency. Never a private value, never an amount from
     * a document, never internal arithmetic.
     */
    observed: z.string().max(64).nullable(),
  })
  .strict();
export type CriterionResult = z.infer<typeof CriterionResultSchema>;

/**
 * What the gateway concluded about this company (§2).
 *
 * Separate from the gateway's mode and separate again from whether the
 * company may apply: a company can be QUALIFIED at a CLOSED gateway, and
 * an OPEN gateway may admit a company that is NOT_QUALIFIED.
 */
export const QUALIFICATION_OUTCOMES = [
  "QUALIFIED",
  "NOT_QUALIFIED",
  "INSUFFICIENT_INFORMATION",
] as const;
export const QualificationOutcomeSchema = z.enum(QUALIFICATION_OUTCOMES);
export type QualificationOutcome = z.infer<typeof QualificationOutcomeSchema>;

/** Whether an application can be made. The door's answer, not the fit's. */
export const ACCESS_DECISIONS = [
  "MAY_APPLY",
  "MAY_NOT_APPLY",
  "NEEDS_INFORMATION",
] as const;
export const AccessDecisionSchema = z.enum(ACCESS_DECISIONS);
export type AccessDecision = z.infer<typeof AccessDecisionSchema>;

export const ACCESS_REASON_CODES = [
  "GATEWAY_CLOSED",
  "GATEWAY_OPEN",
  "REQUIRED_CRITERIA_SATISFIED",
  "REQUIRED_CRITERIA_NOT_SATISFIED",
  "REQUIRED_INFORMATION_MISSING",
  "GATEWAY_DISABLED",
  "GATEWAY_NOT_PUBLISHED",
] as const;
export const AccessReasonCodeSchema = z.enum(ACCESS_REASON_CODES);
export type AccessReasonCode = z.infer<typeof AccessReasonCodeSchema>;

export const QualificationResultSchema = z
  .object({
    gatewayId: GatewayIdSchema,
    gatewayVersionId: GatewayVersionIdSchema,
    /** The exact published policy this was decided under; never "current". */
    gatewayVersionNumber: z.number().int().min(1),
    qualificationPolicyVersion: z.string().min(1).max(64),
    companyId: z.string().uuid(),
    inboundMode: GatewayInboundModeSchema,
    outcome: QualificationOutcomeSchema,
    access: AccessDecisionSchema,
    accessReasonCode: AccessReasonCodeSchema,
    criteria: z.array(CriterionResultSchema).max(64),
    /** Required criteria that did not match, by criterion id. */
    principalMismatches: z.array(GatewayCriterionIdSchema).max(64),
    /** Required criteria nobody could answer, by criterion id. */
    unknowns: z.array(GatewayCriterionIdSchema).max(64),
    evaluatedAt: z.string().datetime({ offset: true }),
  })
  .strict();
export type QualificationResult = z.infer<typeof QualificationResultSchema>;
