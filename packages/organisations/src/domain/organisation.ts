import type {
  MembershipStatus,
  OrganisationDto,
  OrganisationStatus,
  OrganisationType,
  UtcTimestamp,
} from "@capital-q/contracts";
import type {
  MembershipId,
  OrganisationId,
  TenantId,
  UserId,
} from "@capital-q/security";

/**
 * The organisation aggregate as the domain sees it.
 *
 * Person ≠ Organisation ≠ Membership ≠ Tenant. An organisation carries its
 * tenant (the isolation boundary it lives in) but is never the tenant; a
 * membership links a person to an organisation and carries no authority of
 * its own -- roles and capabilities are resolved separately.
 *
 * `organisationType` describes; it never grants. `status` is lifecycle and
 * is not a normal update field. `version` is the optimistic-concurrency
 * counter for the profile.
 */
export type Organisation = {
  readonly id: OrganisationId;
  readonly tenantId: TenantId;
  readonly organisationType: OrganisationType;
  readonly displayName: string;
  readonly legalName: string | null;
  readonly slug: string;
  readonly websiteUrl: string | null;
  readonly countryCode: string | null;
  readonly jurisdictionCode: string | null;
  readonly status: OrganisationStatus;
  readonly version: number;
  readonly createdAt: UtcTimestamp;
  readonly updatedAt: UtcTimestamp;
};

export type Membership = {
  readonly id: MembershipId;
  readonly tenantId: TenantId;
  readonly organisationId: OrganisationId;
  readonly userId: UserId;
  readonly status: MembershipStatus;
  readonly joinedAt: UtcTimestamp;
};

/** One organisation as seen from the caller's own membership. */
export type MembershipView = {
  readonly organisation: Organisation;
  readonly membership: Membership;
  /** Currently valid role template codes. Reference labels, not authority. */
  readonly roleCodes: readonly string[];
  readonly isActiveContext: boolean;
};

/**
 * The narrow identity a later domain (Company, Investor Organisation) needs
 * to anchor itself to an organisation. Enough to validate a reference, not
 * enough to administer anything.
 */
export type OrganisationIdentity = {
  readonly id: OrganisationId;
  readonly tenantId: TenantId;
  readonly organisationType: OrganisationType;
  readonly displayName: string;
  /** Ordinary profile context a dependant may default from; not domain-control proof. */
  readonly websiteUrl: string | null;
  readonly countryCode: string | null;
  readonly status: OrganisationStatus;
};

/** The wire shape. Tenant and slug stay internal; ids are the contract. */
export function toOrganisationDto(organisation: Organisation): OrganisationDto {
  return {
    id: organisation.id,
    displayName: organisation.displayName,
    legalName: organisation.legalName,
    organisationType: organisation.organisationType,
    websiteUrl: organisation.websiteUrl,
    countryCode: organisation.countryCode,
    jurisdictionCode: organisation.jurisdictionCode,
    status: organisation.status,
    version: organisation.version,
    createdAt: organisation.createdAt,
    updatedAt: organisation.updatedAt,
  };
}

export function toOrganisationIdentity(
  organisation: Organisation,
): OrganisationIdentity {
  return {
    id: organisation.id,
    tenantId: organisation.tenantId,
    organisationType: organisation.organisationType,
    displayName: organisation.displayName,
    websiteUrl: organisation.websiteUrl,
    countryCode: organisation.countryCode,
    status: organisation.status,
  };
}
