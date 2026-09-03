import { z } from "zod";

import {
  InvestorDeploymentStateSchema,
  InvestorTypeSchema,
  InvestorVerificationStateSchema,
  UtcTimestampSchema,
} from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";
import {
  MembershipIdSchema,
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
} from "@capital-q/security";

import {
  InvestorOrganisationIdSchema,
  InvestorRepresentativeIdSchema,
  type InvestorOrganisation,
  type InvestorOrganisationIdentity,
  type InvestorRepresentative,
} from "../contracts/index.js";
import type {
  InvestorCreationRecord,
  InvestorCreationRequestStore,
  InvestorOrganisationQueryPort,
  InvestorOrganisationRepository,
  InvestorProfileChanges,
  InvestorRepresentativeChanges,
  InvestorRepresentativeRepository,
} from "../application/ports.js";

/**
 * PostgreSQL adapters for the investor ports. Parameterised SQL on the
 * executor or transaction the caller supplies; no pools are opened here.
 * Every statement names the tenant and, where the row is organisation
 * owned, the organisation. This module is never handed to Q.
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

const InvestorRow = z.object({
  id: InvestorOrganisationIdSchema,
  tenant_id: TenantIdSchema,
  organisation_id: OrganisationIdSchema,
  investor_type: InvestorTypeSchema,
  display_name: z.string(),
  website_url: z.string().nullable(),
  hq_country: z.string().nullable(),
  public_description: z.string().nullable(),
  verification_state: InvestorVerificationStateSchema,
  deployment_state: InvestorDeploymentStateSchema.nullable(),
  version: z.number().int().min(1),
  created_at: Timestamp,
  updated_at: Timestamp,
});

function toInvestor(row: unknown): InvestorOrganisation {
  const r = InvestorRow.parse(row);
  return {
    id: r.id,
    tenantId: r.tenant_id,
    organisationId: r.organisation_id,
    investorType: r.investor_type,
    displayName: r.display_name,
    websiteUrl: r.website_url,
    hqCountry: r.hq_country,
    publicDescription: r.public_description,
    verificationState: r.verification_state,
    deploymentState: r.deployment_state,
    version: r.version,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function investorSelect(executor: DatabaseExecutor) {
  return executor`
    select i.id, i.tenant_id, i.organisation_id, i.investor_type, i.display_name,
           i.website_url, i.hq_country, i.public_description, i.verification_state,
           i.deployment_state, i.version, i.created_at, i.updated_at
      from core.investor_organisations i`;
}

const COLUMN_BY_FIELD: Readonly<Record<keyof InvestorProfileChanges, string>> =
  {
    investorType: "investor_type",
    displayName: "display_name",
    websiteUrl: "website_url",
    hqCountry: "hq_country",
    publicDescription: "public_description",
    deploymentState: "deployment_state",
  };

/** Whitelisted column mapping. verification_state is not reachable from here. */
function toColumnChanges(
  changes: InvestorProfileChanges,
): Record<string, string | null> {
  const columns: Record<string, string | null> = {};
  for (const field of Object.keys(
    COLUMN_BY_FIELD,
  ) as (keyof InvestorProfileChanges)[]) {
    const value = changes[field];
    if (value !== undefined) {
      columns[COLUMN_BY_FIELD[field]] = value;
    }
  }
  return columns;
}

