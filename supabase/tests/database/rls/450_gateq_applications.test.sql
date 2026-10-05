-- CQ-GATE-002 · gateq.applications and their guest sessions: a stranger's
-- application, readable by no browser principal, never rewritten once
-- submitted.
--
--   application ≠ canonical Company
--   applicant said it ≠ verified fact
--   draft ≠ submitted;  submission is the disclosure boundary
--   guest session ≠ membership ≠ capability
--
-- EXPECTED DB BEHAVIOUR: the privileged server role can read every row.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(25);

-- Fixtures ------------------------------------------------------------------------
insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name) values
  ('00000000-0000-4000-8000-00000000cc01', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 'VC', 'Application Capital');

insert into gateq.gateways (id, tenant_id, investor_organisation_id, organisation_id, public_id, name, created_by_user_id) values
  ('00000000-0000-4000-8000-00000000cc11', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-00000000cc01', pg_temp.rls_id('org_b'),
   'gq_123456789abcdefghjkmnpqrs0', 'Seed programme', pg_temp.rls_id('user_b'));

insert into gateq.gateway_versions
  (id, gateway_id, tenant_id, version_number, status, inbound_mode, public_title, qualification_policy_version,
   created_by_user_id, published_by_user_id, published_at)
values
  ('00000000-0000-4000-8000-00000000cc21', '00000000-0000-4000-8000-00000000cc11', pg_temp.rls_id('tenant_b'), 1,
   'PUBLISHED', 'QUALIFIED', 'Seed-stage fintech', 'gateq-qualification.v1',
   pg_temp.rls_id('user_b'), pg_temp.rls_id('user_b'), now());

insert into gateq.applications (id, tenant_id, gateway_id, gateway_version_id, public_reference) values
  ('00000000-0000-4000-8000-00000000cc31', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-00000000cc11',
   '00000000-0000-4000-8000-00000000cc21', 'ga_123456789abcdefghjkmnpqrs0');

-- Shape ------------------------------------------------------------------------------
select has_table('gateq', 'applications', 'the application exists');
select has_table('gateq', 'application_sessions', 'and its guest sessions');
select has_table('gateq', 'application_facts', 'and what the applicant said');
select has_table('gateq', 'application_submissions', 'and what was submitted');
select has_table('gateq', 'application_documents', 'and the documents attached');

select is((select bool_and(relrowsecurity) from pg_class
            where oid in ('gateq.applications'::regclass, 'gateq.application_sessions'::regclass,
                          'gateq.application_facts'::regclass, 'gateq.application_submissions'::regclass,
                          'gateq.application_documents'::regclass)), true,
  'row level security is on for all five');

select is((select count(*)::int from information_schema.role_table_grants
            where table_schema = 'gateq' and grantee in ('anon', 'authenticated')), 0,
  'no browser principal holds a grant: a guest carries a bearer credential for an API, not a database role');

-- An application is never a company ----------------------------------------------------
select is((select count(*)::int from information_schema.columns
            where table_schema = 'gateq' and table_name = 'applications'
              and column_name in ('company_id', 'canonical_company_id', 'organisation_id')), 0,
  'an application has no company column: a stranger typing a name is not evidence that a company exists');

-- Opaque references --------------------------------------------------------------------
select col_is_unique('gateq', 'applications', 'public_reference', 'the application reference is unique');
select throws_ok($$
  insert into gateq.applications (tenant_id, gateway_id, gateway_version_id, public_reference)
  values (pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-00000000cc11',
          '00000000-0000-4000-8000-00000000cc21', 'application-1')
$$, '23514', null, 'a guessable application reference is refused');

-- The guest credential -----------------------------------------------------------------
select is((select count(*)::int from information_schema.columns
            where table_schema = 'gateq' and table_name = 'application_sessions'
              and column_name in ('token', 'secret', 'credential')), 0,
  'there is no column for the raw credential: only its verifier is stored');

select throws_ok($$
  insert into gateq.application_sessions (application_id, tenant_id, token_hash, expires_at)
  values ('00000000-0000-4000-8000-00000000cc31', pg_temp.rls_id('tenant_b'), 'gqs_a_raw_looking_token', now() + interval '1 day')
$$, '23514', null, 'a value that is not a sha256 verifier is refused');

insert into gateq.application_sessions (id, application_id, tenant_id, token_hash, expires_at) values
  ('00000000-0000-4000-8000-00000000cc41', '00000000-0000-4000-8000-00000000cc31', pg_temp.rls_id('tenant_b'),
   repeat('a', 64), now() + interval '14 days');

select col_is_unique('gateq', 'application_sessions', 'token_hash', 'one credential names one session');

select throws_ok($$
  insert into gateq.application_sessions (application_id, tenant_id, token_hash, expires_at)
  values ('00000000-0000-4000-8000-00000000cc31', pg_temp.rls_id('tenant_b'), repeat('b', 64), now() - interval '1 day')
$$, '23514', null, 'a session cannot expire before it began');

