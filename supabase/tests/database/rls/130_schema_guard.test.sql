-- CQ-SEC-004 · schema-wide protection guard.
--
-- A test-owned inventory classifies every table in the Capital Q
-- application schemas. The guard fails when:
--
--   * a table exists in those schemas but is not classified (the failure
--     message names it);
--   * the inventory names a table that no longer exists (stale inventory);
--   * a classified table does not have RLS enabled;
--   * anon holds any privilege, or authenticated holds privileges beyond
--     what the classification allows;
--   * a server-only table has any policy at all;
--   * a helper in `private` is not SECURITY DEFINER-safe (pinned search_path,
--     no EXECUTE for anon/PUBLIC).
--
-- Classification vocabulary (test architecture only; not the ADR-001
-- disclosure model):
--
--   RLS_REQUIRED          tenant/person-sensitive, reachable by authenticated
--                         through policies; must have negative cross-tenant tests
--   INTERNAL_SERVER_ONLY  written and read by the server only; no client role
--                         may touch it; still RLS-enabled as a second layer
--   PUBLIC_REFERENCE      reference data readable by authenticated; grants
--                         nothing
--
-- Every new migration that adds a table to identity, permissions, events,
-- audit (or a new application schema added to `guarded_schemas`) must add a
-- row here and, for RLS_REQUIRED, a suite under tests/database/rls.

begin;

create extension if not exists pgtap with schema extensions;

create temporary table guarded_schemas (schema_name text primary key) on commit drop;
insert into guarded_schemas values ('identity'), ('permissions'), ('events'), ('audit'), ('core');

create temporary table rls_inventory (
  schema_name text not null,
  table_name text not null,
  classification text not null check (classification in ('RLS_REQUIRED', 'INTERNAL_SERVER_ONLY', 'PUBLIC_REFERENCE')),
  -- Privileges authenticated is allowed to hold, as granted (policies decide rows).
  authenticated_privileges text[] not null,
  primary key (schema_name, table_name)
) on commit drop;

insert into rls_inventory (schema_name, table_name, classification, authenticated_privileges) values
  ('identity', 'user_profiles',            'RLS_REQUIRED',         '{SELECT}'),
  ('identity', 'tenants',                  'RLS_REQUIRED',         '{SELECT}'),
  ('identity', 'organisations',            'RLS_REQUIRED',         '{SELECT}'),
  ('identity', 'tenant_organisations',     'INTERNAL_SERVER_ONLY', '{}'),
  ('identity', 'organisation_memberships', 'RLS_REQUIRED',         '{SELECT}'),
  ('identity', 'user_active_contexts',     'RLS_REQUIRED',         '{SELECT}'),
  ('identity', 'membership_roles',         'RLS_REQUIRED',         '{SELECT}'),
  ('identity', 'organisation_creation_requests', 'INTERNAL_SERVER_ONLY', '{}'),
  ('core', 'companies',                    'RLS_REQUIRED',         '{SELECT}'),
  ('core', 'company_creation_requests',    'INTERNAL_SERVER_ONLY', '{}'),
  ('core', 'company_members',              'RLS_REQUIRED',         '{SELECT}'),
  ('core', 'founder_profiles',             'RLS_REQUIRED',         '{SELECT}'),
  ('core', 'company_team_facts',           'RLS_REQUIRED',         '{SELECT}'),
  ('permissions', 'capabilities',          'PUBLIC_REFERENCE',     '{SELECT}'),
  ('permissions', 'roles',                 'PUBLIC_REFERENCE',     '{SELECT}'),
  ('permissions', 'role_capabilities',     'PUBLIC_REFERENCE',     '{SELECT}'),
  ('permissions', 'grants',                'INTERNAL_SERVER_ONLY', '{}'),
  ('events', 'outbox',                     'INTERNAL_SERVER_ONLY', '{}'),
  ('audit', 'material_actions',            'INTERNAL_SERVER_ONLY', '{}'),
  ('audit', 'security_events',             'INTERNAL_SERVER_ONLY', '{}');

select plan(12);

-- Completeness ---------------------------------------------------------------

