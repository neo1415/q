-- F4 · the investor's GateQ inbox: triage state, team notes, approved
-- messages and the activity trail around a submitted application.
--
--   a submitted application ≠ a CRM record;  the submission stays immutable
--   team notes are organisation_private
--   a pass carries a reason, and what was approved is never rewritten
--
-- EXPECTED DB BEHAVIOUR: the privileged server role reads and writes; no
-- browser principal reaches any table. APPLICATION AUTHORISATION (GateQ's
-- investor.gateway.view / .edit) IS STILL REQUIRED: DB BYPASS ≠ BUSINESS
-- AUTHORISATION.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(26);

-- Fixtures: a gateway in tenant B with one submitted and one draft application ---------
insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name) values
  ('00000000-0000-4000-8000-00000000ee01', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 'VC', 'Inbox Capital');

insert into gateq.gateways (id, tenant_id, investor_organisation_id, organisation_id, public_id, name, created_by_user_id) values
  ('00000000-0000-4000-8000-00000000ee11', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-00000000ee01', pg_temp.rls_id('org_b'),
   'gq_ee3456789abcdefghjkmnpqrs0', 'Seed gate', pg_temp.rls_id('user_b'));

insert into gateq.gateway_versions
  (id, gateway_id, tenant_id, version_number, status, inbound_mode, public_title, qualification_policy_version,
   created_by_user_id, published_by_user_id, published_at)
values
  ('00000000-0000-4000-8000-00000000ee21', '00000000-0000-4000-8000-00000000ee11', pg_temp.rls_id('tenant_b'), 1,
   'PUBLISHED', 'QUALIFIED', 'Seed', 'gateq-qualification.v1', pg_temp.rls_id('user_b'), pg_temp.rls_id('user_b'), now());

insert into gateq.applications (id, tenant_id, gateway_id, gateway_version_id, public_reference) values
  ('00000000-0000-4000-8000-00000000ee31', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-00000000ee11',
   '00000000-0000-4000-8000-00000000ee21', 'ga_ee3456789abcdefghjkmnpqrs1'),
  ('00000000-0000-4000-8000-00000000ee32', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-00000000ee11',
   '00000000-0000-4000-8000-00000000ee21', 'ga_ee3456789abcdefghjkmnpqrs2');

insert into gateq.application_submissions
  (application_id, tenant_id, gateway_version_id, snapshot, qualification, client_request_id)
values
  ('00000000-0000-4000-8000-00000000ee31', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-00000000ee21',
   '{"reference":"ga_ee3456789abcdefghjkmnpqrs1"}'::jsonb, '{"outcome":"QUALIFIED"}'::jsonb, 'req-ee00000001');

-- Shape -----------------------------------------------------------------------------------
select has_table('gateq', 'inbox_items', 'triage state exists');
select has_table('gateq', 'inbox_notes', 'team notes exist');
select has_table('gateq', 'inbox_messages', 'approved messages exist');
select is((select bool_and(relrowsecurity) from pg_class
            where oid in ('gateq.inbox_settings'::regclass, 'gateq.inbox_items'::regclass,
                          'gateq.inbox_user_state'::regclass, 'gateq.inbox_labels'::regclass,
                          'gateq.inbox_item_labels'::regclass, 'gateq.inbox_notes'::regclass,
                          'gateq.pass_reasons'::regclass, 'gateq.inbox_messages'::regclass,
                          'gateq.inbox_activity'::regclass)), true,
  'row level security is on for all nine');
select is((select count(*)::int from pg_policies where schemaname = 'gateq' and tablename like 'inbox%'), 0,
  'and there is no policy: the inbox is read through the API only');
select is((select count(*)::int from information_schema.role_table_grants
            where table_schema = 'gateq' and table_name in ('inbox_settings', 'inbox_items', 'inbox_user_state',
              'inbox_labels', 'inbox_item_labels', 'inbox_notes', 'pass_reasons', 'inbox_messages', 'inbox_activity')
              and grantee in ('anon', 'authenticated')), 0,
  'neither anon nor authenticated holds any grant');

