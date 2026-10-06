import { z } from "zod";

import { UuidSchema } from "../common/ids.js";
import { LocalDateSchema, UtcTimestampSchema } from "../common/time.js";
import { CapitalTargetSchema } from "./capital-objectives.js";
import {
  CompanyStatusSchema,
  MarketplaceVisibilitySchema,
} from "./companies.js";

/**
 * The visibility control centre (CQ-BIZ-003; business research §6.2, R8).
 *
 * One company's disclosable objects, who each is visible to, the active
 * shares with named relationships (with revoke), and a preview of the
 * company exactly as one audience sees it. Every answer is the server's:
 * the preview is decided by the same disclosure evaluator every real read
 * uses, and carries only the projections those reads return. It is a
 * read-only projection, never impersonation (FSR §22).
 *
 * The objects are the ones whose scope the model holds today:
 *
 *   COMPANY_PROFILE    the declared profile; organisation_private or
 *                      network_visible (company.visibility.set). Not
 *                      public_external until a public page exists (BIZ-004).
 *   CAPITAL_OBJECTIVE  the current raise, structured (target, instrument,
 *                      stage, close date; never the use-of-funds
 *                      narrative); founder_private, shareable with a named
 *                      relationship, never network or public.
 */

export const COMPANY_VISIBILITY_STATE_PATH =
  "/v1/companies/:companyId/visibility/state" as const;
export const COMPANY_AUDIENCE_PREVIEW_PATH =
  "/v1/companies/:companyId/visibility/preview" as const;
export const COMPANY_SHARES_PATH =
  "/v1/companies/:companyId/visibility/shares" as const;
export const COMPANY_SHARE_REVOKE_PATH =
  "/v1/companies/:companyId/visibility/shares/:policyId/revoke" as const;

export const VISIBILITY_OBJECTS = [
  "COMPANY_PROFILE",
  "CAPITAL_OBJECTIVE",
] as const;
export const VisibilityObjectSchema = z.enum(VISIBILITY_OBJECTS);
export type VisibilityObject = z.infer<typeof VisibilityObjectSchema>;

/**
 * Who is looking. PUBLIC is anyone with a link, unauthenticated; NETWORK is
 * a Capital Q organisation with no relationship to the company; INVESTOR is
 * one named relationship's investor organisation; ONLY_US is the company's
 * own organisation.
 */
export const VISIBILITY_AUDIENCES = [
  "PUBLIC",
  "NETWORK",
  "INVESTOR",
  "ONLY_US",
] as const;
export const VisibilityAudienceSchema = z.enum(VISIBILITY_AUDIENCES);
export type VisibilityAudience = z.infer<typeof VisibilityAudienceSchema>;

export const VisibilityObjectStateDtoSchema = z
  .object({
    object: VisibilityObjectSchema,
    resourceId: UuidSchema,
    /** The object's own classification, as persisted. */
    scope: MarketplaceVisibilitySchema,
    /** The scopes the person may choose for it here; empty when fixed. */
    choices: z.array(MarketplaceVisibilitySchema).max(8),
    /** Whether it can be shared with a named relationship. */
    shareable: z.boolean(),
  })
  .strict();
export type VisibilityObjectStateDto = z.infer<
  typeof VisibilityObjectStateDtoSchema
>;

/** One active share: what, with whom, how, until when. */
export const VisibilityShareDtoSchema = z
  .object({
    policyId: UuidSchema,
    object: VisibilityObjectSchema,
    /** Null for the network-wide share (P14). */
    relationshipId: UuidSchema.nullable(),
    /** The investor organisation's name; null when it cannot be resolved. */
    recipientName: z.string().min(1).max(200).nullable(),
    accessLevel: z.enum(["view", "view_download"]),
    createdAt: UtcTimestampSchema,
    expiresAt: UtcTimestampSchema.nullable(),
  })
  .strict();
export type VisibilityShareDto = z.infer<typeof VisibilityShareDtoSchema>;

/** A relationship the company can share with or preview as. */
export const VisibilityRelationshipDtoSchema = z
  .object({
    relationshipId: UuidSchema,
    investorOrganisationId: UuidSchema,
    name: z.string().min(1).max(200),
  })
  .strict();
export type VisibilityRelationshipDto = z.infer<
  typeof VisibilityRelationshipDtoSchema
