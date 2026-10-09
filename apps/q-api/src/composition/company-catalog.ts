import { z } from "zod";

import type { DatabaseExecutor } from "@capital-q/database";
import type { CompanyCatalogPort } from "@capital-q/q-tools";
import { normalizeTaxonomyAlias } from "@capital-q/taxonomy";

/**
 * K1 (founder brief 2026-10-09): companies on the network by declared
 * sector, head-office country and stage, for `discovery.companies`.
 *
 * Candidates only. Classification selects them (network_visible or
 * public_external, active, never the actor's own organisation's); the tool
 * then decides each one through disclosure. A sector is a taxonomy node
 * found by canonical code or alias in the industry and product
 * vocabularies, with its sub-sectors; a company matches on a confirmed
 * assignment only (user-selected, admin-curated or confirmed), the same
 * rule as Discover's filter facts, so an unconfirmed Q inference from a
 * founder's private material never decides what an investor sees.
 * Name order: deterministic, and said as the basis.
 */

const SECTOR_VOCABULARIES = ["industry", "product_category"];
const DISCOVERABLE = ["network_visible", "public_external"];

const NodeRow = z.object({
  id: z.string(),
  canonical_code: z.string(),
  display_name: z.string(),
  asked: z.string(),
});

const CandidateRow = z.object({
  id: z.string(),
  canonical_name: z.string(),
  current_stage_code: z.string().nullable(),
  headquarters_country: z.string().nullable(),
  short_description: z.string().nullable(),
  matched: z.array(z.string()).nullable(),
});

export function createPostgresCompanyCatalog(dependencies: {
  readonly sql: DatabaseExecutor;
}): CompanyCatalogPort {
  const { sql } = dependencies;
  return {
    find: async (actor, query) => {
      const asked = [
        ...new Set(
          query.sectors
            .map((sector) => normalizeTaxonomyAlias(sector.replace(/_/gu, " ")))
            .filter((sector) => sector.length > 0),
        ),
      ];
      const codes = query.sectors.map((sector) =>
        sector
          .trim()
          .toLowerCase()
          .replace(/[\s-]+/gu, "_"),
      );
      const nodes =
        query.sectors.length === 0
          ? []
          : (
              await sql`
          select distinct n.id, n.canonical_code, n.display_name,
                 coalesce(case when n.canonical_code = any(${codes}::text[])
                               then n.canonical_code end,
                          a.normalized_alias) as asked
            from taxonomy.nodes n
            join taxonomy.vocabularies v on v.id = n.vocabulary_id
            left join taxonomy.aliases a
              on a.node_id = n.id and a.normalized_alias = any(${asked}::text[])
           where v.code = any(${SECTOR_VOCABULARIES}::text[])
             and n.status = 'ACTIVE'
             and (n.canonical_code = any(${codes}::text[])
                  or a.id is not null)`
            ).map((row) => NodeRow.parse(row));
      const known = new Set(nodes.map((node) => node.asked));
      const unknownSectors = query.sectors.filter((sector, index) => {
        const code = codes[index] ?? "";
        const alias = normalizeTaxonomyAlias(sector.replace(/_/gu, " "));
        return !known.has(code) && !known.has(alias);
      });
      // Every sector asked for unknown: nothing in the catalog is that.
      if (query.sectors.length > 0 && nodes.length === 0) {
        return { candidates: [], sectors: [], unknownSectors };
      }
      const roots = nodes.map((node) => node.id);
      const viewerOrganisation = actor.organisationId ?? null;
      const rows = await sql`
        with recursive wanted as (
          select n.id from taxonomy.nodes n where n.id = any(${roots}::uuid[])
          union
          select c.id from taxonomy.nodes c join wanted w on c.parent_node_id = w.id
        )
        select c.id, c.canonical_name, c.current_stage_code, c.headquarters_country,
               c.short_description,
               (select array_agg(distinct tn.display_name order by tn.display_name)
                  from taxonomy.entity_assignments a
                  join taxonomy.nodes tn on tn.id = a.node_id
                 where a.entity_type = 'COMPANY' and a.entity_id = c.id
                   and a.tenant_id = c.tenant_id
                   and a.status = 'ACTIVE' and a.valid_to is null
                   and (a.assignment_source in ('user_selected', 'admin_curated')
                        or a.confirmed_at is not null)
                   and a.node_id in (select id from wanted)) as matched
          from core.companies c
         where c.company_status = 'active'
           and c.marketplace_visibility = any(${DISCOVERABLE}::text[])
           and (${viewerOrganisation}::uuid is null
                or not (c.tenant_id = ${actor.tenantId} and c.organisation_id = ${viewerOrganisation}::uuid))
           and (${roots.length === 0} or exists (
                 select 1 from taxonomy.entity_assignments a
                  where a.entity_type = 'COMPANY' and a.entity_id = c.id
                    and a.tenant_id = c.tenant_id
                    and a.status = 'ACTIVE' and a.valid_to is null
                    and (a.assignment_source in ('user_selected', 'admin_curated')
                         or a.confirmed_at is not null)
                    and a.node_id in (select id from wanted)))
           and (${query.countries.length === 0}
                or c.headquarters_country = any(${[...query.countries]}::text[]))
           and (${query.stages.length === 0}
                or c.current_stage_code = any(${[...query.stages]}::text[]))
         order by c.canonical_name, c.id
         limit ${query.limit}`;
      return {
        candidates: rows.map((raw) => {
          const row = CandidateRow.parse(raw);
          return {
            companyId: row.id,
            name: row.canonical_name,
            stageCode: row.current_stage_code,
            headquartersCountry: row.headquarters_country,
            shortDescription: row.short_description,
            sectors: row.matched ?? [],
          };
        }),
        sectors: [
          ...new Map(
            nodes.map((node) => [
              node.canonical_code,
              { code: node.canonical_code, name: node.display_name },
            ]),
          ).values(),
        ],
        unknownSectors,
      };
    },
  };
}
