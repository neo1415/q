import type {
  ClaimableCompanyDto,
  CompanyClaimRequest,
  CompanyClaimResultDto,
} from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";
import type { ActorContext } from "@capital-q/security";

import { parseCompanySearch } from "../domain/company-search.js";
import { companySearchJoins } from "../infrastructure/company-search-sql.js";

/**
 * F3 (2026-10-06): "Find my startup". A founder finds their company among
 * the companies they may already see, and asks to claim it, or to join it
 * when it already has members.
 *
 *   one canonical company: nothing here creates a company or a duplicate
 *   a claim request ≠ a membership: only a decision makes one
 *
 * What a founder may find is what they may already see: companies shared
 * with the network (network_visible / public_external, ADR-001) and their
 * own organisation's. An organisation-private company never appears, so a
 * search cannot become a way to learn that a private company exists.
 */

const VISIBLE = ["network_visible", "public_external"];

function hostOf(website: string | null): string | null {
  if (website === null) return null;
  try {
    return new URL(website).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** Is this email at the company's own website domain (or a subdomain of it)? */
export function emailAtCompany(email: string, website: string | null): boolean {
  const host = hostOf(website);
  const domain = email.toLowerCase().split("@")[1] ?? "";
  return (
    host !== null &&
    host !== "" &&
    (domain === host || domain.endsWith(`.${host}`))
  );
}

export function createCompanyClaims(options: {
  readonly sql: DatabaseExecutor;
}) {
  const { sql } = options;

  type Row = {
    id: string;
    tenant_id: string;
    canonical_name: string;
    website_url: string | null;
    headquarters_city: string | null;
    headquarters_country: string | null;
    members: number;
    yours: boolean;
    requested: boolean;
  };

  const visible = (actor: ActorContext, where: ReturnType<typeof sql>) => sql<
    Row[]
  >`
    select c.id, c.tenant_id, c.canonical_name, c.website_url, c.headquarters_city,
           c.headquarters_country,
           (select count(*)::int from identity.organisation_memberships m
             where m.organisation_id = c.organisation_id and m.membership_status = 'active') as members,
           exists (select 1 from identity.organisation_memberships m
                    where m.organisation_id = c.organisation_id and m.user_id = ${actor.userId}
                      and m.membership_status = 'active') as yours,
           exists (select 1 from core.company_claim_requests r
                    where r.company_id = c.id and r.requester_user_id = ${actor.userId}
                      and r.status = 'PENDING') as requested
      from core.companies c
     where c.company_status = 'active'
       and (c.marketplace_visibility = any(${VISIBLE}::text[])
            or (c.organisation_id = ${actor.organisationId ?? null}::uuid and c.tenant_id = ${actor.tenantId}))
       and ${where}
     order by c.canonical_name
     limit 20`;

  const toDto = (row: Row): ClaimableCompanyDto => ({
    companyId: row.id,
    name: row.canonical_name,
    website: row.website_url,
    city: row.headquarters_city,
    country: row.headquarters_country,
    members: row.members,
    yours: row.yours,
    requested: row.requested,
  });

  return {
    search: async (
      actor: ActorContext,
      text: string,
    ): Promise<readonly ClaimableCompanyDto[]> => {
      const query = text.trim().slice(0, 120);
      if (query.length < 2) return [];
      const parsed = parseCompanySearch(query);
      if (parsed === null) return [];
      // P13: the same reading and ranking as every company search (exact,
      // website, sound-alike, prefix, contains, close misspelling, described),
      // best first; the legal name still finds a company by its own text.
      const like = `%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      const rows = await sql<Row[]>`
        select c.id, c.tenant_id, c.canonical_name, c.website_url, c.headquarters_city,
               c.headquarters_country,
               (select count(*)::int from identity.organisation_memberships m
                 where m.organisation_id = c.organisation_id and m.membership_status = 'active') as members,
               exists (select 1 from identity.organisation_memberships m
                        where m.organisation_id = c.organisation_id and m.user_id = ${actor.userId}
                          and m.membership_status = 'active') as yours,
               exists (select 1 from core.company_claim_requests r
                        where r.company_id = c.id and r.requester_user_id = ${actor.userId}
                          and r.status = 'PENDING') as requested
          from core.companies c
          ${companySearchJoins(sql, parsed)}
         where c.company_status = 'active'
           and (c.marketplace_visibility = any(${VISIBLE}::text[])
                or (c.organisation_id = ${actor.organisationId ?? null}::uuid and c.tenant_id = ${actor.tenantId}))
           and (s.score > 0 or c.legal_name ilike ${like})
         order by greatest(s.score, case when c.legal_name ilike ${like} then 640 else 0 end) desc,
                  c.canonical_name, c.id
         limit 20`;
      return rows.map(toDto);
    },

    request: async (
      actor: ActorContext,
      companyId: string,
      input: CompanyClaimRequest,
    ): Promise<CompanyClaimResultDto | null> => {
      const rows = await visible(actor, sql`c.id = ${companyId}`);
      const company = rows[0];
      // Not visible to them is the same answer as not existing.
      if (company === undefined) return null;
      if (company.yours) return { status: "ALREADY_YOURS" };
      if (
        input.method === "WORK_EMAIL" &&
        !emailAtCompany(input.workEmail ?? "", company.website_url)
      ) {
        return { status: "EMAIL_NOT_AT_COMPANY" };
      }
      const inserted = await sql<{ id: string }[]>`
        insert into core.company_claim_requests
          (tenant_id, company_id, requester_user_id, method, work_email, client_request_id)
        values (${company.tenant_id}, ${company.id}, ${actor.userId}, ${input.method},
                ${input.method === "WORK_EMAIL" ? (input.workEmail ?? null) : null}, ${input.clientRequestId})
        on conflict do nothing
        returning id`;
      return {
        status: inserted.length === 0 ? "ALREADY_REQUESTED" : "REQUESTED",
      };
    },
  };
}

export type CompanyClaims = ReturnType<typeof createCompanyClaims>;
