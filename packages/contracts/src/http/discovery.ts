import { z } from "zod";

import { UuidSchema } from "../common/ids.js";

/**
 * `GET /v1/discovery/companies` and `/v1/discovery/investors` (doc 19).
 *
 * A slate: who this person could reasonably meet, in a deterministic
 * order, with the declared reasons that produced it. Cursor-paged, never
 * offset. No score reaches the wire — doc 19 forbids presenting an
 * invented number as a verdict, and `rank` exists only so a slate can be
 * reproduced server-side.
 */

export const DISCOVERY_COMPANIES_PATH = "/v1/discovery/companies" as const;
export const DISCOVERY_INVESTORS_PATH = "/v1/discovery/investors" as const;

export const DiscoveryReasonDtoSchema = z
  .object({
    kind: z.enum([
      "STAGE_IN_RANGE",
      "SECTOR_MATCH",
      "GEOGRAPHY_MATCH",
      "BUSINESS_MODEL_MATCH",
      "CUSTOMER_TYPE_MATCH",
      "DECLARED_DEPLOYING",
      "PROFILE_COMPLETE",
    ]),
    detail: z.string().max(200),
  })
  .strict();
export type DiscoveryReasonDto = z.infer<typeof DiscoveryReasonDtoSchema>;

export const DiscoveryNoteDtoSchema = z.enum([
  "NO_ACTIVE_MANDATE",
  "MANDATE_HAS_NO_PREFERENCES",
  "NO_DISCOVERABLE_COUNTERPARTS",
  "RANKED_ON_DECLARED_PROFILE_ONLY",
  /** No servable persisted slate yet; a rebuild has been requested (CQ-REC-006). */
  "RECOMMENDATIONS_REFRESHING",
  /** The cursor's slate is no longer servable; this page starts the current one. */
  "SLATE_RESTARTED",
]);
export type DiscoveryNoteDto = z.infer<typeof DiscoveryNoteDtoSchema>;

export const DiscoveredCompanyDtoSchema = z
  .object({
    companyId: UuidSchema,
    canonicalName: z.string(),
    websiteUrl: z.string().nullable(),
    headquartersCountry: z.string().nullable(),
    currentStageCode: z.string().nullable(),
    shortDescription: z.string().nullable(),
    reasons: z.array(DiscoveryReasonDtoSchema).max(8),
    /**
     * Declared-alignment codes from the persisted slate (CQ-REC-006):
     * machine-readable, bounded, never a score. Explanations are REC-007's.
     */
    reasonCodes: z.array(z.string().max(64)).max(8),
  })
  .strict();
export type DiscoveredCompanyDto = z.infer<typeof DiscoveredCompanyDtoSchema>;

export const DiscoveredInvestorDtoSchema = z
  .object({
    investorOrganisationId: UuidSchema,
    displayName: z.string(),
    investorType: z.string(),
    websiteUrl: z.string().nullable(),
    hqCountry: z.string().nullable(),
    publicDescription: z.string().nullable(),
    deploymentState: z.string().nullable(),
    reasons: z.array(DiscoveryReasonDtoSchema).max(8),
  })
  .strict();
export type DiscoveredInvestorDto = z.infer<typeof DiscoveredInvestorDtoSchema>;

export const DiscoveryCompanySlateDtoSchema = z
  .object({
    /** The persisted slate this page came from; null while none is servable. */
    slateId: UuidSchema.nullable(),
    /** Which ranking produced this slate, so a result can be reproduced. */
    rankingVersion: z.string().max(64),
    items: z.array(DiscoveredCompanyDtoSchema),
    notes: z.array(DiscoveryNoteDtoSchema).max(4),
    nextCursor: z.string().max(200).nullable(),
  })
  .strict();
export type DiscoveryCompanySlateDto = z.infer<
  typeof DiscoveryCompanySlateDtoSchema
>;

export const DiscoveryInvestorSlateDtoSchema = z
  .object({
    rankingVersion: z.string().max(64),
    items: z.array(DiscoveredInvestorDtoSchema),
    notes: z.array(DiscoveryNoteDtoSchema).max(4),
    nextCursor: z.string().max(200).nullable(),
  })
  .strict();
export type DiscoveryInvestorSlateDto = z.infer<
  typeof DiscoveryInvestorSlateDtoSchema
>;

// ---------------------------------------------------------------------------
// Why an investor is seeing a company (CQ-REC-007; doc 19 §57, §65).
// ---------------------------------------------------------------------------

/**
 * `GET /v1/discovery/slates/:slateId/companies/:companyId/explanation`.
 *
 * One recommendation, explained by the factors that produced it. The path
 * names a slate and a company because an explanation belongs to the
 * ordering it came from, not to a company in general — and because an old
 * recommendation must be explained by the ranking that produced it.
 * Neither id is authority: the server resolves the actor's own investor
 * organisation and answers NOT_FOUND for anybody else's slate.
 */
export const DISCOVERY_EXPLANATION_PATH =
  "/v1/discovery/slates/:slateId/companies/:companyId/explanation" as const;

export const ExplanationFactorDtoSchema = z
  .object({
    /** STAGE, GEOGRAPHY, TAXONOMY, SEMANTIC, CHEQUE. */
    dimension: z.string().max(32),
    /** MATCH, PARTIAL, MISMATCH, UNKNOWN, NOT_APPLICABLE. */
    outcome: z.string().max(32),
    /** Plain English, bounded, safe to show. */
    label: z.string().max(160),
    /** The ranker's own bounded code. Machine-readable, never a score. */
    reasonCode: z.string().max(64),
  })
  .strict();
export type ExplanationFactorDto = z.infer<typeof ExplanationFactorDtoSchema>;

export const RecommendationExplanationDtoSchema = z
  .object({
    slateId: UuidSchema,
    companyId: UuidSchema,
    /** Position in the reader's own slate. A place in a list, not a verdict. */
    rank: z.number().int().min(1),
    /** Q's phrasing when it was available, the deterministic wording otherwise. */
    summary: z.string().max(1200),
    matchedFactors: z.array(ExplanationFactorDtoSchema).max(8),
    mismatchedFactors: z.array(ExplanationFactorDtoSchema).max(8),
    uncertainties: z.array(ExplanationFactorDtoSchema).max(8),
    /** The ranking that produced this item, so an explanation is reproducible. */
    generatedFromRankingVersion: z.string().max(128),
    /**
     * DETERMINISTIC or Q_SYNTHESIZED. The factors are the same either way;
     * this says only who chose the words, so a reader is never told a model
     * decided something it did not.
     */
    source: z.enum(["DETERMINISTIC", "Q_SYNTHESIZED"]),
  })
  .strict();
export type RecommendationExplanationDto = z.infer<
  typeof RecommendationExplanationDtoSchema
>;
