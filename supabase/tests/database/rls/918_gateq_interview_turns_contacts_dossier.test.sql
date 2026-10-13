-- GateQ slice 1 · the interview transcript, the applicant's contact and the
-- submission dossier: server-only, append-only where it must be, and the
-- submission still written once.
--
-- EXPECTED DB BEHAVIOUR: the privileged server role can read every row.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(23);

-- Fixtures ------------------------------------------------------------------------
insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name) values
  ('00000000-0000-4000-8000-00000000dd01', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 'VC', 'Interview Capital');

insert into gateq.gateways (id, tenant_id, investor_organisation_id, organisation_id, public_id, name, created_by_user_id) values
  ('00000000-0000-4000-8000-00000000dd11', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-00000000dd01', pg_temp.rls_id('org_b'),
   'gq_23456789abcdefghjkmnpqrs01', 'Seed programme', pg_temp.rls_id('user_b'));

insert into gateq.gateway_versions
  (id, gateway_id, tenant_id, version_number, status, inbound_mode, public_title, qualification_policy_version,
   created_by_user_id, published_by_user_id, published_at)
values
  ('00000000-0000-4000-8000-00000000dd21', '00000000-0000-4000-8000-00000000dd11', pg_temp.rls_id('tenant_b'), 1,
   'PUBLISHED', 'QUALIFIED', 'Seed-stage fintech', 'gateq-qualification.v1',
   pg_temp.rls_id('user_b'), pg_temp.rls_id('user_b'), now());

insert into gateq.applications (id, tenant_id, gateway_id, gateway_version_id, public_reference) values
  ('00000000-0000-4000-8000-00000000dd31', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-00000000dd11',
   '00000000-0000-4000-8000-00000000dd21', 'ga_23456789abcdefghjkmnpqrs01');

-- Shape ------------------------------------------------------------------------------
select has_table('gateq', 'application_turns', 'the interview transcript exists');
select has_table('gateq', 'application_contacts', 'and the applicant contact');
select has_column('gateq', 'application_submissions', 'dossier', 'the submission carries a dossier');
select has_column('gateq', 'application_submissions', 'snapshot_version', 'and a snapshot version');

select is((select bool_and(relrowsecurity) from pg_class
            where oid in ('gateq.application_turns'::regclass, 'gateq.application_contacts'::regclass)), true,
  'row level security is on for both new tables');
select is((select count(*)::int from pg_policies
            where schemaname = 'gateq' and tablename in ('application_turns', 'application_contacts')), 0,
  'and there is no policy: no browser principal reads them');
select is((select count(*)::int from information_schema.role_table_grants
            where table_schema = 'gateq' and table_name in ('application_turns', 'application_contacts')
              and grantee in ('anon', 'authenticated')), 0,
  'no browser principal holds a grant on either');

-- Turns: ordered, idempotent per exchange, append-only --------------------------------
insert into gateq.application_turns (application_id, tenant_id, seq, role, text, client_turn_id) values
  ('00000000-0000-4000-8000-00000000dd31', pg_temp.rls_id('tenant_b'), 1, 'PERSON', 'We build payments rails.', 'turn-0000001');
insert into gateq.application_turns (application_id, tenant_id, seq, role, text, client_turn_id, asking_dimension, intent) values
  ('00000000-0000-4000-8000-00000000dd31', pg_temp.rls_id('tenant_b'), 2, 'Q', 'Who pays you today?', 'turn-0000001',
   'company.customers', 'ANSWER');

select throws_ok($$
  insert into gateq.application_turns (application_id, tenant_id, seq, role, text, client_turn_id)
  values ('00000000-0000-4000-8000-00000000dd31', pg_temp.rls_id('tenant_b'), 3, 'PERSON', 'again', 'turn-0000001')
$$, '23505', null, 'a retried exchange cannot write a second person turn');

select throws_ok($$
  insert into gateq.application_turns (application_id, tenant_id, seq, role, text, client_turn_id)
  values ('00000000-0000-4000-8000-00000000dd31', pg_temp.rls_id('tenant_b'), 2, 'PERSON', 'clash', 'turn-0000002')
$$, '23505', null, 'two turns cannot share a position');

select throws_ok($$
  insert into gateq.application_turns (application_id, tenant_id, seq, role, text, client_turn_id)
  values ('00000000-0000-4000-8000-00000000dd31', pg_temp.rls_id('tenant_b'), 3, 'SYSTEM', 'x', 'turn-0000003')
$$, '23514', null, 'a role is PERSON or Q');

