import { z } from "zod";

import { UuidSchema } from "../common/ids.js";
import {
  createCursorPageSchema,
  CursorSchema,
  PageSizeSchema,
} from "../common/pagination.js";
import { UtcTimestampSchema } from "../common/time.js";
import { ResourceVersionSchema } from "../common/version.js";

/**
 * `/v1/organisations` -- the organisation workspace contract.
 *
 * An organisation is the institutional capacity a person acts in. It is not
 * a company, not an investor organisation and not a tenant, although V1
 * creates one tenant per new organisation; those are separate canonical
 * records with their own contracts.
 *
 * Every request schema is strict. Fields that would name authority --
 * tenantId, membershipId, roleId, capabilities, isAdmin, verified, status,
 * createdByUserId -- are not merely ignored: their presence fails validation,
 * so a client cannot even attempt to supply them.
 */

export const ORGANISATION_TYPES = [
  "company",
  "investment_firm",
  "accelerator",
  "family_office",
  "syndicate",
  "institution",
  "advisor",
  "other",
] as const;

/**
 * Describes the organisation. Never authority: `investment_firm` does not
 * make a member an investor, `company` does not make one a founder.
 */
export const OrganisationTypeSchema = z.enum(ORGANISATION_TYPES);
export type OrganisationType = z.infer<typeof OrganisationTypeSchema>;

export const ORGANISATION_STATUSES = ["active", "suspended", "closed"] as const;
export const OrganisationStatusSchema = z.enum(ORGANISATION_STATUSES);
export type OrganisationStatus = z.infer<typeof OrganisationStatusSchema>;

export const MEMBERSHIP_STATUSES = ["active", "left", "revoked"] as const;
export const MembershipStatusSchema = z.enum(MEMBERSHIP_STATUSES);
export type MembershipStatus = z.infer<typeof MembershipStatusSchema>;

const DisplayNameSchema = z.string().trim().min(1).max(200);
const LegalNameSchema = z.string().trim().min(1).max(200);
const WebsiteUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .url()
  .refine((value) => /^https?:\/\//i.test(value), {
    message: "expected an http(s) URL",
  });
const CountryCodeSchema = z
  .string()
  .regex(/^[A-Z]{2}$/, "expected an ISO 3166-1 alpha-2 country code");
const JurisdictionCodeSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{1,64}$/, "expected a short jurisdiction code");

export const CreateOrganisationRequestSchema = z
  .object({
    displayName: DisplayNameSchema,
    organisationType: OrganisationTypeSchema,
    legalName: LegalNameSchema.optional(),
    websiteUrl: WebsiteUrlSchema.optional(),
    countryCode: CountryCodeSchema.optional(),
    jurisdictionCode: JurisdictionCodeSchema.optional(),
  })
  .strict();

export type CreateOrganisationRequest = z.infer<
  typeof CreateOrganisationRequestSchema
>;

/** The profile fields an administrator may change in V1. Type and status are not among them. */
export const ORGANISATION_EDITABLE_FIELDS = [
  "displayName",
  "legalName",
  "websiteUrl",
  "countryCode",
  "jurisdictionCode",
] as const;

export type OrganisationEditableField =
  (typeof ORGANISATION_EDITABLE_FIELDS)[number];

/**
 * `null` clears an optional field; an absent field is left untouched.
 * `expectedVersion` is the version the client read; a stale value is
 * refused rather than overwriting a newer profile.
 */
export const UpdateOrganisationRequestSchema = z
  .object({
    expectedVersion: ResourceVersionSchema,
    displayName: DisplayNameSchema.optional(),
    legalName: LegalNameSchema.nullable().optional(),
    websiteUrl: WebsiteUrlSchema.nullable().optional(),
    countryCode: CountryCodeSchema.nullable().optional(),
    jurisdictionCode: JurisdictionCodeSchema.nullable().optional(),
  })
  .strict()
  .refine(
    (value) =>
      ORGANISATION_EDITABLE_FIELDS.some((field) => value[field] !== undefined),
    { message: "expected at least one field to update" },
  );

export type UpdateOrganisationRequest = z.infer<
  typeof UpdateOrganisationRequestSchema
>;

export const OrganisationDtoSchema = z.object({
  id: UuidSchema,
  displayName: z.string(),
  legalName: z.string().nullable(),
  organisationType: OrganisationTypeSchema,
  websiteUrl: z.string().nullable(),
  countryCode: z.string().nullable(),
  jurisdictionCode: z.string().nullable(),
  status: OrganisationStatusSchema,
  version: ResourceVersionSchema,
  createdAt: UtcTimestampSchema,
  updatedAt: UtcTimestampSchema,
});

export type OrganisationDto = z.infer<typeof OrganisationDtoSchema>;

/**
 * The caller's own membership in an organisation. Role codes are reference
 * labels for presentation; sending them back grants nothing.
 */
export const MembershipSummarySchema = z.object({
  id: UuidSchema,
  status: MembershipStatusSchema,
  joinedAt: UtcTimestampSchema,
  roleCodes: z.array(z.string()),
  isActiveContext: z.boolean(),
});

export type MembershipSummary = z.infer<typeof MembershipSummarySchema>;

export const OrganisationMembershipSummarySchema = z.object({
  organisation: OrganisationDtoSchema,
  membership: MembershipSummarySchema,
});

export type OrganisationMembershipSummary = z.infer<
  typeof OrganisationMembershipSummarySchema
>;

export const CreateOrganisationResponseSchema =
  OrganisationMembershipSummarySchema;
export const ActivateOrganisationResponseSchema =
  OrganisationMembershipSummarySchema;

export const ListMyOrganisationsResponseSchema = createCursorPageSchema(
  OrganisationMembershipSummarySchema,
);

export type ListMyOrganisationsResponse = z.infer<
  typeof ListMyOrganisationsResponseSchema
>;

/** Query-string form of the cursor page request (values arrive as strings). */
export const ListMyOrganisationsQuerySchema = z
  .object({
    cursor: CursorSchema.optional(),
    limit: z.preprocess(
      (value) =>
        value === undefined || value === "" ? undefined : Number(value),
      PageSizeSchema.optional(),
    ),
  })
  .strict();

export type ListMyOrganisationsQuery = z.infer<
  typeof ListMyOrganisationsQuerySchema
>;

export const ORGANISATIONS_PATH = "/v1/organisations" as const;

/**
 * Consequential POSTs carry a client-generated key so a retried request
 * cannot create a second workspace. Bounded printable ASCII; the server
 * stores only a hash of it.
 */
export const IDEMPOTENCY_KEY_HEADER = "idempotency-key" as const;
export const IdempotencyKeyHeaderSchema = z
  .string()
  .min(8, "expected an Idempotency-Key of at least 8 characters")
  .max(255)
  .regex(/^[\x21-\x7e]+$/, "expected printable ASCII without spaces");