-- Positive: the privileged server path ---------------------------------------------------
insert into gateq.inbox_items (application_id, tenant_id, gateway_id, folder, assignee_user_id) values
  ('00000000-0000-4000-8000-00000000ee31', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-00000000ee11', 'INBOX', pg_temp.rls_id('user_b'));
insert into gateq.inbox_user_state (application_id, user_id, tenant_id, starred) values
  ('00000000-0000-4000-8000-00000000ee31', pg_temp.rls_id('user_b'), pg_temp.rls_id('tenant_b'), true);
insert into gateq.inbox_labels (id, tenant_id, gateway_id, name, created_by_user_id) values
  ('00000000-0000-4000-8000-00000000ee41', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-00000000ee11', 'IC next week', pg_temp.rls_id('user_b'));
insert into gateq.inbox_item_labels (application_id, label_id, tenant_id) values
  ('00000000-0000-4000-8000-00000000ee31', '00000000-0000-4000-8000-00000000ee41', pg_temp.rls_id('tenant_b'));
insert into gateq.inbox_notes (id, application_id, tenant_id, author_user_id, body, client_request_id) values
  ('00000000-0000-4000-8000-00000000ee51', '00000000-0000-4000-8000-00000000ee31', pg_temp.rls_id('tenant_b'),
   pg_temp.rls_id('user_b'), 'Sharp on unit economics.', 'note-ee0000001');

select is((select count(*)::int from gateq.inbox_items where gateway_id = '00000000-0000-4000-8000-00000000ee11'), 1,
  'the server reads its triage state');
select is((select starred from gateq.inbox_user_state where application_id = '00000000-0000-4000-8000-00000000ee31'), true,
  'a star is kept per person');

-- Only a submitted application has an inbox life ---------------------------------------------
select throws_ok($$
  insert into gateq.inbox_items (application_id, tenant_id, gateway_id)
  values ('00000000-0000-4000-8000-00000000ee32', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-00000000ee11')
$$, '23514', null, 'a draft the founder never sent cannot reach the inbox');
select throws_ok($$
  insert into gateq.inbox_notes (application_id, tenant_id, author_user_id, body, client_request_id)
  values ('00000000-0000-4000-8000-00000000ee32', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b'), 'x', 'note-ee0000009')
$$, '23514', null, 'nor can a note on one');

-- Cross-tenant integrity ------------------------------------------------------------------------
select throws_ok($$
  insert into gateq.inbox_user_state (application_id, user_id, tenant_id, starred)
  values ('00000000-0000-4000-8000-00000000ee31', pg_temp.rls_id('user_a'), pg_temp.rls_id('tenant_a'), true)
$$, '23514', null, 'cross-tenant: state cannot be filed under another tenant');
select throws_ok($$
  insert into gateq.inbox_notes (application_id, tenant_id, author_user_id, body, client_request_id)
  values ('00000000-0000-4000-8000-00000000ee31', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 'x', 'note-ee0000002')
$$, '23514', null, 'cross-tenant: nor a note');
select throws_ok($$
  insert into gateq.inbox_labels (tenant_id, gateway_id, name, created_by_user_id)
  values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-00000000ee11', 'Mine', pg_temp.rls_id('user_a'))
$$, '23514', null, 'cross-tenant: nor a label on another tenant''s gateway');
select throws_ok($$
  insert into gateq.inbox_labels (tenant_id, gateway_id, name, created_by_user_id)
  values (pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-00000000ee11', ' ic NEXT week ', pg_temp.rls_id('user_b'))
$$, '23505', null, 'one label per name per gateway, whatever the case');

-- Messages: a pass needs a reason, a reply has none; one pass; idempotent -----------------------
select throws_ok($$
  insert into gateq.inbox_messages (application_id, tenant_id, kind, reason_code, body, body_sha256, approved_by_user_id, client_request_id)
  values ('00000000-0000-4000-8000-00000000ee31', pg_temp.rls_id('tenant_b'), 'PASS', null, 'No thanks', repeat('a', 64),
          pg_temp.rls_id('user_b'), 'pass-ee0000001')
$$, '23514', null, 'a pass without a reason is refused: founders always get one');
select throws_ok($$
  insert into gateq.inbox_messages (application_id, tenant_id, kind, reason_code, body, body_sha256, approved_by_user_id, client_request_id)
  values ('00000000-0000-4000-8000-00000000ee31', pg_temp.rls_id('tenant_b'), 'PASS', 'NOT_A_REASON', 'No thanks', repeat('a', 64),
          pg_temp.rls_id('user_b'), 'pass-ee0000001')
$$, '23503', null, 'and the reason is reference data, not free text');
select lives_ok($$
  insert into gateq.inbox_messages (application_id, tenant_id, kind, reason_code, body, body_sha256, approved_by_user_id, client_request_id)
  values ('00000000-0000-4000-8000-00000000ee31', pg_temp.rls_id('tenant_b'), 'PASS', 'TIMING', 'Not this year, thank you.', repeat('b', 64),
          pg_temp.rls_id('user_b'), 'pass-ee0000002')
$$, 'a pass with a reason is recorded');
select throws_ok($$
  insert into gateq.inbox_messages (application_id, tenant_id, kind, reason_code, body, body_sha256, approved_by_user_id, client_request_id)
  values ('00000000-0000-4000-8000-00000000ee31', pg_temp.rls_id('tenant_b'), 'PASS', 'OTHER', 'Again', repeat('c', 64),
          pg_temp.rls_id('user_b'), 'pass-ee0000003')
$$, '23505', null, 'and there is only ever one pass');
select throws_ok($$
  update gateq.inbox_messages set body = 'Edited after approval'
   where application_id = '00000000-0000-4000-8000-00000000ee31'
$$, '23001', null, 'what was approved is never rewritten');
select throws_ok($$
  delete from gateq.inbox_notes where id = '00000000-0000-4000-8000-00000000ee51'
$$, '23001', null, 'nor is a team note deleted');

-- The submission itself is untouched by triage -----------------------------------------------------
select throws_ok($$
  update gateq.application_submissions set snapshot = '{}'::jsonb
   where application_id = '00000000-0000-4000-8000-00000000ee31'
$$, '23001', null, 'triage never rewrites what the founder sent');

-- Negative: browser principals ----------------------------------------------------------------
select pg_temp.act_as_user_a();
select throws_ok($$ select count(*) from gateq.inbox_notes $$, '42501', null,
  'cross-tenant: user A cannot read tenant B''s team notes');
select throws_ok($$ select count(*) from gateq.inbox_items $$, '42501', null,
  'nor its triage state');
select pg_temp.reset_test_identity();

select pg_temp.act_as_user_b();
select throws_ok($$ select count(*) from gateq.inbox_messages $$, '42501', null,
  'even the owning tenant''s member reads the inbox only through the API');
select pg_temp.reset_test_identity();

select pg_temp.act_as_anonymous();
select throws_ok($$ select count(*) from gateq.inbox_user_state $$, '42501', null,
  'an anonymous visitor reaches nothing');
select throws_ok($$ select count(*) from gateq.pass_reasons $$, '42501', null,
  'not even the reference data');
select pg_temp.reset_test_identity();

select * from finish();
rollback;
