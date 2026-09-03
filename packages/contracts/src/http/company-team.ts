import { z } from "zod";

import { UuidSchema } from "../common/ids.js";
import { UtcTimestampSchema } from "../common/time.js";
import { ResourceVersionSchema } from "../common/version.js";

/**
 * `/v1/companies/:companyId/team/me`, `/founder-profile/me`, `/team-facts`.
 *
 * Three separate facts, kept separate on the wire:
 *
 *   company membership  this Person's relationship to this Company
 *   founder profile     this Person's own, deliberately supplied narrative
 *   team facts          self-reported aggregate composition of the Company
 *
 * Every `/me` contract is about the caller: no userId is accepted anywhere.
 * Strict schemas: tenantId, organisationId, userId, visibilityScope, roles,
 * verification and scores fail validation.
 */

export const COMPANY_RELATIONSHIP_TYPES = [
  "team_member",
  "advisor",
  "board_member",
  "contractor",
  "other",
] as const;
export const CompanyRelationshipTypeSchema = z.enum(COMPANY_RELATIONSHIP_TYPES);
export type CompanyRelationshipType = z.infer<
  typeof CompanyRelationshipTypeSchema
>;

export const BUSINESS_TITLE_MAX_LENGTH = 120;
export const FOUNDER_SUMMARY_MAX_LENGTH = 4000;

const BusinessTitleSchema = z
  .string()
  .trim()
  .min(1)
  .max(BUSINESS_TITLE_MAX_LENGTH);
const SummarySchema = z.string().trim().min(1).max(FOUNDER_SUMMARY_MAX_LENGTH);
const CountSchema = z.number().int().min(0).max(1_000_000);

/** Desired state of the caller's own relationship to the company. Idempotent PUT. */
export const UpsertMyCompanyMembershipRequestSchema = z
  .object({
    relationshipType: CompanyRelationshipTypeSchema,
    businessTitle: BusinessTitleSchema.nullable().optional(),
    isFounder: z.boolean(),
  })
  .strict();

export type UpsertMyCompanyMembershipRequest = z.infer<
  typeof UpsertMyCompanyMembershipRequestSchema
>;

export const CompanyMemberDtoSchema = z.object({
  id: UuidSchema,
  companyId: UuidSchema,
  relationshipType: CompanyRelationshipTypeSchema,
  businessTitle: z.string().nullable(),
  isFounder: z.boolean(),
  isCurrent: z.boolean(),
  startedAt: UtcTimestampSchema,
  endedAt: UtcTimestampSchema.nullable(),
  version: ResourceVersionSchema,
});

export type CompanyMemberDto = z.infer<typeof CompanyMemberDtoSchema>;

export const FOUNDER_PROFILE_EDITABLE_FIELDS = [
  "professionalSummary",
  "backgroundSummary",
] as const;

/**
 * The caller's own founder profile. `expectedVersion` is absent on first
 * creation and required afterwards. There is no field for Q conversation,
 * private concerns or negotiation positions, and none will be added here.
 */
export const UpdateMyFounderProfileRequestSchema = z
  .object({
    expectedVersion: ResourceVersionSchema.optional(),
    professionalSummary: SummarySchema.nullable().optional(),
    backgroundSummary: SummarySchema.nullable().optional(),
  })
  .strict()
  .refine(
    (value) =>
      FOUNDER_PROFILE_EDITABLE_FIELDS.some(
        (field) => value[field] !== undefined,
      ),
    { message: "expected at least one profile field" },
  );

export type UpdateMyFounderProfileRequest = z.infer<
  typeof UpdateMyFounderProfileRequestSchema
>;

export const FounderProfileDtoSchema = z.object({
  id: UuidSchema,
  primaryCompanyId: UuidSchema.nullable(),
  professionalSummary: z.string().nullable(),
  backgroundSummary: z.string().nullable(),
  version: ResourceVersionSchema,
  createdAt: UtcTimestampSchema,
  updatedAt: UtcTimestampSchema,
});

export type FounderProfileDto = z.infer<typeof FounderProfileDtoSchema>;

export const TEAM_FACT_FIELDS = [
  "founderCount",
  "fullTimeFounderCount",
  "teamSize",
] as const;

/** `null` records "unknown"; it is never converted to zero. */
export const UpdateCompanyTeamFactsRequestSchema = z
  .object({
    expectedVersion: ResourceVersionSchema.optional(),
    founderCount: CountSchema.nullable().optional(),
    fullTimeFounderCount: CountSchema.nullable().optional(),
    teamSize: CountSchema.nullable().optional(),
  })
  .strict()
  .refine(
    (value) => TEAM_FACT_FIELDS.some((field) => value[field] !== undefined),
    { message: "expected at least one team fact" },
  );

export type UpdateCompanyTeamFactsRequest = z.infer<
  typeof UpdateCompanyTeamFactsRequestSchema
>;

export const CompanyTeamFactsDtoSchema = z.object({
  companyId: UuidSchema,
  founderCount: z.number().int().nullable(),
  fullTimeFounderCount: z.number().int().nullable(),
  teamSize: z.number().int().nullable(),
  version: ResourceVersionSchema,
  updatedAt: UtcTimestampSchema,
});

export type CompanyTeamFactsDto = z.infer<typeof CompanyTeamFactsDtoSchema>;

export const COMPANY_TEAM_ME_SUFFIX = "/team/me" as const;
export const COMPANY_FOUNDER_PROFILE_ME_SUFFIX = "/founder-profile/me" as const;
export const COMPANY_TEAM_FACTS_SUFFIX = "/team-facts" as const;
