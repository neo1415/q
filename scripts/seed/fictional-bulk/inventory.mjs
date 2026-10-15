#!/usr/bin/env node
/**
 * Read-only inventory of the bulk fictional world (fictional-bulk.v1):
 * every row it owns is reached from auth users carrying the seed marker
 * `app_metadata.cq_seed = 'fictional-bulk.v1'`, through their memberships.
 *
 *   /root/sb node scripts/seed/fictional-bulk/inventory.mjs [--removal-sql]
 *
 * Never writes. `--removal-sql` prints the scoped removal statement for an
 * operator to review and run; it is not executed here.
 */
import * as lib from "../tavus20/lib.mjs";
import { SEED_MARKER } from "./world.mjs";

export const SEEDED_USERS = `select p.id as user_id, u.id as auth_user_id, u.email
  from auth.users u join identity.user_profiles p on p.auth_user_id = u.id
 where u.raw_app_meta_data->>'cq_seed' = '${SEED_MARKER}'`;

/** Organisations whose every member is a seeded account: safe to remove whole. */
export const SEEDED_ORGS = `select m.organisation_id
  from identity.organisation_memberships m
 group by m.organisation_id
having bool_and(m.user_id in (select user_id from (${SEEDED_USERS}) s))
   and count(*) filter (where m.user_id in (select user_id from (${SEEDED_USERS}) s)) > 0`;

export const REMOVAL_SQL = `-- fictional-bulk.v1 removal (review first; run as one transaction).
begin;
create temp table cq_seed_orgs on commit drop as ${SEEDED_ORGS};
create temp table cq_seed_tenants on commit drop as
  select distinct t.tenant_id from identity.tenant_organisations t
   where t.organisation_id in (select organisation_id from cq_seed_orgs)
     and not exists (select 1 from identity.tenant_organisations o
                      where o.tenant_id = t.tenant_id
                        and o.organisation_id not in (select organisation_id from cq_seed_orgs));
-- Rows that restrict a person's deletion (daily_preferences references the profile).
delete from q_runtime.daily_preferences where user_id in (select user_id from (${SEEDED_USERS}) s);
delete from identity.tenants where id in (select tenant_id from cq_seed_tenants);
delete from auth.users where raw_app_meta_data->>'cq_seed' = '${SEED_MARKER}';
commit;`;

/**
 * Per-company quality over every fictional company: organisations with a
 * member whose account carries the fictional markers, split into the bulk
 * world and the earlier fictional sets.
 */
export const QUALITY_SQL = `
with fu as (
  select p.id as user_id, (u.raw_app_meta_data->>'cq_seed') = '${SEED_MARKER}' as bulk
    from auth.users u join identity.user_profiles p on p.auth_user_id = u.id
   where u.raw_app_meta_data->>'fictional_demo' = 'true'),
co as (
  select distinct c.*, bool_or(fu.bulk) over (partition by c.id) as bulk
    from core.companies c
    join identity.organisation_memberships m on m.organisation_id = c.organisation_id
    join fu on fu.user_id = m.user_id),
q as (
  select co.id, co.bulk,
    (select count(*) from identity.organisation_memberships m where m.organisation_id = co.organisation_id and m.membership_status = 'active') >= 2 as team2,
    (select count(*) from evidence.documents d where d.company_id = co.id and d.status = 'ACTIVE' and d.document_type <> 'PITCH_DECK') >= 3 as docs3,
    (exists (select 1 from evidence.documents d where d.company_id = co.id and d.status = 'ACTIVE' and d.document_type = 'PITCH_DECK')
      or exists (select 1 from artifacts.artifacts a where a.company_id = co.id and a.type = 'PITCH_DECK' and a.archived_at is null)) as deck,
    (co.short_description is not null and co.primary_description is not null and co.current_stage_code is not null
      and co.headquarters_country is not null and co.headquarters_city is not null and co.website_url is not null
      and co.founded_date is not null
      and exists (select 1 from core.capital_objectives o where o.company_id = co.id)
      and exists (select 1 from taxonomy.entity_assignments a where a.entity_id = co.id)) as profile
    from (select distinct on (id) * from co) co)
select case when bulk then 'bulk' else 'earlier fictional' end as cohort, count(*) as companies,
       count(*) filter (where team2) as team_2plus, count(*) filter (where docs3) as docs_3plus,
       count(*) filter (where deck) as deck, count(*) filter (where profile) as complete_profile,
       count(*) filter (where team2 and docs3 and deck and profile) as all_four
  from q group by 1 order by 1`;

if (process.argv[1]?.endsWith("inventory.mjs")) {
  if (process.argv.includes("--quality")) {
    console.log(JSON.stringify(await lib.sql(QUALITY_SQL), null, 1));
    process.exit(0);
  }
  if (process.argv.includes("--removal-sql")) {
    console.log(REMOVAL_SQL);
    process.exit(0);
  }
  const [row] = await lib.sql(`
with su as (${SEEDED_USERS}),
     orgs as (${SEEDED_ORGS}),
     co as (select c.* from core.companies c where c.organisation_id in (select organisation_id from orgs)),
     inv as (select i.* from core.investor_organisations i where i.organisation_id in (select organisation_id from orgs))
select
  (select count(*) from su) as seeded_logins,
  (select count(*) from co) as companies,
  (select count(*) from co where marketplace_visibility = 'network_visible' and marketplace_readiness_state = 'marketplace_ready') as companies_visible_ready,
  (select count(*) from co c where (select count(*) from identity.organisation_memberships m where m.organisation_id = c.organisation_id and m.membership_status = 'active') >= 2) as companies_team_2plus,
  (select count(*) from co c where exists (select 1 from core.capital_objectives o where o.company_id = c.id)) as companies_with_objective,
  (select count(*) from co c where exists (select 1 from evidence.documents d where d.company_id = c.id)) as companies_with_documents,
  (select count(*) from co c where exists (select 1 from core.investor_mandates im join core.investor_organisations io on io.id = im.investor_organisation_id where io.organisation_id = c.organisation_id)) as founder_mandates_must_be_0,
  (select count(*) from inv) as investor_orgs,
  (select count(*) from core.investor_mandates m where m.investor_organisation_id in (select id from inv) and m.status = 'ACTIVE') as active_mandates
`);
  console.log(JSON.stringify(row, null, 2));
}