export function createPostgresInvestorOrganisationRepository(): InvestorOrganisationRepository {
  return {
    insert: async (tx, input) => {
      const rows = await tx.sql`
        insert into core.investor_organisations
          (tenant_id, organisation_id, investor_type, display_name, website_url,
           hq_country, public_description, deployment_state)
        values
          (${input.tenantId}, ${input.organisationId}, ${input.investorType},
           ${input.displayName}, ${input.websiteUrl}, ${input.hqCountry},
           ${input.publicDescription}, ${input.deploymentState})
        returning id`;
      const inserted = z
        .object({ id: InvestorOrganisationIdSchema })
        .parse(rows[0]);
      const created = await tx.sql`
        ${investorSelect(tx.sql)}
         where i.id = ${inserted.id} and i.tenant_id = ${input.tenantId}`;
      return toInvestor(created[0]);
    },

    findById: async (executor, tenantId, organisationId, id) => {
      const rows = await executor`
        ${investorSelect(executor)}
         where i.id = ${id}
           and i.tenant_id = ${tenantId}
           and i.organisation_id = ${organisationId}`;
      return rows.length === 0 ? null : toInvestor(rows[0]);
    },

    findByOrganisation: async (executor, tenantId, organisationId) => {
      const rows = await executor`
        ${investorSelect(executor)}
         where i.organisation_id = ${organisationId}
           and i.tenant_id = ${tenantId}`;
      return rows.length === 0 ? null : toInvestor(rows[0]);
    },

    lockById: async (tx, tenantId, organisationId, id) => {
      const rows = await tx.sql`
        ${investorSelect(tx.sql)}
         where i.id = ${id}
           and i.tenant_id = ${tenantId}
           and i.organisation_id = ${organisationId}
           for update`;
      return rows.length === 0 ? null : toInvestor(rows[0]);
    },

    lockOrganisation: async (tx, organisationId) => {
      await tx.sql`
        select pg_advisory_xact_lock(hashtext('investor.create'), hashtext(${organisationId}::text))`;
    },

    updateProfile: async (tx, input) => {
      const updated = await tx.sql`
        update core.investor_organisations i
           set ${tx.sql(toColumnChanges(input.changes))},
               version = i.version + 1
         where i.id = ${input.investorOrganisationId}
           and i.tenant_id = ${input.tenantId}
           and i.organisation_id = ${input.organisationId}
           and i.version = ${input.expectedVersion}
        returning i.id`;
      if (updated.length === 0) {
        return null;
      }
      const rows = await tx.sql`
        ${investorSelect(tx.sql)}
         where i.id = ${input.investorOrganisationId} and i.tenant_id = ${input.tenantId}`;
      return toInvestor(rows[0]);
    },
  };
}

const RepresentativeRow = z.object({
  id: InvestorRepresentativeIdSchema,
  tenant_id: TenantIdSchema,
  investor_organisation_id: InvestorOrganisationIdSchema,
  organisation_id: OrganisationIdSchema,
  user_id: UserIdSchema,
  membership_id: MembershipIdSchema,
  business_title: z.string().nullable(),
  is_current: z.boolean(),
  started_at: Timestamp,
  ended_at: Timestamp.nullable(),
  version: z.number().int().min(1),
  created_at: Timestamp,
  updated_at: Timestamp,
});

