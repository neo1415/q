-- Demo hygiene, data only (owner directive 2026-11-16, Phase 3): seeded
-- demonstration records stop carrying a " (fictional)" suffix in the names
-- and titles people read. The synthetic designation stays where it is kept
-- internally: the accounts' app_metadata markers (fictional_demo,
-- synthetic), core.companies.demonstration_data, evidence source metadata
-- and the generated documents' own SYNTHETIC/FICTIONAL DEMO header.
--
-- Which rows: only rows whose tenant is provably synthetic, i.e. the tenant
-- has at least one membership and EVERY membership (any status, revoked
-- included) belongs to an auth account whose app_metadata carries both
-- fictional_demo = true and synthetic = true. One unmarked or missing
-- account anywhere in the tenant excludes the whole tenant, so a real
-- customer's row is never touched even if its name happens to end
-- "(fictional)". Read-only counts on 16 Nov 2026 (rows with the suffix):
--   core.companies          416 synthetic / 48 excluded
--   core.investor_organisations 21 / 10 excluded
--   identity.organisations   28 / 59 excluded
--   evidence.documents     1750 / 2 excluded
-- The excluded rows sit in tenants with an unmarked member (QA sign-ups on
-- throwaway or unmarked @fictional.capitalq.local accounts); they are left
-- for a per-account decision.
--
-- Only the exact trailing suffix " (fictional)" or " (Fictional)" goes;
-- other parentheticals ("(fictional QA fund)", "(fictional, release Z)")
-- and every slug and id are unchanged.
--
-- History and projections, written the way the product writes a rename:
-- each changed row moves its optimistic-concurrency version by one and gets
-- an append-only audit.material_actions record (actor capital_q_system,
-- the product's own action type, changed field names only, never the old
-- or new text). No outbox event is written: names and titles are not an
-- input to Discover slates or investability, the company read projection
-- (knowledge.company_profiles) follows core.companies through its trigger
-- in this transaction, retrieval joins document titles live, and the
-- worker's representation refresh rebuilds a company representation when
-- the profile version moves (no model or provider call here).
--
-- The work is a function so the database tests can exercise it on their
-- own fixtures; it is idempotent (a second run finds nothing) and is not
-- callable by any client role.

-- The tenants whose every member is a marked synthetic demo account.
create or replace function private.synthetic_demo_tenant_ids()
returns setof uuid
language sql
stable
set search_path = ''
as $$
  select om.tenant_id
    from identity.organisation_memberships om
    left join identity.user_profiles p on p.id = om.user_id
    left join auth.users u on u.id = p.auth_user_id
   group by om.tenant_id
  having bool_and(coalesce(u.raw_app_meta_data ->> 'fictional_demo', '') = 'true'
              and coalesce(u.raw_app_meta_data ->> 'synthetic', '') = 'true')
$$;

comment on function private.synthetic_demo_tenant_ids() is
  'Tenants with at least one membership where every membership (any status) belongs to an auth account whose app_metadata has fictional_demo = true and synthetic = true. Server-only.';

revoke all on function private.synthetic_demo_tenant_ids() from public, anon, authenticated;

create or replace function private.strip_synthetic_demo_name_suffix()
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  suffix constant text := ' \([Ff]ictional\)$';
  companies_n integer;
  investors_n integer;
  organisations_n integer;
  documents_n integer;
