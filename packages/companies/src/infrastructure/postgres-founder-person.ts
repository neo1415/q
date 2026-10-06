import type { DatabaseExecutor } from "@capital-q/database";

import type { FounderPersonSource } from "../domain/founder-person.js";

/**
 * The founder at a position among a company's current founders (founders
 * first, then by start, as the team list orders them), with the facts and
 * background lines they keep about themselves. Server-only; the caller has
 * decided the reader may see the company's team (ADR 0041) and projects it
 * through `projectFounderPerson`.
 */
export function createPostgresFounderPersonSource(options: { readonly sql: DatabaseExecutor }) {
  return {
    founderAt: async (company: {
      readonly tenantId: string;
      readonly companyId: string;
      readonly position: number;
    }): Promise<FounderPersonSource | null> => {
      if (!Number.isInteger(company.position) || company.position < 1 || company.position > 20) return null;
      const rows = await options.sql<
        {
          user_id: string;
          name: string | null;
          business_title: string | null;
          professional_summary: string | null;
          birth_year: number | null;
          age_visibility_scope: string | null;
          building_since: number | null;
          companies_founded: number | null;
          exits: string | null;
          looking_for: string | null;
          location: string | null;
          has_facts: boolean;
        }[]
      >`
        select m.user_id,
               nullif(btrim(coalesce(p.display_name, concat_ws(' ', p.given_name, p.family_name))), '') as name,
               m.business_title, f.professional_summary,
               x.birth_year, x.age_visibility_scope, x.building_since, x.companies_founded,
               x.exits, x.looking_for, x.location, (x.user_id is not null) as has_facts
          from core.company_members m
          join identity.user_profiles p on p.id = m.user_id
          left join core.founder_profiles f on f.tenant_id = m.tenant_id and f.user_id = m.user_id
          left join core.founder_person_facts x on x.user_id = m.user_id
         where m.tenant_id = ${company.tenantId}
           and m.company_id = ${company.companyId}
           and m.is_current and m.is_founder
         order by m.started_at asc, m.id asc
         offset ${company.position - 1} limit 1`;
      const row = rows[0];
      if (row === undefined || row.name === null) return null;
      const lines = await options.sql<
        {
          from_year: number | null;
          to_year: number | null;
          title: string;
          detail: string | null;
          supporting_document_id: string | null;
          visibility_scope: string;
        }[]
      >`
        select from_year, to_year, title, detail, supporting_document_id, visibility_scope
          from core.founder_background_entries
         where user_id = ${row.user_id}
         order by sort_order, from_year desc nulls last
         limit 40`;
      return {
        name: row.name,
        businessTitle: row.business_title,
        isFounder: true,
        professionalSummary: row.professional_summary,
        // Identity verification is its own workflow (verification_claims);
        // not read here yet, so never claimed.
        identityVerified: false,
        facts: row.has_facts
          ? {
              birthYear: row.birth_year,
              ageShared: row.age_visibility_scope === "network_visible",
              buildingSince: row.building_since,
              companiesFounded: row.companies_founded,
              exits: row.exits,
              lookingFor: row.looking_for,
              location: row.location,
            }
          : null,
        background: lines.map((line) => ({
          fromYear: line.from_year,
          toYear: line.to_year,
          title: line.title,
          detail: line.detail,
          supportingDocumentId: line.supporting_document_id,
          shared: line.visibility_scope === "network_visible",
        })),
      };
    },
  };
}
