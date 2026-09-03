import { z } from "zod";

import {
  createUuidIdSchema,
  type CompanyMemberDto,
  type CompanyRelationshipType,
  type CompanyTeamFactsDto,
  type FounderProfileDto,
  type MarketplaceVisibility,
  type UtcTimestamp,
} from "@capital-q/contracts";
import type { TenantId, UserId } from "@capital-q/security";

import type { CompanyId } from "./index.js";

/**
 * Founder / team contracts of the Company bounded context. Three distinct
 * facts about a Person and a Company, none of which is account identity,
 * organisation membership, authority or verification.
 */

export const CompanyMemberIdSchema = createUuidIdSchema("CompanyMemberId");
export type CompanyMemberId = z.infer<typeof CompanyMemberIdSchema>;

export const FounderProfileIdSchema = createUuidIdSchema("FounderProfileId");
export type FounderProfileId = z.infer<typeof FounderProfileIdSchema>;

/** A period of relationship between a Person and a Company. */
export type CompanyMember = {
  readonly id: CompanyMemberId;
  readonly tenantId: TenantId;
  readonly companyId: CompanyId;
  readonly userId: UserId;
  readonly relationshipType: CompanyRelationshipType;
  readonly businessTitle: string | null;
  readonly isFounder: boolean;
  readonly isCurrent: boolean;
  readonly startedAt: UtcTimestamp;
  readonly endedAt: UtcTimestamp | null;
  readonly version: number;
};

/** Person-owned. One per tenant + person; `primaryCompanyId` is an anchor, not ownership. */
export type FounderProfile = {
  readonly id: FounderProfileId;
  readonly tenantId: TenantId;
  readonly userId: UserId;
  readonly primaryCompanyId: CompanyId | null;
  readonly professionalSummary: string | null;
  readonly backgroundSummary: string | null;
  readonly visibilityScope: MarketplaceVisibility;
  readonly version: number;
  readonly createdAt: UtcTimestamp;
  readonly updatedAt: UtcTimestamp;
};

/** Self-reported aggregate composition. `null` is unknown, never zero. */
export type CompanyTeamFacts = {
  readonly tenantId: TenantId;
  readonly companyId: CompanyId;
  readonly founderCount: number | null;
  readonly fullTimeFounderCount: number | null;
  readonly teamSize: number | null;
  readonly version: number;
  readonly updatedAt: UtcTimestamp;
};

export function toCompanyMemberDto(member: CompanyMember): CompanyMemberDto {
  return {
    id: member.id,
    companyId: member.companyId,
    relationshipType: member.relationshipType,
    businessTitle: member.businessTitle,
    isFounder: member.isFounder,
    isCurrent: member.isCurrent,
    startedAt: member.startedAt,
    endedAt: member.endedAt,
    version: member.version,
  };
}

/** Visibility scope is classification metadata and stays server-side for now. */
export function toFounderProfileDto(
  profile: FounderProfile,
): FounderProfileDto {
  return {
    id: profile.id,
    primaryCompanyId: profile.primaryCompanyId,
    professionalSummary: profile.professionalSummary,
    backgroundSummary: profile.backgroundSummary,
    version: profile.version,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}

export function toCompanyTeamFactsDto(
  facts: CompanyTeamFacts,
): CompanyTeamFactsDto {
  return {
    companyId: facts.companyId,
    founderCount: facts.founderCount,
    fullTimeFounderCount: facts.fullTimeFounderCount,
    teamSize: facts.teamSize,
    version: facts.version,
    updatedAt: facts.updatedAt,
  };
}
