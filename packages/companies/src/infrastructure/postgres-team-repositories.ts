import { z } from "zod";

import {
  CompanyRelationshipTypeSchema,
  MarketplaceVisibilitySchema,
  UtcTimestampSchema,
} from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";
import { TenantIdSchema, UserIdSchema } from "@capital-q/security";

import { CompanyIdSchema } from "../contracts/index.js";
import {
  CompanyMemberIdSchema,
  FounderProfileIdSchema,
  type CompanyMember,
  type CompanyTeamFacts,
  type FounderProfile,
} from "../contracts/team.js";
import type {
  CompanyMemberChanges,
  CompanyMemberRepository,
  CompanyTeamFactsRepository,
  FounderProfileChanges,
  FounderProfileRepository,
} from "../application/team-ports.js";

/**
 * PostgreSQL adapters for the founder / team ports. Parameterised SQL on the
 * caller's executor or transaction; every statement carries the tenant.
 */

const Timestamp = z
  .union([z.date(), z.string()])
  .transform((value) =>
    UtcTimestampSchema.parse(
      value instanceof Date
        ? value.toISOString()
        : new Date(value).toISOString(),
    ),
  );

const MemberRow = z.object({
  id: CompanyMemberIdSchema,
  tenant_id: TenantIdSchema,
  company_id: CompanyIdSchema,
  user_id: UserIdSchema,
  relationship_type: CompanyRelationshipTypeSchema,
  business_title: z.string().nullable(),
  is_founder: z.boolean(),
  is_current: z.boolean(),
  started_at: Timestamp,
  ended_at: Timestamp.nullable(),
  version: z.number().int().min(1),
});

function toMember(row: unknown): CompanyMember {
  const r = MemberRow.parse(row);
  return {
    id: r.id,
    tenantId: r.tenant_id,
    companyId: r.company_id,
    userId: r.user_id,
    relationshipType: r.relationship_type,
    businessTitle: r.business_title,
    isFounder: r.is_founder,
    isCurrent: r.is_current,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    version: r.version,
  };
}

function memberSelect(executor: DatabaseExecutor) {
  return executor`
    select m.id, m.tenant_id, m.company_id, m.user_id, m.relationship_type, m.business_title,
           m.is_founder, m.is_current, m.started_at, m.ended_at, m.version
      from core.company_members m`;
}

function memberColumns(changes: CompanyMemberChanges) {
  const columns: Record<string, string | boolean | null> = {};
  if (changes.relationshipType !== undefined) {
    columns["relationship_type"] = changes.relationshipType;
  }
  if (changes.businessTitle !== undefined) {
    columns["business_title"] = changes.businessTitle;
  }
  if (changes.isFounder !== undefined) {
    columns["is_founder"] = changes.isFounder;
  }
  return columns;
}

export function createPostgresCompanyMemberRepository(): CompanyMemberRepository {
  return {
    findCurrentForUser: async (executor, tenantId, companyId, userId) => {
      const rows = await executor`
        ${memberSelect(executor)}
         where m.tenant_id = ${tenantId} and m.company_id = ${companyId}
           and m.user_id = ${userId} and m.is_current`;
      return rows.length === 0 ? null : toMember(rows[0]);
    },
    lockCurrentForUser: async (tx, tenantId, companyId, userId) => {
      const rows = await tx.sql`
        ${memberSelect(tx.sql)}
         where m.tenant_id = ${tenantId} and m.company_id = ${companyId}
           and m.user_id = ${userId} and m.is_current
         for update`;
      return rows.length === 0 ? null : toMember(rows[0]);
    },
    create: async (tx, input) => {
      const rows = await tx.sql`
        insert into core.company_members
          (tenant_id, company_id, user_id, relationship_type, business_title, is_founder)
        values (${input.tenantId}, ${input.companyId}, ${input.userId},
                ${input.relationshipType}, ${input.businessTitle}, ${input.isFounder})
        returning id, tenant_id, company_id, user_id, relationship_type, business_title,
                  is_founder, is_current, started_at, ended_at, version`;
      return toMember(rows[0]);
    },
    updateCurrent: async (tx, input) => {
      const rows = await tx.sql`
        update core.company_members m
           set ${tx.sql(memberColumns(input.changes))},
               version = m.version + 1
         where m.id = ${input.companyMemberId}
           and m.tenant_id = ${input.tenantId}
           and m.is_current
           and m.version = ${input.expectedVersion}
        returning m.id, m.tenant_id, m.company_id, m.user_id, m.relationship_type, m.business_title,
                  m.is_founder, m.is_current, m.started_at, m.ended_at, m.version`;
      return rows.length === 0 ? null : toMember(rows[0]);
    },
  };
}

const ProfileRow = z.object({
  id: FounderProfileIdSchema,
  tenant_id: TenantIdSchema,
  user_id: UserIdSchema,
  primary_company_id: CompanyIdSchema.nullable(),
  professional_summary: z.string().nullable(),
  background_summary: z.string().nullable(),
  visibility_scope: MarketplaceVisibilitySchema,
  version: z.number().int().min(1),
  created_at: Timestamp,
  updated_at: Timestamp,
});