select is(
  (select coalesce(string_agg(t.schemaname || '.' || t.tablename, ', ' order by 1), '')
     from pg_tables t
     join guarded_schemas g on g.schema_name = t.schemaname
     left join rls_inventory i on i.schema_name = t.schemaname and i.table_name = t.tablename
    where i.table_name is null),
  '',
  'every table in a guarded schema is classified (unclassified tables are listed on failure)');

select is(
  (select coalesce(string_agg(i.schema_name || '.' || i.table_name, ', ' order by 1), '')
     from rls_inventory i
     left join pg_tables t on t.schemaname = i.schema_name and t.tablename = i.table_name
    where t.tablename is null),
  '',
  'the inventory names only tables that exist (stale entries are listed on failure)');

-- RLS enabled ------------------------------------------------------------------

select is(
  (select coalesce(string_agg(i.schema_name || '.' || i.table_name, ', ' order by 1), '')
     from rls_inventory i
     join pg_class c on c.relname = i.table_name
     join pg_namespace n on n.oid = c.relnamespace and n.nspname = i.schema_name
    where c.relkind = 'r' and not c.relrowsecurity),
  '',
  'every classified table has RLS enabled (a policy without RLS is still a failure)');

-- Grants -----------------------------------------------------------------------

select is(
  (select coalesce(string_agg(g.table_schema || '.' || g.table_name || ':' || g.privilege_type, ', ' order by 1), '')
     from information_schema.role_table_grants g
     join guarded_schemas s on s.schema_name = g.table_schema
    where g.grantee = 'anon'),
  '',
  'anon holds no table privilege in any guarded schema');

select is(
  (select coalesce(string_agg(g.table_schema || '.' || g.table_name || ':' || g.privilege_type, ', ' order by 1), '')
     from information_schema.role_table_grants g
     join rls_inventory i on i.schema_name = g.table_schema and i.table_name = g.table_name
    where g.grantee = 'authenticated'
      and not (g.privilege_type = any (i.authenticated_privileges))),
  '',
  'authenticated holds only the privileges the inventory allows');

select is(
  (select coalesce(string_agg(g.table_schema || '.' || g.table_name || ':' || g.grantee, ', ' order by 1), '')
     from information_schema.role_table_grants g
     join guarded_schemas s on s.schema_name = g.table_schema
    where g.grantee in ('anon', 'authenticated', 'public')
      and g.privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER')),
  '',
  'no browser principal can write, truncate or reference any guarded table');

select is(
  (select coalesce(string_agg(i.schema_name || '.' || i.table_name || ':' || p.policyname, ', ' order by 1), '')
     from rls_inventory i
     join pg_policies p on p.schemaname = i.schema_name and p.tablename = i.table_name
    where i.classification = 'INTERNAL_SERVER_ONLY'),
  '',
  'server-only tables carry no policies at all');

select ok(not has_schema_privilege('anon', 'private', 'usage') and not has_schema_privilege('anon', 'pgmq', 'usage'),
  'anon has no usage on private or pgmq');
select ok(not has_schema_privilege('authenticated', 'events', 'usage')
      and not has_schema_privilege('authenticated', 'audit', 'usage')
      and not has_schema_privilege('authenticated', 'pgmq', 'usage'),
  'authenticated has no usage on events, audit or pgmq');

-- SECURITY DEFINER helpers -----------------------------------------------------

select is(
  (select coalesce(string_agg(p.proname, ', ' order by 1), '')
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and not (coalesce(p.proconfig, '{}'::text[]) @> array['search_path=""'])),
  '',
  'every function in private pins search_path to empty (offenders listed on failure)');

select is(
  (select coalesce(string_agg(p.proname, ', ' order by 1), '')
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('public', p.oid, 'execute'))),
  '',
  'no function in private is executable by anon or PUBLIC');

select is(
  (select coalesce(string_agg(p.proname, ', ' order by 1), '')
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.prosecdef
      and p.proname not in ('handle_new_auth_user', 'current_app_user_id', 'is_tenant_member', 'is_organisation_member')),
  '',
  'the set of SECURITY DEFINER helpers is exactly the reviewed set (new ones are listed on failure)');

select * from finish();

rollback;