>;

export const VisibilityStateDtoSchema = z
  .object({
    companyId: UuidSchema,
    objects: z.array(VisibilityObjectStateDtoSchema).max(8),
    shares: z.array(VisibilityShareDtoSchema).max(200),
    relationships: z.array(VisibilityRelationshipDtoSchema).max(200),
    /**
     * P14 (ADR 0060): the raise shown to every investor on the network, by
     * the founder's own choice; null when it is not. Revoked by policyId.
     */
    networkRaiseShare: z
      .object({ policyId: UuidSchema, createdAt: UtcTimestampSchema })
      .strict()
      .nullable()
      .optional(),
  })
  .strict();
export type VisibilityStateDto = z.infer<typeof VisibilityStateDtoSchema>;

export const AudiencePreviewQuerySchema = z
  .object({
    audience: VisibilityAudienceSchema,
    /** Required for INVESTOR, refused otherwise. */
    relationshipId: UuidSchema.optional(),
  })
  .strict()
  .refine(
    (query) =>
      (query.audience === "INVESTOR") === (query.relationshipId !== undefined),
    { message: "relationshipId is required for INVESTOR and only for it" },
  );
export type AudiencePreviewQuery = z.infer<typeof AudiencePreviewQuerySchema>;

/** The company profile as the network projection carries it. */
export const AudienceProfileDtoSchema = z
  .object({
    canonicalName: z.string(),
    legalName: z.string().nullable(),
    websiteUrl: z.string().nullable(),
    foundedDate: z.string().nullable(),
    headquartersCountry: z.string().nullable(),
    headquartersCity: z.string().nullable(),
    currentStageCode: z.string().nullable(),
    shortDescription: z.string().nullable(),
    primaryDescription: z.string().nullable(),
    companyStatus: CompanyStatusSchema,
  })
  .strict();
export type AudienceProfileDto = z.infer<typeof AudienceProfileDtoSchema>;

/** The raise, structured; never the use-of-funds narrative. */
export const AudienceCapitalObjectiveDtoSchema = z
  .object({
    target: CapitalTargetSchema,
    targetStage: z.string().nullable(),
    instrumentCode: z.string().nullable(),
    targetCloseDate: LocalDateSchema.nullable(),
  })
  .strict();
export type AudienceCapitalObjectiveDto = z.infer<
  typeof AudienceCapitalObjectiveDtoSchema
>;

/** Null object: this audience sees nothing of it. */
export const AudiencePreviewDtoSchema = z
  .object({
    audience: VisibilityAudienceSchema,
    relationshipId: UuidSchema.nullable(),
    profile: AudienceProfileDtoSchema.nullable(),
    capitalObjective: AudienceCapitalObjectiveDtoSchema.nullable(),
  })
  .strict();
export type AudiencePreviewDto = z.infer<typeof AudiencePreviewDtoSchema>;

/**
 * Share the object with one relationship's investor organisation, or (P14,
 * ADR 0060) with every investor on the network: the founder's explicit,
 * revocable choice. Exactly one of the two. Idempotency-Key required.
 */
export const CreateVisibilityShareRequestSchema = z
  .object({
    object: z.literal("CAPITAL_OBJECTIVE"),
    relationshipId: UuidSchema.optional(),
    audience: z.literal("NETWORK").optional(),
  })
  .strict()
  .refine(
    (input) =>
      (input.relationshipId === undefined) !== (input.audience === undefined),
    { message: "Share with one relationship or with the network, not both." },
  );
export type CreateVisibilityShareRequest = z.infer<
  typeof CreateVisibilityShareRequestSchema
>;

export const VisibilityShareResultDtoSchema = z
  .object({
    /** REDUNDANT: the audience already sees it; nothing was written. */
    outcome: z.enum(["CREATED", "EXISTING", "REDUNDANT"]),
    share: VisibilityShareDtoSchema.nullable(),
  })
  .strict();
export type VisibilityShareResultDto = z.infer<
  typeof VisibilityShareResultDtoSchema
>;

export const VisibilityRevokeResultDtoSchema = z
  .object({ outcome: z.enum(["REVOKED", "ALREADY_REVOKED"]) })
  .strict();
export type VisibilityRevokeResultDto = z.infer<
  typeof VisibilityRevokeResultDtoSchema
>;
