import { z } from "zod";

import {
  createUuidIdSchema,
  type InvestorDeploymentState,
  type InvestorOrganisationDto,
  type InvestorRepresentativeDto,
  type InvestorType,
  type InvestorVerificationState,
  type UtcTimestamp,
} from "@capital-q/contracts";
import type {
  MembershipId,
  OrganisationId,
  TenantId,
  UserId,
} from "@capital-q/security";

/**
 * @capital-q/investors/contracts
 *
 * The safe public surface of the Investor bounded context: the canonical
 * identifiers, the domain entities and the narrow identity later domains
 * (mandate, discovery, relationships, Q tools) anchor to. No persistence,
 * no use cases. Browser-reachable consumers take the wire DTOs from
 * @capital-q/contracts; server domains take these.
 *
 *   Person ≠ Organisation ≠ Membership ≠ InvestorOrganisation
 *   ≠ InvestorRepresentative ≠ Fund ≠ Mandate ≠ Authority
 */

/**
 * The canonical Investor Organisation identifier. Distinct by construction
 * from OrganisationId (the institution it profiles), TenantId and UserId.
 * The linkage to the organisation is an explicit column, never an alias.
 */
export const InvestorOrganisationIdSchema = createUuidIdSchema(
  "InvestorOrganisationId",
);
export type InvestorOrganisationId = z.infer<
  typeof InvestorOrganisationIdSchema
>;

/** The representative relationship's own identifier. Never a UserId or MembershipId. */
export const InvestorRepresentativeIdSchema = createUuidIdSchema(
  "InvestorRepresentativeId",
);
export type InvestorRepresentativeId = z.infer<
  typeof InvestorRepresentativeIdSchema
>;

/**
 * The canonical Investor Organisation as the domain sees it. Investing
 * profile and deployment state only: no mandate, fund, behaviour, inference,
 * GateQ state or score.
 */
export type InvestorOrganisation = {
  readonly id: InvestorOrganisationId;
  readonly tenantId: TenantId;
  readonly organisationId: OrganisationId;
  readonly investorType: InvestorType;
  readonly displayName: string;
  readonly websiteUrl: string | null;
  readonly hqCountry: string | null;
  readonly publicDescription: string | null;
  readonly verificationState: InvestorVerificationState;
  /** `null` is unknown (not yet answered); never paused, never active. */
  readonly deploymentState: InvestorDeploymentState | null;
  readonly version: number;
  readonly createdAt: UtcTimestamp;
  readonly updatedAt: UtcTimestamp;
};

/**
 * What a later domain needs to validate a reference to an investor
 * organisation. Enough to anchor, not enough to edit; permission-neutral.
 */
export type InvestorOrganisationIdentity = {
  readonly id: InvestorOrganisationId;
  readonly tenantId: TenantId;
  readonly organisationId: OrganisationId;
  readonly investorType: InvestorType;
  readonly displayName: string;
  readonly deploymentState: InvestorDeploymentState | null;
};

/**
 * A period during which a Person represents an Investor Organisation, in
 * the capacity of a real organisation membership. Attribution and
 * presentation only; it establishes no authority and no continuing access.
 */
export type InvestorRepresentative = {
  readonly id: InvestorRepresentativeId;
  readonly tenantId: TenantId;
  readonly investorOrganisationId: InvestorOrganisationId;
  readonly organisationId: OrganisationId;
  readonly userId: UserId;
  readonly membershipId: MembershipId;
  readonly businessTitle: string | null;
  readonly isCurrent: boolean;
  readonly startedAt: UtcTimestamp;
  readonly endedAt: UtcTimestamp | null;
  readonly version: number;
  readonly createdAt: UtcTimestamp;
  readonly updatedAt: UtcTimestamp;
};

/** Wire shape. Tenant and organisation stay internal; verification is read-only. */
export function toInvestorOrganisationDto(
  investor: InvestorOrganisation,
): InvestorOrganisationDto {
  return {
    id: investor.id,
    investorType: investor.investorType,
    displayName: investor.displayName,
    websiteUrl: investor.websiteUrl,
    hqCountry: investor.hqCountry,
    publicDescription: investor.publicDescription,
    deploymentState: investor.deploymentState,
    verificationState: investor.verificationState,
    version: investor.version,
    createdAt: investor.createdAt,
    updatedAt: investor.updatedAt,
  };
}

export function toInvestorOrganisationIdentity(
  investor: InvestorOrganisation,
): InvestorOrganisationIdentity {
  return {
    id: investor.id,
    tenantId: investor.tenantId,
    organisationId: investor.organisationId,
    investorType: investor.investorType,
    displayName: investor.displayName,
    deploymentState: investor.deploymentState,
  };
}

/** No tenant, organisation, membership, roles, capabilities or person PII. */
export function toInvestorRepresentativeDto(
  representative: InvestorRepresentative,
): InvestorRepresentativeDto {
  return {
    id: representative.id,
    investorOrganisationId: representative.investorOrganisationId,
    businessTitle: representative.businessTitle,
    isCurrent: representative.isCurrent,
    version: representative.version,
    createdAt: representative.createdAt,
    updatedAt: representative.updatedAt,
  };
}
