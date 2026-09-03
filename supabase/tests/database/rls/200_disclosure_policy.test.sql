-- CQ-PERM-001 · permissions.disclosure_policies: server-only ACL with
-- structural invariants.
--
-- The table stores deliberate disclosure state as facts; it never decides.
-- Every check here is about shape (owner present, recipient by scope,
-- canonical vocabulary, one active grant per window, history never
-- deleted) and about exposure (no browser principal, no service_role).
-- The privileged server role reading rows is infrastructure, not
-- authorisation: DB BYPASS ≠ BUSINESS AUTHORISATION.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(36);

-- Company A (tenant A / org A) owns a company; investor B (tenant B / org B).
insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug) values
  ('00000000-0000-4000-8000-0000000000c1', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'Company A', 'company-a');

-- Vocabulary -----------------------------------------------------------------
select ok(exists (select 1 from permissions.capabilities where code = 'disclosure.manage' and status = 'active'),
  'disclosure.manage exists as production reference data');
select ok(exists (select 1 from permissions.capabilities where code = 'disclosure.inspect' and status = 'active'),
  'disclosure.inspect exists as production reference data');
select results_eq(
  $$ select c.code from permissions.role_capabilities rc
       join permissions.roles r on r.id = rc.role_id
       join permissions.capabilities c on c.id = rc.capability_id
      where r.code = 'organisation_admin' and c.code like 'disclosure.%' and rc.effect = 'ALLOW'
      order by 1 $$,
  $$ values ('disclosure.inspect'), ('disclosure.manage') $$,
  'organisation_admin maps to disclosure.manage and disclosure.inspect');
select is((select count(*)::int from permissions.role_capabilities rc
             join permissions.roles r on r.id = rc.role_id
             join permissions.capabilities c on c.id = rc.capability_id
            where r.code = 'organisation_member' and c.code like 'disclosure.%'), 0,
  'organisation_member holds no disclosure authority');

-- Structural invariants ------------------------------------------------------
select lives_ok(
  $$ insert into permissions.disclosure_policies (id, tenant_id, owner_organisation_id, resource_type, resource_id, scope_type, recipient_type, recipient_id, access_level, created_by_user_id)
     values ('00000000-0000-4000-8000-00000000d001', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'company', '00000000-0000-4000-8000-0000000000c1', 'specifically_shared', 'ORGANISATION', pg_temp.rls_id('org_b'), 'view', pg_temp.rls_id('user_a')) $$,
  'a specific share to an organisation in another tenant is a valid policy');
select throws_ok(
  $$ insert into permissions.disclosure_policies (tenant_id, resource_type, resource_id, scope_type, access_level, created_by_user_id)
     values (pg_temp.rls_id('tenant_a'), 'company', '00000000-0000-4000-8000-0000000000c1', 'network_visible', 'view', pg_temp.rls_id('user_a')) $$,
  '23514', null, 'a policy without any owner is refused');
select throws_ok(
  $$ insert into permissions.disclosure_policies (tenant_id, owner_organisation_id, resource_type, resource_id, scope_type, access_level, created_by_user_id)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'company', '00000000-0000-4000-8000-0000000000c1', 'personal_private', 'view', pg_temp.rls_id('user_a')) $$,
  '23514', null, 'personal_private requires a Person owner (owner_user_id)');
select throws_ok(
  $$ insert into permissions.disclosure_policies (tenant_id, owner_organisation_id, resource_type, resource_id, scope_type, access_level, created_by_user_id)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'company', '00000000-0000-4000-8000-0000000000c1', 'specifically_shared', 'view', pg_temp.rls_id('user_a')) $$,
  '23514', null, 'specifically_shared requires a recipient');
select throws_ok(
  $$ insert into permissions.disclosure_policies (tenant_id, owner_organisation_id, resource_type, resource_id, scope_type, recipient_type, recipient_id, access_level, created_by_user_id)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'company', '00000000-0000-4000-8000-0000000000c1', 'relationship_shared', 'ORGANISATION', pg_temp.rls_id('org_b'), 'view', pg_temp.rls_id('user_a')) $$,
  '23514', null, 'relationship_shared names the exact relationship (RELATIONSHIP recipient), nothing else');
select throws_ok(
  $$ insert into permissions.disclosure_policies (tenant_id, owner_organisation_id, resource_type, resource_id, scope_type, recipient_type, recipient_id, access_level, created_by_user_id)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'company', '00000000-0000-4000-8000-0000000000c1', 'network_visible', 'ORGANISATION', pg_temp.rls_id('org_b'), 'view', pg_temp.rls_id('user_a')) $$,
  '23514', null, 'broad scopes carry no recipient');
