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

if (process.argv[1]?.endsWith("inventory.mjs")) {
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
