-- GateQ inbox outbound email (20261231598700): an approved answer keeps the
-- subject and the recipient (as a hash) it was approved for, and one
-- append-only delivery outcome, recipient domain only.
--
-- EXPECTED DB BEHAVIOUR: the privileged server role reads and writes; no
-- browser principal reaches the delivery table. APPLICATION AUTHORISATION
-- (GateQ's investor.gateway.edit) IS STILL REQUIRED: DB BYPASS ≠ BUSINESS
-- AUTHORISATION.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(17);

-- Fixtures: a gateway in tenant B with one submitted application, and one in tenant A.
insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name) values
  ('00000000-0000-4000-8000-00000000ef01', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 'VC', 'Kilima Angel Network (fictional)'),
  ('00000000-0000-4000-8000-00000000ef02', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'VC', 'Other Fund (fictional)');

insert into gateq.gateways (id, tenant_id, investor_organisation_id, organisation_id, public_id, name, created_by_user_id) values
  ('00000000-0000-4000-8000-00000000ef11', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-00000000ef01', pg_temp.rls_id('org_b'),
   'gq_ef3456789abcdefghjkmnpqrs0', 'Seed gate', pg_temp.rls_id('user_b')),
  ('00000000-0000-4000-8000-00000000ef12', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-00000000ef02', pg_temp.rls_id('org_a'),
   'gq_ef3456789abcdefghjkmnpqrs9', 'Other gate', pg_temp.rls_id('user_a'));

insert into gateq.gateway_versions
  (id, gateway_id, tenant_id, version_number, status, inbound_mode, public_title, qualification_policy_version,
   created_by_user_id, published_by_user_id, published_at)
values
  ('00000000-0000-4000-8000-00000000ef21', '00000000-0000-4000-8000-00000000ef11', pg_temp.rls_id('tenant_b'), 1,
   'PUBLISHED', 'QUALIFIED', 'Seed', 'gateq-qualification.v1', pg_temp.rls_id('user_b'), pg_temp.rls_id('user_b'), now()),
  ('00000000-0000-4000-8000-00000000ef22', '00000000-0000-4000-8000-00000000ef12', pg_temp.rls_id('tenant_a'), 1,
   'PUBLISHED', 'QUALIFIED', 'Other', 'gateq-qualification.v1', pg_temp.rls_id('user_a'), pg_temp.rls_id('user_a'), now());

insert into gateq.applications (id, tenant_id, gateway_id, gateway_version_id, public_reference) values
  ('00000000-0000-4000-8000-00000000ef31', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-00000000ef11',
   '00000000-0000-4000-8000-00000000ef21', 'ga_ef3456789abcdefghjkmnpqrs1'),
  ('00000000-0000-4000-8000-00000000ef32', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-00000000ef12',
   '00000000-0000-4000-8000-00000000ef22', 'ga_ef3456789abcdefghjkmnpqrs2');

insert into gateq.application_submissions
  (application_id, tenant_id, gateway_version_id, snapshot, qualification, client_request_id)
values
  ('00000000-0000-4000-8000-00000000ef31', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-00000000ef21',
   '{"reference":"ga_ef3456789abcdefghjkmnpqrs1"}'::jsonb, '{"outcome":"QUALIFIED"}'::jsonb, 'req-ef00000001'),
  ('00000000-0000-4000-8000-00000000ef32', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-00000000ef22',
   '{"reference":"ga_ef3456789abcdefghjkmnpqrs2"}'::jsonb, '{"outcome":"QUALIFIED"}'::jsonb, 'req-ef00000002');

-- Shape -----------------------------------------------------------------------------------
select has_column('gateq', 'inbox_messages', 'subject', 'an approved answer keeps its subject');
select has_column('gateq', 'inbox_messages', 'recipient_sha256', 'and the recipient it was approved for, hashed');
select has_table('gateq', 'inbox_message_deliveries', 'what became of each email is kept');
select is((select relrowsecurity from pg_class where oid = 'gateq.inbox_message_deliveries'::regclass), true,
  'row level security is on for deliveries');
select is((select count(*)::int from information_schema.role_table_grants
            where table_schema = 'gateq' and table_name = 'inbox_message_deliveries'
              and grantee in ('anon', 'authenticated')), 0,
  'neither anon nor authenticated holds any grant on deliveries');