-- Facts: one current value, and a correction keeps its predecessor ----------------------
insert into gateq.application_facts (id, application_id, tenant_id, dimension, value, provenance) values
  ('00000000-0000-4000-8000-00000000cc51', '00000000-0000-4000-8000-00000000cc31', pg_temp.rls_id('tenant_b'),
   'company.country', '{"kind":"CODE","code":"NG"}'::jsonb, 'APPLICANT_PROVIDED');

select throws_ok($$
  insert into gateq.application_facts (application_id, tenant_id, dimension, value, provenance)
  values ('00000000-0000-4000-8000-00000000cc31', pg_temp.rls_id('tenant_b'),
          'company.country', '{"kind":"CODE","code":"KE"}'::jsonb, 'APPLICANT_PROVIDED')
$$, '23505', null, 'two current values for one dimension is refused by the database, not by whoever writes the next path');

insert into gateq.application_facts (id, application_id, tenant_id, dimension, value, provenance) values
  ('00000000-0000-4000-8000-00000000cc52', '00000000-0000-4000-8000-00000000cc31', pg_temp.rls_id('tenant_b'),
   'company.stage', '{"kind":"CODE","code":"seed"}'::jsonb, 'APPLICANT_PROVIDED');

select lives_ok($$
  update gateq.application_facts
     set superseded_at = now(), superseded_by = '00000000-0000-4000-8000-00000000cc52'
   where id = '00000000-0000-4000-8000-00000000cc51'
$$, 'a correction supersedes rather than overwrites');

select lives_ok($$
  insert into gateq.application_facts (application_id, tenant_id, dimension, value, provenance)
  values ('00000000-0000-4000-8000-00000000cc31', pg_temp.rls_id('tenant_b'),
          'company.country', '{"kind":"CODE","code":"KE"}'::jsonb, 'APPLICANT_PROVIDED')
$$, 'and the corrected value can then be the current one');

select is((select count(*)::int from gateq.application_facts
            where application_id = '00000000-0000-4000-8000-00000000cc31'
              and dimension = 'company.country'), 2,
  'both what was said and what it was corrected to are on the record');

select throws_ok($$
  insert into gateq.application_facts (application_id, tenant_id, dimension, value, provenance)
  values ('00000000-0000-4000-8000-00000000cc31', pg_temp.rls_id('tenant_b'),
          'company.market', '[]'::jsonb, 'APPLICANT_PROVIDED')
$$, '23514', null, 'arbitrary JSON is not a fact value');

select throws_ok($$
  insert into gateq.application_facts (application_id, tenant_id, dimension, value, provenance)
  values ('00000000-0000-4000-8000-00000000cc31', pg_temp.rls_id('tenant_b'),
          'company.market', '{"kind":"TEXT","text":"x"}'::jsonb, 'VERIFIED')
$$, '23514', null, 'and nothing an applicant says is stored as verified');

-- Submission is the disclosure boundary, and it is written once -------------------------
insert into gateq.application_submissions
  (id, application_id, tenant_id, gateway_version_id, snapshot, qualification, client_request_id)
values
  ('00000000-0000-4000-8000-00000000cc61', '00000000-0000-4000-8000-00000000cc31', pg_temp.rls_id('tenant_b'),
   '00000000-0000-4000-8000-00000000cc21', '{"reference":"ga_123456789abcdefghjkmnpqrs0"}'::jsonb,
   '{"outcome":"QUALIFIED"}'::jsonb, 'req-000000000001');

select throws_ok($$
  insert into gateq.application_submissions
    (application_id, tenant_id, gateway_version_id, snapshot, qualification, client_request_id)
  values ('00000000-0000-4000-8000-00000000cc31', pg_temp.rls_id('tenant_b'),
          '00000000-0000-4000-8000-00000000cc21', '{}'::jsonb, '{}'::jsonb, 'req-000000000002')
$$, '23505', null, 'an application is submitted once: a double-click cannot produce two');

select throws_ok($$
  update gateq.application_submissions set snapshot = '{"reference":"rewritten"}'::jsonb
   where id = '00000000-0000-4000-8000-00000000cc61'
$$, '23001', null, 'what the organisation received is never rewritten');

select throws_ok($$
  delete from gateq.application_submissions where id = '00000000-0000-4000-8000-00000000cc61'
$$, '23001', null, 'nor deleted');

-- Documents are an association, not a second store --------------------------------------
select is((select count(*)::int from information_schema.columns
            where table_schema = 'gateq' and table_name = 'application_documents'
              and column_name in ('storage_key', 'content', 'extracted_text', 'bytes')), 0,
  'GateQ stores no bytes, no storage key and no extracted text: Evidence owns the document');

select is((select count(*)::int from information_schema.tables where table_schema = 'gateq'), 9,
  'nine gateq tables: three for the gateway, five for the application, one for mandate-reading provenance (P7)');

select * from finish();
rollback;
