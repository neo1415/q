import { z } from "zod";

import { CountryCodeSchema } from "../common/geography.js";
import { UuidSchema } from "../common/ids.js";
import { UtcTimestampSchema } from "../common/time.js";
import { ResourceVersionSchema } from "../common/version.js";

/**
 * `/v1/companies` -- the canonical Company profile contract.
 *
 * A Company is the business itself: one canonical record that founder
 * onboarding, evidence, Q, the capital objective, discovery and the Q Card
 * all reference. It is not the organisation (the workspace it belongs to),
 * not a founder, not a fundraise and not a score.
 *
 * Strict request schemas: identity and authority fields (id, tenantId,
 * organisationId, companyStatus, marketplaceVisibility,
 * marketplaceReadinessState, version, verified, scores) fail validation.
 */

export const COMPANY_STATUSES = ["active", "closed"] as const;
export const CompanyStatusSchema = z.enum(COMPANY_STATUSES);
export type CompanyStatus = z.infer<typeof CompanyStatusSchema>;

/** ADR-001 visibility scopes, as persisted. Read-only on this contract. */
export const MARKETPLACE_VISIBILITIES = [
  "personal_private",
  "organisation_private",
  "founder_private",
  "investor_private",
  "relationship_shared",
  "specifically_shared",
  "network_visible",
  "public_external",
] as const;
export const MarketplaceVisibilitySchema = z.enum(MARKETPLACE_VISIBILITIES);
export type MarketplaceVisibility = z.infer<typeof MarketplaceVisibilitySchema>;

/**
 * Readiness engine output. Only `not_assessed` exists today and it means
 * "not marketplace eligible". Bounded text so the readiness packet can add
 * states without a contract rewrite.
 */
export const MarketplaceReadinessStateSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]*$/)
  .max(64);
export const MARKETPLACE_READINESS_NOT_ASSESSED = "not_assessed" as const;

export const COMPANY_NAME_MAX_LENGTH = 200;
export const COMPANY_CITY_MAX_LENGTH = 120;
export const COMPANY_PRIMARY_DESCRIPTION_MAX_LENGTH = 8000;
export const COMPANY_SHORT_DESCRIPTION_MAX_LENGTH = 400;

const CanonicalNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(COMPANY_NAME_MAX_LENGTH);
const LegalNameSchema = z.string().trim().min(1).max(COMPANY_NAME_MAX_LENGTH);
const WebsiteUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .url()
  .refine((value) => /^https?:\/\//i.test(value), {
    message: "expected an http(s) URL",
  });
/** A calendar date (YYYY-MM-DD), never a datetime. */
const FoundedDateSchema = z.iso.date();
const CitySchema = z.string().trim().min(1).max(COMPANY_CITY_MAX_LENGTH);
/**
 * Opaque bounded stage reference. No closed enum: CQ-TAX-001 will supply
 * the canonical vocabulary and validate membership; this schema bounds the
 * shape so arbitrary text cannot be persisted meanwhile.
 */
export const StageCodeSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]*$/, "expected a lower_snake_case stage code")
  .max(64);
const PrimaryDescriptionSchema = z
  .string()
  .trim()
  .min(1)
  .max(COMPANY_PRIMARY_DESCRIPTION_MAX_LENGTH);
const ShortDescriptionSchema = z
  .string()
  .trim()
  .min(1)
  .max(COMPANY_SHORT_DESCRIPTION_MAX_LENGTH);

export const CreateCompanyRequestSchema = z
  .object({
    canonicalName: CanonicalNameSchema,
    legalName: LegalNameSchema.optional(),
    websiteUrl: WebsiteUrlSchema.optional(),
    foundedDate: FoundedDateSchema.optional(),
    headquartersCountry: CountryCodeSchema.optional(),
    headquartersCity: CitySchema.optional(),
    currentStageCode: StageCodeSchema.optional(),
    primaryDescription: PrimaryDescriptionSchema.optional(),
    shortDescription: ShortDescriptionSchema.optional(),
  })
  .strict();

export type CreateCompanyRequest = z.infer<typeof CreateCompanyRequestSchema>;

/** The profile fields an editor may change. Slug, status, visibility and readiness are not among them. */
export const COMPANY_EDITABLE_FIELDS = [
  "canonicalName",
  "legalName",
  "websiteUrl",
  "foundedDate",
  "headquartersCountry",
  "headquartersCity",
  "currentStageCode",
  "primaryDescription",
  "shortDescription",
] as const;

export type CompanyEditableField = (typeof COMPANY_EDITABLE_FIELDS)[number];

export const UpdateCompanyRequestSchema = z
  .object({
    expectedVersion: ResourceVersionSchema,
    canonicalName: CanonicalNameSchema.optional(),
    legalName: LegalNameSchema.nullable().optional(),
    websiteUrl: WebsiteUrlSchema.nullable().optional(),
    foundedDate: FoundedDateSchema.nullable().optional(),
    headquartersCountry: CountryCodeSchema.nullable().optional(),
    headquartersCity: CitySchema.nullable().optional(),
    currentStageCode: StageCodeSchema.nullable().optional(),
    primaryDescription: PrimaryDescriptionSchema.nullable().optional(),
    shortDescription: ShortDescriptionSchema.nullable().optional(),
  })
  .strict()
  .refine(
    (value) =>
      COMPANY_EDITABLE_FIELDS.some((field) => value[field] !== undefined),
    { message: "expected at least one field to update" },
  );

export type UpdateCompanyRequest = z.infer<typeof UpdateCompanyRequestSchema>;

/**
 * The organisation-internal Company profile. Visibility and readiness are
 * reported read-only so a workspace can see honestly that the company is
 * not in the marketplace; neither can be changed through PATCH.
 */
export const CompanyDtoSchema = z.object({
  id: UuidSchema,
  canonicalName: z.string(),
  legalName: z.string().nullable(),
  slug: z.string(),
  websiteUrl: z.string().nullable(),
  foundedDate: z.iso.date().nullable(),
  headquartersCountry: z.string().nullable(),
  headquartersCity: z.string().nullable(),
  currentStageCode: z.string().nullable(),
  primaryDescription: z.string().nullable(),
  shortDescription: z.string().nullable(),
  companyStatus: CompanyStatusSchema,
  marketplaceVisibility: MarketplaceVisibilitySchema,
  marketplaceReadinessState: MarketplaceReadinessStateSchema,
  version: ResourceVersionSchema,
  createdAt: UtcTimestampSchema,
  updatedAt: UtcTimestampSchema,
});

export type CompanyDto = z.infer<typeof CompanyDtoSchema>;

export const COMPANIES_PATH = "/v1/companies" as const;