select throws_ok(
  $$ insert into permissions.disclosure_policies (tenant_id, owner_organisation_id, resource_type, resource_id, scope_type, recipient_type, access_level, created_by_user_id)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'company', '00000000-0000-4000-8000-0000000000c1', 'specifically_shared', 'USER', 'view', pg_temp.rls_id('user_a')) $$,
  '23514', null, 'recipient type and id travel together');
select throws_ok(
  $$ insert into permissions.disclosure_policies (tenant_id, owner_organisation_id, resource_type, resource_id, scope_type, access_level, created_by_user_id)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'company', '00000000-0000-4000-8000-0000000000c1', 'public', 'view', pg_temp.rls_id('user_a')) $$,
  '23514', null, 'legacy "public" is not a scope; public_external is canonical');
select throws_ok(
  $$ insert into permissions.disclosure_policies (tenant_id, owner_organisation_id, resource_type, resource_id, scope_type, access_level, created_by_user_id)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'company', '00000000-0000-4000-8000-0000000000c1', 'owner_private', 'view', pg_temp.rls_id('user_a')) $$,
  '23514', null, 'owner_private does not exist');
select throws_ok(
  $$ insert into permissions.disclosure_policies (tenant_id, owner_organisation_id, resource_type, resource_id, scope_type, access_level, created_by_user_id)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'company', '00000000-0000-4000-8000-0000000000c1', 'network_visible', 'edit', pg_temp.rls_id('user_a')) $$,
  '23514', null, 'access levels are view / view_download only; edit is a capability');
select throws_ok(
  $$ insert into permissions.disclosure_policies (tenant_id, owner_organisation_id, resource_type, resource_id, scope_type, recipient_type, recipient_id, access_level, created_by_user_id)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'company', '00000000-0000-4000-8000-0000000000c1', 'specifically_shared', 'EMAIL', gen_random_uuid(), 'view', pg_temp.rls_id('user_a')) $$,
  '23514', null, 'recipient vocabulary is USER / MEMBERSHIP / ORGANISATION / RELATIONSHIP');
select throws_ok(
  $$ insert into permissions.disclosure_policies (tenant_id, owner_organisation_id, resource_type, resource_id, scope_type, access_level, created_by_user_id, expires_at)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'company', '00000000-0000-4000-8000-0000000000c1', 'network_visible', 'view', pg_temp.rls_id('user_a'), now() - interval '1 day') $$,
  '23514', null, 'expiry cannot precede creation');
select throws_ok(
  $$ insert into permissions.disclosure_policies (tenant_id, owner_organisation_id, resource_type, resource_id, scope_type, access_level, created_by_user_id)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'Company', '00000000-0000-4000-8000-0000000000c1', 'network_visible', 'view', pg_temp.rls_id('user_a')) $$,
  '23514', null, 'resource_type is bounded lower_snake text');

-- One active grant per validity window --------------------------------------
select throws_ok(
  $$ insert into permissions.disclosure_policies (tenant_id, owner_organisation_id, resource_type, resource_id, scope_type, recipient_type, recipient_id, access_level, created_by_user_id)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'company', '00000000-0000-4000-8000-0000000000c1', 'specifically_shared', 'ORGANISATION', pg_temp.rls_id('org_b'), 'view', pg_temp.rls_id('user_a')) $$,
  '23P01', null, 'a second active identical share is refused');
select lives_ok(
  $$ insert into permissions.disclosure_policies (id, tenant_id, owner_organisation_id, resource_type, resource_id, scope_type, access_level, created_by_user_id)
     values ('00000000-0000-4000-8000-00000000d002', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'company', '00000000-0000-4000-8000-0000000000c1', 'network_visible', 'view', pg_temp.rls_id('user_a')) $$,
  'a broad-scope policy coexists with a specific share');
select throws_ok(
  $$ insert into permissions.disclosure_policies (tenant_id, owner_organisation_id, resource_type, resource_id, scope_type, access_level, created_by_user_id)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'company', '00000000-0000-4000-8000-0000000000c1', 'network_visible', 'view', pg_temp.rls_id('user_a')) $$,
  '23P01', null, 'duplicate broad-scope policies are caught despite NULL recipients');
-- An expired-but-unrevoked grant does not block its replacement (§183).
insert into permissions.disclosure_policies (id, tenant_id, owner_organisation_id, resource_type, resource_id, scope_type, recipient_type, recipient_id, access_level, created_by_user_id, created_at, expires_at)
  values ('00000000-0000-4000-8000-00000000d003', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'company', '00000000-0000-4000-8000-0000000000c1', 'specifically_shared', 'USER', pg_temp.rls_id('user_b'), 'view_download', pg_temp.rls_id('user_a'), now() - interval '40 days', now() - interval '10 days');