begin
  -- Companies: canonical and legal name (the slug stays as it is).
  with changed as (
    update core.companies c
       set canonical_name = case
             when c.canonical_name ~ suffix
              and btrim(regexp_replace(c.canonical_name, suffix, '')) <> ''
               then regexp_replace(c.canonical_name, suffix, '')
             else c.canonical_name end,
           legal_name = case
             when c.legal_name ~ suffix
              and btrim(regexp_replace(c.legal_name, suffix, '')) <> ''
               then regexp_replace(c.legal_name, suffix, '')
             else c.legal_name end,
           version = c.version + 1
      from (select id, canonical_name ~ suffix as canonical_hit,
                   coalesce(legal_name ~ suffix, false) as legal_hit
              from core.companies) old_row
     where old_row.id = c.id
       and c.tenant_id in (select private.synthetic_demo_tenant_ids())
       and ((old_row.canonical_hit and btrim(regexp_replace(c.canonical_name, suffix, '')) <> '')
         or (old_row.legal_hit and btrim(regexp_replace(c.legal_name, suffix, '')) <> ''))
    returning c.id, c.tenant_id, c.organisation_id, c.version,
              old_row.canonical_hit, old_row.legal_hit
  )
  insert into audit.material_actions
    (event_id, tenant_id, actor_type, organisation_id, action_type,
     resource_type, resource_id, occurred_at, outcome, metadata)
  select gen_random_uuid(), x.tenant_id, 'capital_q_system', x.organisation_id,
         'company.updated', 'company', x.id::text, clock_timestamp(), 'SUCCEEDED',
         jsonb_build_object(
           'changedFields',
             to_jsonb(array_remove(array[
               case when x.canonical_hit then 'canonicalName' end,
               case when x.legal_hit then 'legalName' end], null)),
           'previousVersion', x.version - 1,
           'newVersion', x.version,
           'reason', 'synthetic_demo_name_suffix')
    from changed x;
  get diagnostics companies_n = row_count;

  -- Investor organisations: the display name.
  with changed as (
    update core.investor_organisations i
       set display_name = regexp_replace(i.display_name, suffix, ''),
           version = i.version + 1
     where i.tenant_id in (select private.synthetic_demo_tenant_ids())
       and i.display_name ~ suffix
       and btrim(regexp_replace(i.display_name, suffix, '')) <> ''
    returning i.id, i.tenant_id, i.organisation_id, i.version
  )
  insert into audit.material_actions
    (event_id, tenant_id, actor_type, organisation_id, action_type,
     resource_type, resource_id, occurred_at, outcome, metadata)
  select gen_random_uuid(), x.tenant_id, 'capital_q_system', x.organisation_id,
         'investor_organisation.updated', 'investor_organisation', x.id::text,
         clock_timestamp(), 'SUCCEEDED',
         jsonb_build_object(
           'changedFields', jsonb_build_array('displayName'),
           'previousVersion', x.version - 1,
           'newVersion', x.version,
           'reason', 'synthetic_demo_name_suffix')
    from changed x;
  get diagnostics investors_n = row_count;

  -- Workspace organisations: display and legal name (the slug stays).
  with changed as (
    update identity.organisations o
       set display_name = case
             when o.display_name ~ suffix
              and btrim(regexp_replace(o.display_name, suffix, '')) <> ''
               then regexp_replace(o.display_name, suffix, '')
             else o.display_name end,
           legal_name = case
             when o.legal_name ~ suffix
              and btrim(regexp_replace(o.legal_name, suffix, '')) <> ''
               then regexp_replace(o.legal_name, suffix, '')
             else o.legal_name end,
           version = o.version + 1
      from (select id, display_name ~ suffix as display_hit,
                   coalesce(legal_name ~ suffix, false) as legal_hit
              from identity.organisations) old_row
     where old_row.id = o.id
       and o.tenant_id in (select private.synthetic_demo_tenant_ids())
       and ((old_row.display_hit and btrim(regexp_replace(o.display_name, suffix, '')) <> '')
         or (old_row.legal_hit and btrim(regexp_replace(o.legal_name, suffix, '')) <> ''))
    returning o.id, o.tenant_id, o.version, old_row.display_hit, old_row.legal_hit
  )
  insert into audit.material_actions
    (event_id, tenant_id, actor_type, organisation_id, action_type,
     resource_type, resource_id, occurred_at, outcome, metadata)
  select gen_random_uuid(), x.tenant_id, 'capital_q_system', x.id,
         'organisation.updated', 'organisation', x.id::text, clock_timestamp(),
         'SUCCEEDED',
         jsonb_build_object(
           'changedFields',
             to_jsonb(array_remove(array[
               case when x.display_hit then 'displayName' end,
               case when x.legal_hit then 'legalName' end], null)),
           'previousVersion', x.version - 1,
           'newVersion', x.version,
           'reason', 'synthetic_demo_name_suffix')
    from changed x;
  get diagnostics organisations_n = row_count;

  -- Documents: the title, as the documents page's rename writes it (the
  -- document row's version moves; file versions are untouched).
  with changed as (
    update evidence.documents d
       set title = regexp_replace(d.title, suffix, ''),
           version = d.version + 1
     where d.tenant_id in (select private.synthetic_demo_tenant_ids())
       and d.title ~ suffix
       and btrim(regexp_replace(d.title, suffix, '')) <> ''
    returning d.id, d.tenant_id, d.owner_organisation_id, d.company_id, d.status
  )
  insert into audit.material_actions
    (event_id, tenant_id, actor_type, organisation_id, action_type,
     resource_type, resource_id, occurred_at, outcome, metadata)
  select gen_random_uuid(), x.tenant_id, 'capital_q_system',
         x.owner_organisation_id, 'document.details_changed', 'document',
         x.id::text, clock_timestamp(), 'SUCCEEDED',
         jsonb_build_object(
           'change', 'RENAME',
           'fromStatus', x.status,
           'toStatus', x.status,
           'companyId', x.company_id,
           'reason', 'synthetic_demo_name_suffix')
    from changed x;
  get diagnostics documents_n = row_count;

  return jsonb_build_object(
    'companies', companies_n,
    'investorOrganisations', investors_n,
    'organisations', organisations_n,
    'documents', documents_n);
end;
$$;

comment on function private.strip_synthetic_demo_name_suffix() is
  'Demo hygiene (2026-11-16): removes a trailing " (fictional)" from names and titles in tenants whose every member is a marked synthetic demo account. Idempotent; version bump and audit record per row; server-only.';

revoke all on function private.strip_synthetic_demo_name_suffix() from public, anon, authenticated;

select private.strip_synthetic_demo_name_suffix();