-- Positive: the privileged server path ---------------------------------------------------
select lives_ok($$
  insert into gateq.inbox_messages
    (id, application_id, tenant_id, kind, reason_code, body, body_sha256, approved_by_user_id, client_request_id, subject, recipient_sha256)
  values ('00000000-0000-4000-8000-00000000ef41', '00000000-0000-4000-8000-00000000ef31', pg_temp.rls_id('tenant_b'),
          'REPLY', null, 'Could you share a time for a call?', repeat('a', 64), pg_temp.rls_id('user_b'),
          'reply-ef0000001', 'Kilima Angel Network replied about Sunline', repeat('d', 64))
$$, 'a reply is recorded with its subject and recipient hash');
select lives_ok($$
  insert into gateq.inbox_messages
    (id, application_id, tenant_id, kind, reason_code, body, body_sha256, approved_by_user_id, client_request_id)
  values ('00000000-0000-4000-8000-00000000ef42', '00000000-0000-4000-8000-00000000ef31', pg_temp.rls_id('tenant_b'),
          'REPLY', null, 'An older reply', repeat('b', 64), pg_temp.rls_id('user_b'), 'reply-ef0000002')
$$, 'a message without them (as before this migration) still records');
select throws_ok($$
  insert into gateq.inbox_messages
    (application_id, tenant_id, kind, reason_code, body, body_sha256, approved_by_user_id, client_request_id, subject)
  values ('00000000-0000-4000-8000-00000000ef31', pg_temp.rls_id('tenant_b'), 'REPLY', null, 'x', repeat('c', 64),
          pg_temp.rls_id('user_b'), 'reply-ef0000003', E'Two\nlines')
$$, '23514', null, 'a subject is one line');
select throws_ok($$
  insert into gateq.inbox_messages
    (application_id, tenant_id, kind, reason_code, body, body_sha256, approved_by_user_id, client_request_id, recipient_sha256)
  values ('00000000-0000-4000-8000-00000000ef31', pg_temp.rls_id('tenant_b'), 'REPLY', null, 'x', repeat('c', 64),
          pg_temp.rls_id('user_b'), 'reply-ef0000004', 'founder@sunline.example')
$$, '23514', null, 'the recipient is kept only as a hash, never the address');

select lives_ok($$
  insert into gateq.inbox_message_deliveries (message_id, application_id, tenant_id, outcome, recipient_domain)
  values ('00000000-0000-4000-8000-00000000ef41', '00000000-0000-4000-8000-00000000ef31', pg_temp.rls_id('tenant_b'),
          'SUPPRESSED', 'sunline.example')
$$, 'a delivery outcome is recorded for its message');
select throws_ok($$
  insert into gateq.inbox_message_deliveries (message_id, application_id, tenant_id, outcome, recipient_domain)
  values ('00000000-0000-4000-8000-00000000ef41', '00000000-0000-4000-8000-00000000ef31', pg_temp.rls_id('tenant_b'),
          'SENT', 'sunline.example')
$$, '23505', null, 'one outcome per message: a send is never silently re-recorded');
select throws_ok($$
  insert into gateq.inbox_message_deliveries (message_id, application_id, tenant_id, outcome)
  values ('00000000-0000-4000-8000-00000000ef42', '00000000-0000-4000-8000-00000000ef31', pg_temp.rls_id('tenant_b'), 'OPENED')
$$, '23514', null, 'outcomes are a closed set');

-- Cross-tenant integrity ------------------------------------------------------------------------
select throws_ok($$
  insert into gateq.inbox_message_deliveries (message_id, application_id, tenant_id, outcome)
  values ('00000000-0000-4000-8000-00000000ef42', '00000000-0000-4000-8000-00000000ef32', pg_temp.rls_id('tenant_a'), 'SENT')
$$, '23514', null, 'cross-tenant: a delivery cannot be filed under another tenant''s application');

-- History is never rewritten ---------------------------------------------------------------------
select throws_ok($$
  update gateq.inbox_message_deliveries set outcome = 'SENT'
   where message_id = '00000000-0000-4000-8000-00000000ef41'
$$, '23001', null, 'an outcome is never rewritten');
select throws_ok($$
  update gateq.inbox_messages set subject = 'Edited after approval'
   where id = '00000000-0000-4000-8000-00000000ef41'
$$, '23001', null, 'nor is an approved subject');

-- Negative: browser principals ----------------------------------------------------------------
select pg_temp.act_as_user_b();
select throws_ok($$ select count(*) from gateq.inbox_message_deliveries $$, '42501', null,
  'even the owning tenant''s member reads deliveries only through the API');
select pg_temp.reset_test_identity();

select pg_temp.act_as_revoked_user();
select throws_ok($$ select count(*) from gateq.inbox_message_deliveries $$, '42501', null,
  'a revoked member reaches nothing');
select pg_temp.reset_test_identity();

select * from finish();
rollback;