select lives_ok(
  $$ insert into permissions.disclosure_policies (id, tenant_id, owner_organisation_id, resource_type, resource_id, scope_type, recipient_type, recipient_id, access_level, created_by_user_id)
     values ('00000000-0000-4000-8000-00000000d004', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'company', '00000000-0000-4000-8000-0000000000c1', 'specifically_shared', 'USER', pg_temp.rls_id('user_b'), 'view_download', pg_temp.rls_id('user_a')) $$,
  'an expired grant never blocks a legitimate replacement grant');
select is((select count(*)::int from permissions.disclosure_policies where id in ('00000000-0000-4000-8000-00000000d003', '00000000-0000-4000-8000-00000000d004')), 2,
  'the expired row stays as history next to its replacement');
-- Revocation is a timestamp; re-sharing after revocation is allowed.
update permissions.disclosure_policies set revoked_at = clock_timestamp() where id = '00000000-0000-4000-8000-00000000d001';
select lives_ok(
  $$ insert into permissions.disclosure_policies (id, tenant_id, owner_organisation_id, resource_type, resource_id, scope_type, recipient_type, recipient_id, access_level, created_by_user_id)
     values ('00000000-0000-4000-8000-00000000d005', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'company', '00000000-0000-4000-8000-0000000000c1', 'specifically_shared', 'ORGANISATION', pg_temp.rls_id('org_b'), 'view', pg_temp.rls_id('user_a')) $$,
  'after revocation a deliberate new share is accepted (P1 revoked history, P2 active)');
select is((select revoked_at is not null from permissions.disclosure_policies where id = '00000000-0000-4000-8000-00000000d001'), true,
  'the revoked policy remains as history');
select throws_ok(
  $$ update permissions.disclosure_policies set revoked_at = created_at - interval '1 second' where id = '00000000-0000-4000-8000-00000000d005' $$,
  '23514', null, 'revocation cannot precede creation');

-- No secrets: the table has only reference/policy columns ----------------------
select is(
  (select coalesce(string_agg(column_name, ', ' order by column_name), '')
     from information_schema.columns
    where table_schema = 'permissions' and table_name = 'disclosure_policies'
      and column_name ~* 'body|text|content|url|token|secret|prompt|message|password'),
  '',
  'the policy table carries no document body, message text, signed URL, token or prompt column');

-- Exposure -------------------------------------------------------------------
select pg_temp.act_as_user_a();
select throws_ok($$ select * from permissions.disclosure_policies $$, '42501', null, 'owner-side user A has no raw ACL access');
select throws_ok($$ insert into permissions.disclosure_policies (tenant_id, owner_organisation_id, resource_type, resource_id, scope_type, access_level, created_by_user_id) values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'company', '00000000-0000-4000-8000-0000000000c1', 'public_external', 'view', pg_temp.rls_id('user_a')) $$, '42501', null, 'user A cannot insert a policy directly');
select throws_ok($$ update permissions.disclosure_policies set access_level = 'view_download' $$, '42501', null, 'user A cannot escalate an access level');
select throws_ok($$ delete from permissions.disclosure_policies $$, '42501', null, 'user A cannot delete history');
select pg_temp.act_as_user_b();
select throws_ok($$ select * from permissions.disclosure_policies $$, '42501', null, 'recipient-side user B cannot read the ACL either');
select throws_ok($$ update permissions.disclosure_policies set revoked_at = null $$, '42501', null, 'user B cannot un-revoke');
select pg_temp.act_as_anonymous();
select throws_ok($$ select * from permissions.disclosure_policies $$, '42501', null, 'anonymous denied');
select pg_temp.act_as_service_role();
select throws_ok($$ select * from permissions.disclosure_policies $$, '42501', null, 'service_role holds no grant on the ACL');

-- Privileged server role: EXPECTED DB BEHAVIOUR; DB BYPASS ≠ BUSINESS AUTHORISATION.
select pg_temp.act_as_privileged();
select is((select count(*)::int from permissions.disclosure_policies), 5, 'privileged: the server role reads the policies (infrastructure, not authorisation)');
select is((select count(*)::int from information_schema.tables where table_schema = 'permissions' and table_name in ('data_rooms', 'data_room_items', 'data_room_access_grants')), 0,
  'no Data Room tables exist yet (CQ-DR packets)');

select * from finish();

rollback;
