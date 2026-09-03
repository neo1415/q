import { z } from "zod";

import {
  CompanyStatusSchema,
  MarketplaceReadinessStateSchema,
  MarketplaceVisibilitySchema,
  UtcTimestampSchema,
} from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";
import { OrganisationIdSchema, TenantIdSchema } from "@capital-q/security";

import {
  CompanyIdSchema,
  type Company,
  type CompanyIdentity,
} from "../contracts/index.js";
import type {
  CompanyCreationRecord,
  CompanyCreationRequestStore,
  CompanyProfileChanges,
  CompanyQueryPort,
  CompanyRepository,
} from "../application/ports.js";

/**
 * PostgreSQL adapter for the company ports. Parameterised SQL on the
 * executor or transaction the caller supplies; no pools are opened here.
 * Every statement names the tenant and, where the row is organisation
 * owned, the organisation.
 */

const TimestampSchema = z
  .union([z.date(), z.string()])
  .transform((value) =>
    UtcTimestampSchema.parse(
      value instanceof Date
        ? value.toISOString()
        : new Date(value).toISOString(),
    ),
  );

/** `founded_date` is selected as text so a calendar date never crosses a timezone. */
const CompanyRowSchema = z.object({
  id: CompanyIdSchema,
  tenant_id: TenantIdSchema,
  organisation_id: OrganisationIdSchema,
  canonical_name: z.string(),
  legal_name: z.string().nullable(),
  slug: z.string(),
  website_url: z.string().nullable(),
  founded_date: z.iso.date().nullable(),
  headquarters_country: z.string().nullable(),
  headquarters_city: z.string().nullable(),
  current_stage_code: z.string().nullable(),
  primary_description: z.string().nullable(),
  short_description: z.string().nullable(),
  company_status: CompanyStatusSchema,
  marketplace_visibility: MarketplaceVisibilitySchema,
  marketplace_readiness_state: MarketplaceReadinessStateSchema,
  logo_storage_key: z.string().nullable(),
  version: z.number().int().min(1),
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
});

function toCompany(row: unknown): Company {
  const parsed = CompanyRowSchema.parse(row);
  return {
    id: parsed.id,
    tenantId: parsed.tenant_id,
    organisationId: parsed.organisation_id,
    canonicalName: parsed.canonical_name,
    legalName: parsed.legal_name,
    slug: parsed.slug,
    websiteUrl: parsed.website_url,
    foundedDate: parsed.founded_date,
    headquartersCountry: parsed.headquarters_country,
    headquartersCity: parsed.headquarters_city,
    currentStageCode: parsed.current_stage_code,
    primaryDescription: parsed.primary_description,
    shortDescription: parsed.short_description,
    companyStatus: parsed.company_status,
    marketplaceVisibility: parsed.marketplace_visibility,
    marketplaceReadinessState: parsed.marketplace_readiness_state,
    logoStorageKey: parsed.logo_storage_key,
    version: parsed.version,
    createdAt: parsed.created_at,
    updatedAt: parsed.updated_at,
  };
}

function companySelect(executor: DatabaseExecutor) {
  return executor`
    select c.id, c.tenant_id, c.organisation_id, c.canonical_name, c.legal_name, c.slug,
           c.website_url, c.founded_date::text as founded_date, c.headquarters_country,
           c.headquarters_city, c.current_stage_code, c.primary_description,
           c.short_description, c.company_status, c.marketplace_visibility,
           c.marketplace_readiness_state, c.logo_storage_key, c.version,
           c.created_at, c.updated_at
      from core.companies c`;
}

const COLUMN_BY_FIELD: Readonly<Record<keyof CompanyProfileChanges, string>> = {
  canonicalName: "canonical_name",
  legalName: "legal_name",
  websiteUrl: "website_url",
  foundedDate: "founded_date",
  headquartersCountry: "headquarters_country",
  headquartersCity: "headquarters_city",
  currentStageCode: "current_stage_code",
  primaryDescription: "primary_description",
  shortDescription: "short_description",
};

/** Whitelisted column mapping. Unknown keys cannot reach the statement. */
function toColumnChanges(
  changes: CompanyProfileChanges,
): Record<string, string | null> {
  const columns: Record<string, string | null> = {};
  for (const field of Object.keys(
    COLUMN_BY_FIELD,
  ) as (keyof CompanyProfileChanges)[]) {
    const value = changes[field];
    if (value !== undefined) {
      columns[COLUMN_BY_FIELD[field]] = value;
    }
  }
  return columns;
}