function toProfile(row: unknown): FounderProfile {
  const r = ProfileRow.parse(row);
  return {
    id: r.id,
    tenantId: r.tenant_id,
    userId: r.user_id,
    primaryCompanyId: r.primary_company_id,
    professionalSummary: r.professional_summary,
    backgroundSummary: r.background_summary,
    visibilityScope: r.visibility_scope,
    version: r.version,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function profileSelect(executor: DatabaseExecutor) {
  return executor`
    select p.id, p.tenant_id, p.user_id, p.primary_company_id, p.professional_summary,
           p.background_summary, p.visibility_scope, p.version, p.created_at, p.updated_at
      from core.founder_profiles p`;
}

function profileColumns(changes: FounderProfileChanges) {
  const columns: Record<string, string | null> = {};
  if (changes.professionalSummary !== undefined) {
    columns["professional_summary"] = changes.professionalSummary;
  }
  if (changes.backgroundSummary !== undefined) {
    columns["background_summary"] = changes.backgroundSummary;
  }
  return columns;
}

export function createPostgresFounderProfileRepository(): FounderProfileRepository {
  return {
    findForUser: async (executor, tenantId, userId) => {
      const rows = await executor`
        ${profileSelect(executor)}
         where p.tenant_id = ${tenantId} and p.user_id = ${userId}`;
      return rows.length === 0 ? null : toProfile(rows[0]);
    },
    lockForUser: async (tx, tenantId, userId) => {
      const rows = await tx.sql`
        ${profileSelect(tx.sql)}
         where p.tenant_id = ${tenantId} and p.user_id = ${userId}
         for update`;
      return rows.length === 0 ? null : toProfile(rows[0]);
    },
    create: async (tx, input) => {
      // visibility_scope is left to its default (founder_private): no write
      // path in this packet sets it.
      const rows = await tx.sql`
        insert into core.founder_profiles
          (tenant_id, user_id, primary_company_id, professional_summary, background_summary)
        values (${input.tenantId}, ${input.userId}, ${input.primaryCompanyId},
                ${input.professionalSummary}, ${input.backgroundSummary})
        returning id, tenant_id, user_id, primary_company_id, professional_summary,
                  background_summary, visibility_scope, version, created_at, updated_at`;
      return toProfile(rows[0]);
    },
    update: async (tx, input) => {
      const rows = await tx.sql`
        update core.founder_profiles p
           set ${tx.sql(profileColumns(input.changes))},
               version = p.version + 1
         where p.tenant_id = ${input.tenantId}
           and p.user_id = ${input.userId}
           and p.version = ${input.expectedVersion}
        returning p.id, p.tenant_id, p.user_id, p.primary_company_id, p.professional_summary,
                  p.background_summary, p.visibility_scope, p.version, p.created_at, p.updated_at`;
      return rows.length === 0 ? null : toProfile(rows[0]);
    },
  };
}

const FactsRow = z.object({
  tenant_id: TenantIdSchema,
  company_id: CompanyIdSchema,
  founder_count: z.number().int().nullable(),
  full_time_founder_count: z.number().int().nullable(),
  team_size: z.number().int().nullable(),
  version: z.number().int().min(1),
  updated_at: Timestamp,
});

function toFacts(row: unknown): CompanyTeamFacts {
  const r = FactsRow.parse(row);
  return {
    tenantId: r.tenant_id,
    companyId: r.company_id,
    founderCount: r.founder_count,
    fullTimeFounderCount: r.full_time_founder_count,
    teamSize: r.team_size,
    version: r.version,
    updatedAt: r.updated_at,
  };
}

function factsSelect(executor: DatabaseExecutor) {
  return executor`
    select f.tenant_id, f.company_id, f.founder_count, f.full_time_founder_count,
           f.team_size, f.version, f.updated_at
      from core.company_team_facts f`;
}

export function createPostgresCompanyTeamFactsRepository(): CompanyTeamFactsRepository {
  return {
    findForCompany: async (executor, tenantId, companyId) => {
      const rows = await executor`
        ${factsSelect(executor)}
         where f.tenant_id = ${tenantId} and f.company_id = ${companyId}`;
      return rows.length === 0 ? null : toFacts(rows[0]);
    },
    lockForCompany: async (tx, tenantId, companyId) => {
      const rows = await tx.sql`
        ${factsSelect(tx.sql)}
         where f.tenant_id = ${tenantId} and f.company_id = ${companyId}
         for update`;
      return rows.length === 0 ? null : toFacts(rows[0]);
    },
    create: async (tx, tenantId, companyId, values) => {
      const rows = await tx.sql`
        insert into core.company_team_facts
          (tenant_id, company_id, founder_count, full_time_founder_count, team_size)
        values (${tenantId}, ${companyId}, ${values.founderCount},
                ${values.fullTimeFounderCount}, ${values.teamSize})
        returning tenant_id, company_id, founder_count, full_time_founder_count,
                  team_size, version, updated_at`;
      return toFacts(rows[0]);
    },
    update: async (tx, tenantId, companyId, expectedVersion, values) => {
      const rows = await tx.sql`
        update core.company_team_facts f
           set founder_count = ${values.founderCount},
               full_time_founder_count = ${values.fullTimeFounderCount},
               team_size = ${values.teamSize},
               version = f.version + 1
         where f.tenant_id = ${tenantId}
           and f.company_id = ${companyId}
           and f.version = ${expectedVersion}
        returning f.tenant_id, f.company_id, f.founder_count, f.full_time_founder_count,
                  f.team_size, f.version, f.updated_at`;
      return rows.length === 0 ? null : toFacts(rows[0]);
    },
  };
}
