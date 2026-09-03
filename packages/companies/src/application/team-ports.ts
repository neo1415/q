import type { CompanyRelationshipType } from "@capital-q/contracts";
import type { DatabaseExecutor, TransactionContext } from "@capital-q/database";
import type { TenantId, UserId } from "@capital-q/security";

import type { CompanyId } from "../contracts/index.js";
import type {
  CompanyMember,
  CompanyMemberId,
  CompanyTeamFacts,
  FounderProfile,
} from "../contracts/team.js";

/**
 * Persistence ports for the founder / team submodule. Every statement names
 * the tenant and, for company-owned rows, the company; person-owned rows are
 * addressed by tenant and person. No generic repository.
 */

export type CompanyMemberChanges = {
  readonly relationshipType?: CompanyRelationshipType | undefined;
  readonly businessTitle?: string | null | undefined;
  readonly isFounder?: boolean | undefined;
};

export type CompanyMemberRepository = {
  readonly findCurrentForUser: (
    executor: DatabaseExecutor,
    tenantId: TenantId,
    companyId: CompanyId,
    userId: UserId,
  ) => Promise<CompanyMember | null>;
  /** Locks the current row for the rest of the transaction. */
  readonly lockCurrentForUser: (
    tx: TransactionContext,
    tenantId: TenantId,
    companyId: CompanyId,
    userId: UserId,
  ) => Promise<CompanyMember | null>;
  /** A new current period. Historical periods are left untouched. */
  readonly create: (
    tx: TransactionContext,
    input: {
      readonly tenantId: TenantId;
      readonly companyId: CompanyId;
      readonly userId: UserId;
      readonly relationshipType: CompanyRelationshipType;
      readonly businessTitle: string | null;
      readonly isFounder: boolean;
    },
  ) => Promise<CompanyMember>;
  readonly updateCurrent: (
    tx: TransactionContext,
    input: {
      readonly tenantId: TenantId;
      readonly companyMemberId: CompanyMemberId;
      readonly expectedVersion: number;
      readonly changes: CompanyMemberChanges;
    },
  ) => Promise<CompanyMember | null>;
};

export type FounderProfileChanges = {
  readonly professionalSummary?: string | null | undefined;
  readonly backgroundSummary?: string | null | undefined;
};

export type FounderProfileRepository = {
  readonly findForUser: (
    executor: DatabaseExecutor,
    tenantId: TenantId,
    userId: UserId,
  ) => Promise<FounderProfile | null>;
  readonly lockForUser: (
    tx: TransactionContext,
    tenantId: TenantId,
    userId: UserId,
  ) => Promise<FounderProfile | null>;
  readonly create: (
    tx: TransactionContext,
    input: {
      readonly tenantId: TenantId;
      readonly userId: UserId;
      readonly primaryCompanyId: CompanyId;
      readonly professionalSummary: string | null;
      readonly backgroundSummary: string | null;
    },
  ) => Promise<FounderProfile>;
  readonly update: (
    tx: TransactionContext,
    input: {
      readonly tenantId: TenantId;
      readonly userId: UserId;
      readonly expectedVersion: number;
      readonly changes: FounderProfileChanges;
    },
  ) => Promise<FounderProfile | null>;
};

export type CompanyTeamFactsValues = {
  readonly founderCount: number | null;
  readonly fullTimeFounderCount: number | null;
  readonly teamSize: number | null;
};

export type CompanyTeamFactsRepository = {
  readonly findForCompany: (
    executor: DatabaseExecutor,
    tenantId: TenantId,
    companyId: CompanyId,
  ) => Promise<CompanyTeamFacts | null>;
  readonly lockForCompany: (
    tx: TransactionContext,
    tenantId: TenantId,
    companyId: CompanyId,
  ) => Promise<CompanyTeamFacts | null>;
  readonly create: (
    tx: TransactionContext,
    tenantId: TenantId,
    companyId: CompanyId,
    values: CompanyTeamFactsValues,
  ) => Promise<CompanyTeamFacts>;
  readonly update: (
    tx: TransactionContext,
    tenantId: TenantId,
    companyId: CompanyId,
    expectedVersion: number,
    values: CompanyTeamFactsValues,
  ) => Promise<CompanyTeamFacts | null>;
};
