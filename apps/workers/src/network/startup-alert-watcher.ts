import {
  alertMatches,
  type AlertCompanyFacts,
  type StoredAlertFilters,
} from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";

/**
 * P14: tell each investor whose saved alert a newly ready company matches,
 * once per alert and company (a notice the delivery ticker pushes and
 * emails). Only a company the network may see; only alerts still on.
 * Returns how many people were told.
 */
export function createStartupAlertWatcher(options: {
  readonly sql: DatabaseExecutor;
}) {
  const { sql } = options;
  return async (companyId: string): Promise<number> => {
    const companies = await sql<
      {
        canonical_name: string;
        short_description: string | null;
        current_stage_code: string | null;
        headquarters_country: string | null;
        sector_node_ids: string[];
      }[]
    >`
      with recursive assigned as (
        select a.node_id
          from taxonomy.entity_assignments a
          join core.companies c on c.id = a.entity_id and c.tenant_id = a.tenant_id
         where a.entity_type = 'COMPANY' and a.entity_id = ${companyId}
           and a.status = 'ACTIVE' and a.valid_to is null
      ), lineage as (
        select node_id from assigned
        union
        select n.parent_node_id from taxonomy.nodes n join lineage l on n.id = l.node_id
         where n.parent_node_id is not null
      )
      select c.canonical_name, c.short_description, c.current_stage_code,
             c.headquarters_country,
             coalesce((select array_agg(node_id::text) from lineage), '{}'::text[]) as sector_node_ids
        from core.companies c
       where c.id = ${companyId} and c.company_status = 'active'
         and c.marketplace_visibility in ('network_visible', 'public_external')`;
    const company = companies[0];
    if (company === undefined) return 0;
    const facts: AlertCompanyFacts = {
      name: company.canonical_name,
      description: company.short_description,
      stageCode: company.current_stage_code,
      countryCode: company.headquarters_country,
      sectorNodeIds: company.sector_node_ids,
    };
    const alerts = await sql<
      {
        id: string;
        tenant_id: string;
        user_id: string;
        description: string;
        filters: StoredAlertFilters;
      }[]
    >`
      select a.id, a.tenant_id, a.user_id, a.description, a.filters
        from gateq.startup_alerts a
        join identity.organisation_memberships m
          on m.organisation_id = a.organisation_id and m.user_id = a.user_id
         and m.membership_status = 'active'
       where a.stopped_at is null
       limit 2000`;
    let told = 0;
    for (const alert of alerts) {
      if (!alertMatches(alert.filters, facts)) continue;
      const inserted = await sql<{ id: string }[]>`
        insert into communication.notifications
          (tenant_id, user_id, kind, title, body, link_path, dedupe_key)
        values (${alert.tenant_id}, ${alert.user_id}, 'STARTUP_ALERT',
                ${`New on Capital Q: ${facts.name}`.slice(0, 200)},
                ${`${facts.name} matches your alert "${alert.description}".`.slice(0, 1000)},
                ${`/company/${companyId}`},
                ${`startup-alert:${alert.id}:${companyId}`})
        on conflict (user_id, dedupe_key) do nothing
        returning id`;
      if (inserted.length > 0) told += 1;
    }
    return told;
  };
}
