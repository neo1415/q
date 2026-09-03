import { z } from "zod";

import {
  MembershipStatusSchema,
  OrganisationStatusSchema,
  OrganisationTypeSchema,
  UtcTimestampSchema,
} from "@capital-q/contracts";
import {
  MembershipIdSchema,
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
} from "@capital-q/security";

import type { Membership, Organisation } from "../domain/organisation.js";

/**
 * Row schemas. Every value read from the database is validated before it
 * becomes a domain object; a row that does not match is an integrity
 * failure, never a partially trusted entity.
 */

/**
 * Dates from the driver carry millisecond precision; text produced by the
 * query (see the list projection) keeps PostgreSQL's microseconds and is
 * kept verbatim so a cursor built from it compares exactly. Any other
 * textual form (jsonb timestamps with an offset) is normalised to UTC.
 */
const TimestampSchema = z.union([z.date(), z.string()]).transform((value) => {
  if (value instanceof Date) {
    return UtcTimestampSchema.parse(value.toISOString());
  }
  const exact = UtcTimestampSchema.safeParse(value);
  return exact.success
    ? exact.data
    : UtcTimestampSchema.parse(new Date(value).toISOString());
});

export const OrganisationRowSchema = z.object({
  id: OrganisationIdSchema,
  tenant_id: TenantIdSchema,
  organisation_type: OrganisationTypeSchema,
  legal_name: z.string().nullable(),
  display_name: z.string(),
  slug: z.string(),
  website_url: z.string().nullable(),
  country_code: z.string().nullable(),
  jurisdiction_code: z.string().nullable(),
  status: OrganisationStatusSchema,
  version: z.number().int().min(1),
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
});

export function toOrganisation(row: unknown): Organisation {
  const parsed = OrganisationRowSchema.parse(row);
  return {
    id: parsed.id,
    tenantId: parsed.tenant_id,
    organisationType: parsed.organisation_type,
    displayName: parsed.display_name,
    legalName: parsed.legal_name,
    slug: parsed.slug,
    websiteUrl: parsed.website_url,
    countryCode: parsed.country_code,
    jurisdictionCode: parsed.jurisdiction_code,
    status: parsed.status,
    version: parsed.version,
    createdAt: parsed.created_at,
    updatedAt: parsed.updated_at,
  };
}

export const MembershipRowSchema = z.object({
  id: MembershipIdSchema,
  tenant_id: TenantIdSchema,
  organisation_id: OrganisationIdSchema,
  user_id: UserIdSchema,
  membership_status: MembershipStatusSchema,
  joined_at: TimestampSchema,
});

export function toMembership(row: unknown): Membership {
  const parsed = MembershipRowSchema.parse(row);
  return {
    id: parsed.id,
    tenantId: parsed.tenant_id,
    organisationId: parsed.organisation_id,
    userId: parsed.user_id,
    status: parsed.membership_status,
    joinedAt: parsed.joined_at,
  };
}

/** The joined shape the membership list query returns. */
export const MembershipViewRowSchema = z.object({
  membership_id: MembershipIdSchema,
  membership_tenant_id: TenantIdSchema,
  membership_organisation_id: OrganisationIdSchema,
  membership_user_id: UserIdSchema,
  membership_status: MembershipStatusSchema,
  joined_at: TimestampSchema,
  role_codes: z.array(z.string()),
  is_active_context: z.boolean(),
  organisation: OrganisationRowSchema,
});
