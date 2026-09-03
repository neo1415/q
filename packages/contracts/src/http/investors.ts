import { z } from "zod";

import { CountryCodeSchema } from "../common/geography.js";
import { UuidSchema } from "../common/ids.js";
import { UtcTimestampSchema } from "../common/time.js";
import { ResourceVersionSchema } from "../common/version.js";

/**
 * `/v1/investors` -- the canonical Investor Organisation contract.
 *
 * "Investor" on this path is the canonical InvestorOrganisation resource:
 * the one investing identity of an organisation (fund, family office,
 * syndicate, or a solo angel's own investing workspace). It is not the
 * organisation itself, not a person, not a mandate, not a fund vehicle and
 * not GateQ state.
 *
 * Strict request schemas: identity and authority fields (id, tenantId,
 * organisationId, userId, membershipId, verificationState, roles,
 * capabilities, isVerified, isAdmin) and every mandate field (cheque,
 * sector, stage, geography, exclusions, discovery mode, inbound mode) fail
 * validation. Those belong to later packets or to nobody.
 */

/** Bounded V1 vocabulary. Describes the capital provider; never grants. */
export const INVESTOR_TYPES = [
  "ANGEL",
  "VC",
  "FAMILY_OFFICE",
  "CVC",
  "SYNDICATE",
  "ACCELERATOR",
  "SCOUT",
  "INSTITUTIONAL",
  "OTHER",
] as const;
export const InvestorTypeSchema = z.enum(INVESTOR_TYPES);
export type InvestorType = z.infer<typeof InvestorTypeSchema>;

/**
 * Availability to deploy capital (investor onboarding I1). `null` on the
 * wire means "not yet answered" and is never read as paused or active.
 * Not a mandate status, not GateQ, not a reputation signal.
 */
export const INVESTOR_DEPLOYMENT_STATES = [
  "ACTIVELY_INVESTING",
  "SELECTIVE",
  "PAUSED",
  "EXPLORING_ONLY",
] as const;
export const InvestorDeploymentStateSchema = z.enum(INVESTOR_DEPLOYMENT_STATES);
export type InvestorDeploymentState = z.infer<
  typeof InvestorDeploymentStateSchema
>;

/**
 * Coarse identity-verification presentation state. Only `unverified` is
 * written today; the verification subsystem owns the vocabulary and the
 * transitions. Read-only on this contract and never a trust score.
 */
export const InvestorVerificationStateSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]*$/)
  .max(64);
export type InvestorVerificationState = z.infer<
  typeof InvestorVerificationStateSchema
>;
export const INVESTOR_VERIFICATION_UNVERIFIED = "unverified" as const;

export const INVESTOR_DISPLAY_NAME_MAX_LENGTH = 200;
export const INVESTOR_PUBLIC_DESCRIPTION_MAX_LENGTH = 4000;
export const INVESTOR_BUSINESS_TITLE_MAX_LENGTH = 120;

const DisplayNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(INVESTOR_DISPLAY_NAME_MAX_LENGTH);
const WebsiteUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .url()
  .refine((value) => /^https?:\/\//i.test(value), {
    message: "expected an http(s) URL",
  });
const PublicDescriptionSchema = z
  .string()
  .trim()
  .min(1)
  .max(INVESTOR_PUBLIC_DESCRIPTION_MAX_LENGTH);
const BusinessTitleSchema = z
  .string()
  .trim()
  .min(1)
  .max(INVESTOR_BUSINESS_TITLE_MAX_LENGTH);

export const CreateInvestorOrganisationRequestSchema = z
  .object({
    investorType: InvestorTypeSchema,
    displayName: DisplayNameSchema.optional(),
    websiteUrl: WebsiteUrlSchema.optional(),
    hqCountry: CountryCodeSchema.optional(),
    publicDescription: PublicDescriptionSchema.optional(),
    deploymentState: InvestorDeploymentStateSchema.optional(),
  })
  .strict();

export type CreateInvestorOrganisationRequest = z.infer<
  typeof CreateInvestorOrganisationRequestSchema
>;

/** The fields an editor may change. Verification state is not among them. */
export const INVESTOR_EDITABLE_FIELDS = [
  "investorType",
  "displayName",
  "websiteUrl",
  "hqCountry",
  "publicDescription",
  "deploymentState",
] as const;

export type InvestorEditableField = (typeof INVESTOR_EDITABLE_FIELDS)[number];

export const UpdateInvestorOrganisationRequestSchema = z
  .object({
    expectedVersion: ResourceVersionSchema,
    investorType: InvestorTypeSchema.optional(),
    displayName: DisplayNameSchema.optional(),
    websiteUrl: WebsiteUrlSchema.nullable().optional(),
    hqCountry: CountryCodeSchema.nullable().optional(),
    publicDescription: PublicDescriptionSchema.nullable().optional(),
    /** `null` returns the answer to unknown; it does not mean paused. */
    deploymentState: InvestorDeploymentStateSchema.nullable().optional(),
  })
  .strict()
  .refine(
    (value) =>
      INVESTOR_EDITABLE_FIELDS.some((field) => value[field] !== undefined),
    { message: "expected at least one field to update" },
  );

export type UpdateInvestorOrganisationRequest = z.infer<
  typeof UpdateInvestorOrganisationRequestSchema
>;

/**
 * The organisation-internal investor profile. Verification state is
 * reported read-only; tenant, organisation and membership stay internal.
 */
export const InvestorOrganisationDtoSchema = z.object({
  id: UuidSchema,
  investorType: InvestorTypeSchema,
  displayName: z.string(),
  websiteUrl: z.string().nullable(),
  hqCountry: z.string().nullable(),
  publicDescription: z.string().nullable(),
  deploymentState: InvestorDeploymentStateSchema.nullable(),
  verificationState: InvestorVerificationStateSchema,
  version: ResourceVersionSchema,
  createdAt: UtcTimestampSchema,
  updatedAt: UtcTimestampSchema,
});

export type InvestorOrganisationDto = z.infer<
  typeof InvestorOrganisationDtoSchema
>;

/**
 * Desired state of the caller's own representation of the investor
 * organisation. Idempotent PUT. There is no userId or membershipId: both
 * come from the server-resolved actor context. `isCurrent` is not
 * exposed; ending a representation is not a casual self-service action yet.
 */
export const UpsertMyInvestorRepresentativeRequestSchema = z
  .object({
    businessTitle: BusinessTitleSchema.nullable().optional(),
  })
  .strict();

export type UpsertMyInvestorRepresentativeRequest = z.infer<
  typeof UpsertMyInvestorRepresentativeRequestSchema
>;

/** No tenant, membership, roles, capabilities or person PII. */
export const InvestorRepresentativeDtoSchema = z.object({
  id: UuidSchema,
  investorOrganisationId: UuidSchema,
  businessTitle: z.string().nullable(),
  isCurrent: z.boolean(),
  version: ResourceVersionSchema,
  createdAt: UtcTimestampSchema,
  updatedAt: UtcTimestampSchema,
});

export type InvestorRepresentativeDto = z.infer<
  typeof InvestorRepresentativeDtoSchema
>;

export const INVESTORS_PATH = "/v1/investors" as const;
/** The investor organisation attached to the caller's active organisation. */
export const INVESTORS_CURRENT_PATH = "/v1/investors/current" as const;
export const INVESTOR_REPRESENTATIVE_ME_SUFFIX = "/representatives/me" as const;
