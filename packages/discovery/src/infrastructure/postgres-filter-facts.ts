import { z } from "zod";

import type { DatabaseExecutor } from "@capital-q/database";

import type { DiscoverFilterFactsPort } from "../slates/filters.js";

const SectorRow = z.object({
  company_id: z.string().uuid(),
  node_ids: z.array(z.string().uuid()),
});

/**
 * Declared sectors for Discover filters (ux/discover-filters): each
 * company's ACTIVE taxonomy assignments that a person stated or confirmed,
 * with every ancestor node, so filtering on a parent ("Financial
 * Services") keeps its children ("Fintech"). An unconfirmed Q inference is
 * not a stated sector and is left out, as eligibility leaves it out. One
 * statement per scan; ids and node ids only.
 */
export function createPostgresCompanySectorsPort(options: {
  readonly sql: DatabaseExecutor;
}): Required<Pick<DiscoverFilterFactsPort, "sectors">> {
  const { sql } = options;
  return {
    sectors: async (companyIds) => {
      const out = new Map<string, readonly string[]>();
      if (companyIds.length === 0) return out;
      const rows = await sql`
        with recursive assigned as (
          select a.entity_id as company_id, a.node_id
            from taxonomy.entity_assignments a
           where a.entity_type = 'COMPANY'
             and a.status = 'ACTIVE'
             and a.valid_to is null
             and a.entity_id = any(${[...companyIds]}::uuid[])
             and (a.assignment_source in ('user_selected', 'admin_curated')
                  or a.confirmed_at is not null)
        ), lineage as (
          select company_id, node_id from assigned
          union
          select l.company_id, n.parent_node_id
            from lineage l
            join taxonomy.nodes n on n.id = l.node_id
           where n.parent_node_id is not null
        )
        select company_id, array_agg(distinct node_id) as node_ids
          from lineage
         group by company_id`;
      for (const raw of rows) {
        const row = SectorRow.parse(raw);
        out.set(row.company_id, row.node_ids);
      }
      return out;
    },
  };
}
