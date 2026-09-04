import { z } from "zod";

import {
  InvestorPortfolioSourceSchema,
  UtcTimestampSchema,
} from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";
import { TenantIdSchema, UserIdSchema } from "@capital-q/security";

import type { InvestorPortfolioReferenceRepository } from "../application/portfolio-ports.js";
import { InvestorOrganisationIdSchema } from "../contracts/index.js";
import {
  InvestorPortfolioReferenceIdSchema,
  type InvestorPortfolioReference,
} from "../contracts/portfolio.js";

const Timestamp = z
  .union([z.date(), z.string()])
  .transform((value) =>
    UtcTimestampSchema.parse(
      value instanceof Date
        ? value.toISOString()
        : new Date(value).toISOString(),
    ),
  );

const Row = z.object({
  id: InvestorPortfolioReferenceIdSchema,
  tenant_id: TenantIdSchema,
  investor_organisation_id: InvestorOrganisationIdSchema,
  company_name: z.string(),
  website_url: z.string().nullable(),
  source: InvestorPortfolioSourceSchema,
  created_by_user_id: UserIdSchema,
  created_at: Timestamp,
  removed_at: Timestamp.nullable(),
});

function toReference(row: unknown): InvestorPortfolioReference {
  const r = Row.parse(row);
  return {
    id: r.id,
    tenantId: r.tenant_id,
    investorOrganisationId: r.investor_organisation_id,
    companyName: r.company_name,
    websiteUrl: r.website_url,
    source: r.source,
    createdByUserId: r.created_by_user_id,
    createdAt: r.created_at,
    removedAt: r.removed_at,
  };
}

function select(executor: DatabaseExecutor) {
  return executor`
    select p.id, p.tenant_id, p.investor_organisation_id, p.company_name, p.website_url,
           p.source, p.created_by_user_id, p.created_at, p.removed_at
      from core.investor_portfolio_references p`;
}

/** Parameterised SQL only; every statement carries the tenant. */
export function createPostgresInvestorPortfolioReferenceRepository(): InvestorPortfolioReferenceRepository {
  return {
    listCurrent: async (executor, tenantId, investorId) => {
      const rows = await executor`
        ${select(executor)}
         where p.tenant_id = ${tenantId}
           and p.investor_organisation_id = ${investorId}
           and p.removed_at is null
         order by p.created_at, p.id`;
      return rows.map(toReference);
    },
    lockForInvestor: async (tx, tenantId, investorId) => {
      // One advisory lock per investor serialises concurrent additions so a
      // ceiling check cannot be raced; the rows themselves stay unlocked.
      await tx.sql`
        select pg_advisory_xact_lock(hashtext('core.investor_portfolio_references:' || ${investorId}::text))`;
      const rows = await tx.sql`
        ${select(tx.sql)}
         where p.tenant_id = ${tenantId}
           and p.investor_organisation_id = ${investorId}
           and p.removed_at is null
         order by p.created_at, p.id`;
      return rows.map(toReference);
    },
    insert: async (tx, input) => {
      // Several references are usually added inside one transaction; now()
      // would stamp them identically and lose the order the investor gave.
      const rows = await tx.sql`
        insert into core.investor_portfolio_references
          (tenant_id, investor_organisation_id, company_name, website_url, source, created_by_user_id, created_at)
        values (${input.tenantId}, ${input.investorOrganisationId}, ${input.companyName},
                ${input.websiteUrl}, 'USER_ENTERED', ${input.createdByUserId}, clock_timestamp())
        returning id`;
      const inserted = z
        .object({ id: InvestorPortfolioReferenceIdSchema })
        .parse(rows[0]);
      const created = await tx.sql`
        ${select(tx.sql)} where p.id = ${inserted.id} and p.tenant_id = ${input.tenantId}`;
      return toReference(created[0]);
    },
    remove: async (tx, tenantId, investorId, referenceId) => {
      const rows = await tx.sql`
        update core.investor_portfolio_references p
           set removed_at = clock_timestamp()
         where p.id = ${referenceId}
           and p.tenant_id = ${tenantId}
           and p.investor_organisation_id = ${investorId}
           and p.removed_at is null
        returning p.id`;
      if (rows.length === 0) {
        return null;
      }
      const updated = await tx.sql`
        ${select(tx.sql)} where p.id = ${referenceId} and p.tenant_id = ${tenantId}`;
      return toReference(updated[0]);
    },
  };
}