select throws_ok($$
  insert into gateq.application_turns (application_id, tenant_id, seq, role, text, client_turn_id)
  values ('00000000-0000-4000-8000-00000000dd31', pg_temp.rls_id('tenant_b'), 3, 'PERSON', repeat('x', 4001), 'turn-0000003')
$$, '23514', null, 'a turn is bounded');

select throws_ok($$
  insert into gateq.application_turns (application_id, tenant_id, seq, role, text, client_turn_id, intent)
  values ('00000000-0000-4000-8000-00000000dd31', pg_temp.rls_id('tenant_b'), 3, 'PERSON', 'x', 'turn-0000003', 'ANSWER')
$$, '23514', null, 'only a Q turn carries an intent');

select throws_ok($$
  insert into gateq.application_turns (application_id, tenant_id, seq, role, text, client_turn_id)
  values ('00000000-0000-4000-8000-00000000dd31', pg_temp.rls_id('tenant_a'), 3, 'PERSON', 'x', 'turn-0000003')
$$, '23514', null, 'a turn cannot be filed under another tenant');

select throws_ok($$
  update gateq.application_turns set text = 'rewritten' where seq = 1
$$, '23001', null, 'a turn is never rewritten');

select throws_ok($$
  delete from gateq.application_turns where seq = 1
$$, '23001', null, 'nor deleted');

-- Contacts: one per application, verifier only ------------------------------------------
insert into gateq.application_contacts (application_id, tenant_id, name, email, role, company_name, code_hash, code_expires_at) values
  ('00000000-0000-4000-8000-00000000dd31', pg_temp.rls_id('tenant_b'), 'Ada Founder', 'ada@example.test', 'CEO', 'Rails Ltd',
   repeat('c', 64), now() + interval '30 minutes');

select col_is_pk('gateq', 'application_contacts', 'application_id', 'one contact per application');

select is((select count(*)::int from information_schema.columns
            where table_schema = 'gateq' and table_name = 'application_contacts'
              and column_name in ('code', 'raw_code', 'one_time_code')), 0,
  'there is no column for the raw code: only its verifier is stored');

select throws_ok($$
  update gateq.application_contacts set code_hash = '123456'
   where application_id = '00000000-0000-4000-8000-00000000dd31'
$$, '23514', null, 'a value that is not a sha256 verifier is refused');

select throws_ok($$
  update gateq.application_contacts set email_confirmed_at = now()
   where application_id = '00000000-0000-4000-8000-00000000dd31'
$$, '23514', null, 'a confirmation always says how it was confirmed');

select throws_ok($$
  update gateq.application_contacts set preferred_channel = 'CARRIER_PIGEON'
   where application_id = '00000000-0000-4000-8000-00000000dd31'
$$, '23514', null, 'the preferred channel is EMAIL or PHONE');

-- The submission: dossier at insert, then immutable as before ---------------------------
insert into gateq.application_submissions
  (id, application_id, tenant_id, gateway_version_id, snapshot, qualification, client_request_id, dossier, snapshot_version)
values
  ('00000000-0000-4000-8000-00000000dd61', '00000000-0000-4000-8000-00000000dd31', pg_temp.rls_id('tenant_b'),
   '00000000-0000-4000-8000-00000000dd21', '{"reference":"ga_23456789abcdefghjkmnpqrs01"}'::jsonb,
   '{"outcome":"QUALIFIED"}'::jsonb, 'req-000000000001', '{"schemaVersion":"gateq-dossier.v1"}'::jsonb, 2);

select is((select snapshot_version::int from gateq.application_submissions
            where id = '00000000-0000-4000-8000-00000000dd61'), 2,
  'the snapshot version is recorded at insert');

select throws_ok($$
  update gateq.application_submissions set dossier = '{"schemaVersion":"rewritten"}'::jsonb
   where id = '00000000-0000-4000-8000-00000000dd61'
$$, '23001', null, 'the dossier is never rewritten after submission');

select throws_ok($$
  insert into gateq.application_submissions
    (application_id, tenant_id, gateway_version_id, snapshot, qualification, client_request_id, dossier)
  values ('00000000-0000-4000-8000-00000000dd31', pg_temp.rls_id('tenant_b'),
          '00000000-0000-4000-8000-00000000dd21', '{}'::jsonb, '{}'::jsonb, 'req-000000000002', '[]'::jsonb)
$$, '23514', null, 'a dossier is an object, never arbitrary JSON');

select * from finish();
rollback;