export function createPostgresCompanyRepository(): CompanyRepository {
  return {
    insert: async (tx, input) => {
      // The date is bound as text and cast in SQL so the driver never
      // routes it through a JavaScript Date (and a timezone).
      const rows = await tx.sql`
        insert into core.companies
          (tenant_id, organisation_id, canonical_name, slug, legal_name, website_url,
           founded_date, headquarters_country, headquarters_city, current_stage_code,
           primary_description, short_description)
        values
          (${input.tenantId}, ${input.organisationId}, ${input.canonicalName}, ${input.slug},
           ${input.legalName}, ${input.websiteUrl}, ${input.foundedDate}::text::date,
           ${input.headquartersCountry}, ${input.headquartersCity}, ${input.currentStageCode},
           ${input.primaryDescription}, ${input.shortDescription})
        returning id`;
      const inserted = z.object({ id: CompanyIdSchema }).parse(rows[0]);
      const created = await tx.sql`
        ${companySelect(tx.sql)}
         where c.id = ${inserted.id} and c.tenant_id = ${input.tenantId}`;
      return toCompany(created[0]);
    },

    findById: async (executor, tenantId, organisationId, companyId) => {
      const rows = await executor`
        ${companySelect(executor)}
         where c.id = ${companyId}
           and c.tenant_id = ${tenantId}
           and c.organisation_id = ${organisationId}`;
      return rows.length === 0 ? null : toCompany(rows[0]);
    },

    lockById: async (tx, tenantId, organisationId, companyId) => {
      const rows = await tx.sql`
        ${companySelect(tx.sql)}
         where c.id = ${companyId}
           and c.tenant_id = ${tenantId}
           and c.organisation_id = ${organisationId}
           for update`;
      return rows.length === 0 ? null : toCompany(rows[0]);
    },

    updateProfile: async (tx, input) => {
      const columns = toColumnChanges(input.changes);
      // founded_date must be cast from text; every other column is text.
      const { founded_date: foundedDate, ...textColumns } = columns;
      const updated =
        foundedDate === undefined
          ? await tx.sql`
              update core.companies c
                 set ${tx.sql(textColumns)},
                     version = c.version + 1
               where c.id = ${input.companyId}
                 and c.tenant_id = ${input.tenantId}
                 and c.organisation_id = ${input.organisationId}
                 and c.version = ${input.expectedVersion}
              returning c.id`
          : Object.keys(textColumns).length === 0
            ? await tx.sql`
              update core.companies c
                 set founded_date = ${foundedDate}::text::date,
                     version = c.version + 1
               where c.id = ${input.companyId}
                 and c.tenant_id = ${input.tenantId}
                 and c.organisation_id = ${input.organisationId}
                 and c.version = ${input.expectedVersion}
              returning c.id`
            : await tx.sql`
              update core.companies c
                 set ${tx.sql(textColumns)},
                     founded_date = ${foundedDate}::text::date,
                     version = c.version + 1
               where c.id = ${input.companyId}
                 and c.tenant_id = ${input.tenantId}
                 and c.organisation_id = ${input.organisationId}
                 and c.version = ${input.expectedVersion}
              returning c.id`;
      if (updated.length === 0) {
        return null;
      }
      const rows = await tx.sql`
        ${companySelect(tx.sql)}
         where c.id = ${input.companyId} and c.tenant_id = ${input.tenantId}`;
      return toCompany(rows[0]);
    },

    lockSlug: async (tx, tenantId, baseSlug) => {
      await tx.sql`
        select pg_advisory_xact_lock(hashtext(${tenantId}::text), hashtext(${baseSlug}))`;
    },

    takenSlugs: async (tx, tenantId, candidates) => {
      const rows = await tx.sql<{ slug: string }[]>`
        select c.slug from core.companies c
         where c.tenant_id = ${tenantId}
           and c.slug = any(${[...candidates]}::text[])`;
      return new Set(rows.map((row) => row.slug));
    },
  };
}

const CreationRowSchema = z.object({
  request_hash: z.string(),
  company_id: CompanyIdSchema,
  tenant_id: TenantIdSchema,
});

export function createPostgresCompanyCreationRequestStore(): CompanyCreationRequestStore {
  return {
    lock: async (tx, userId, organisationId, idempotencyKeyHash) => {
      await tx.sql`
        select pg_advisory_xact_lock(
          hashtext(${userId}::text || ':' || ${organisationId}::text),
          hashtext(${idempotencyKeyHash}))`;
    },
    find: async (tx, userId, organisationId, idempotencyKeyHash) => {
      const rows = await tx.sql`
        select r.request_hash, r.company_id, r.tenant_id
          from core.company_creation_requests r
         where r.user_id = ${userId}
           and r.organisation_id = ${organisationId}
           and r.idempotency_key_hash = ${idempotencyKeyHash}`;
      if (rows.length === 0) {
        return null;
      }
      const parsed = CreationRowSchema.parse(rows[0]);
      const record: CompanyCreationRecord = {
        requestHash: parsed.request_hash,
        companyId: parsed.company_id,
        tenantId: parsed.tenant_id,
      };
      return record;
    },
    record: async (tx, input) => {
      await tx.sql`
        insert into core.company_creation_requests
          (user_id, organisation_id, idempotency_key_hash, request_hash, company_id, tenant_id)
        values (${input.userId}, ${input.organisationId}, ${input.idempotencyKeyHash},
                ${input.requestHash}, ${input.companyId}, ${input.tenantId})`;
    },
  };
}

export function createPostgresCompanyQueryPort(options: {
  readonly sql: DatabaseExecutor;
}): CompanyQueryPort {
  const { sql } = options;
  const toIdentity = (row: unknown): CompanyIdentity => {
    const parsed = CompanyRowSchema.pick({
      id: true,
      tenant_id: true,
      organisation_id: true,
      canonical_name: true,
      company_status: true,
    }).parse(row);
    return {
      id: parsed.id,
      tenantId: parsed.tenant_id,
      organisationId: parsed.organisation_id,
      canonicalName: parsed.canonical_name,
      companyStatus: parsed.company_status,
    };
  };
  return {
    getCanonicalCompany: async (tenantId, companyId) => {
      const rows = await sql`
        select c.id, c.tenant_id, c.organisation_id, c.canonical_name, c.company_status
          from core.companies c
         where c.id = ${companyId}
           and c.tenant_id = ${tenantId}`;
      return rows.length === 0 ? null : toIdentity(rows[0]);
    },
    findCanonicalCompany: async (companyId) => {
      const rows = await sql`
        select c.id, c.tenant_id, c.organisation_id, c.canonical_name, c.company_status
          from core.companies c
         where c.id = ${companyId}`;
      return rows.length === 0 ? null : toIdentity(rows[0]);
    },
  };
}