function toRepresentative(row: unknown): InvestorRepresentative {
  const r = RepresentativeRow.parse(row);
  return {
    id: r.id,
    tenantId: r.tenant_id,
    investorOrganisationId: r.investor_organisation_id,
    organisationId: r.organisation_id,
    userId: r.user_id,
    membershipId: r.membership_id,
    businessTitle: r.business_title,
    isCurrent: r.is_current,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    version: r.version,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function representativeSelect(executor: DatabaseExecutor) {
  return executor`
    select r.id, r.tenant_id, r.investor_organisation_id, r.organisation_id, r.user_id,
           r.membership_id, r.business_title, r.is_current, r.started_at, r.ended_at,
           r.version, r.created_at, r.updated_at
      from core.investor_representatives r`;
}

function representativeColumns(changes: InvestorRepresentativeChanges) {
  const columns: Record<string, string | null> = {};
  if (changes.businessTitle !== undefined) {
    columns["business_title"] = changes.businessTitle;
  }
  return columns;
}

export function createPostgresInvestorRepresentativeRepository(): InvestorRepresentativeRepository {
  return {
    findCurrentForUser: async (executor, tenantId, investorId, userId) => {
      const rows = await executor`
        ${representativeSelect(executor)}
         where r.tenant_id = ${tenantId}
           and r.investor_organisation_id = ${investorId}
           and r.user_id = ${userId}
           and r.is_current`;
      return rows.length === 0 ? null : toRepresentative(rows[0]);
    },
    lockCurrentForUser: async (tx, tenantId, investorId, userId) => {
      const rows = await tx.sql`
        ${representativeSelect(tx.sql)}
         where r.tenant_id = ${tenantId}
           and r.investor_organisation_id = ${investorId}
           and r.user_id = ${userId}
           and r.is_current
         for update`;
      return rows.length === 0 ? null : toRepresentative(rows[0]);
    },
    create: async (tx, input) => {
      const rows = await tx.sql`
        insert into core.investor_representatives
          (tenant_id, investor_organisation_id, organisation_id, user_id, membership_id, business_title)
        values (${input.tenantId}, ${input.investorOrganisationId}, ${input.organisationId},
                ${input.userId}, ${input.membershipId}, ${input.businessTitle})
        returning id`;
      const inserted = z
        .object({ id: InvestorRepresentativeIdSchema })
        .parse(rows[0]);
      const created = await tx.sql`
        ${representativeSelect(tx.sql)}
         where r.id = ${inserted.id} and r.tenant_id = ${input.tenantId}`;
      return toRepresentative(created[0]);
    },
    updateCurrent: async (tx, input) => {
      const updated = await tx.sql`
        update core.investor_representatives r
           set ${tx.sql(representativeColumns(input.changes))},
               version = r.version + 1
         where r.id = ${input.investorRepresentativeId}
           and r.tenant_id = ${input.tenantId}
           and r.is_current
           and r.version = ${input.expectedVersion}
        returning r.id`;
      if (updated.length === 0) {
        return null;
      }
      const rows = await tx.sql`
        ${representativeSelect(tx.sql)}
         where r.id = ${input.investorRepresentativeId} and r.tenant_id = ${input.tenantId}`;
      return toRepresentative(rows[0]);
    },
  };
}

const CreationRow = z.object({
  request_hash: z.string(),
  investor_organisation_id: InvestorOrganisationIdSchema,
  tenant_id: TenantIdSchema,
});

export function createPostgresInvestorCreationRequestStore(): InvestorCreationRequestStore {
  return {
    lock: async (tx, userId, organisationId, idempotencyKeyHash) => {
      await tx.sql`
        select pg_advisory_xact_lock(
          hashtext(${userId}::text || ':' || ${organisationId}::text),
          hashtext(${idempotencyKeyHash}))`;
    },
    find: async (tx, userId, organisationId, idempotencyKeyHash) => {
      const rows = await tx.sql`
        select r.request_hash, r.investor_organisation_id, r.tenant_id
          from core.investor_creation_requests r
         where r.user_id = ${userId}
           and r.organisation_id = ${organisationId}
           and r.idempotency_key_hash = ${idempotencyKeyHash}`;
      if (rows.length === 0) {
        return null;
      }
      const parsed = CreationRow.parse(rows[0]);
      const record: InvestorCreationRecord = {
        requestHash: parsed.request_hash,
        investorOrganisationId: parsed.investor_organisation_id,
        tenantId: parsed.tenant_id,
      };
      return record;
    },
    record: async (tx, input) => {
      await tx.sql`
        insert into core.investor_creation_requests
          (user_id, organisation_id, idempotency_key_hash, request_hash, investor_organisation_id, tenant_id)
        values (${input.userId}, ${input.organisationId}, ${input.idempotencyKeyHash},
                ${input.requestHash}, ${input.investorOrganisationId}, ${input.tenantId})`;
    },
  };
}

export function createPostgresInvestorOrganisationQueryPort(options: {
  readonly sql: DatabaseExecutor;
}): InvestorOrganisationQueryPort {
  const { sql } = options;
  return {
    getCanonicalInvestorOrganisation: async (tenantId, id) => {
      const rows = await sql`
        select i.id, i.tenant_id, i.organisation_id, i.investor_type, i.display_name, i.deployment_state
          from core.investor_organisations i
         where i.id = ${id}
           and i.tenant_id = ${tenantId}`;
      if (rows.length === 0) {
        return null;
      }
      const parsed = InvestorRow.pick({
        id: true,
        tenant_id: true,
        organisation_id: true,
        investor_type: true,
        display_name: true,
        deployment_state: true,
      }).parse(rows[0]);
      const identity: InvestorOrganisationIdentity = {
        id: parsed.id,
        tenantId: parsed.tenant_id,
        organisationId: parsed.organisation_id,
        investorType: parsed.investor_type,
        displayName: parsed.display_name,
        deploymentState: parsed.deployment_state,
      };
      return identity;
    },
  };
}
