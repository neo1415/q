-- Live e2e 25 Oct 2026 · onboarding.document_reviews: that Q's review of a
-- founder document version finished for a session, and how many new offers
-- it made, so a deck that adds nothing new is said so instead of a silent
-- wait. Tenant-owned (the session's tenant), append-only, idempotent per
-- session and version, and server-only (no browser principal reads anyone's,
-- their own included; the API projects it after checking session ownership).
--
-- EXPECTED DB BEHAVIOUR: the privileged server role can read every row.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(13);

insert into onboarding.definitions (id, journey_type, name)
values ('00000000-0000-4000-8000-000000000ad0', 'external_investor_conversion', 'Document reviews (test)')
on conflict (journey_type) do nothing;
insert into onboarding.definition_versions (id, definition_id, version, schema, manifest_hash)
values ('00000000-0000-4000-8000-000000000ad1', (select id from onboarding.definitions where journey_type = 'external_investor_conversion'), 51,
        '{"schemaVersion": 1, "phases": [], "runtime": {"subjectType": "COMPANY", "allowUnboundStart": true}}',
        repeat('e', 64));
insert into onboarding.steps (definition_version_id, step_key, sequence_order, step_type, required, configuration)
values ('00000000-0000-4000-8000-000000000ad1', 'intent', 0, 'short_text', true, '{"prompt": "What brings you here?"}');

-- User A's session, bound to tenant A's company.
insert into onboarding.sessions (id, user_id, journey_type, definition_version_id, current_step_key, tenant_id, organisation_id, subject_type, subject_id)
values ('00000000-0000-4000-8000-000000000ae1', pg_temp.rls_id('user_a'), 'external_investor_conversion', '00000000-0000-4000-8000-000000000ad1', 'intent',
        pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'COMPANY', '00000000-0000-4000-8000-000000000ac1');

-- Positive ----------------------------------------------------------------------------
select lives_ok(
  $$ insert into onboarding.document_reviews (id, tenant_id, session_id, document_id, document_version_id, suggestions_created)
     values ('00000000-0000-4000-8000-000000000af1', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000000ae1',
             '00000000-0000-4000-8000-000000000aa1', '00000000-0000-4000-8000-000000000ab1', 0) $$,
  'a finished review is recorded, nothing new included');

-- Idempotency --------------------------------------------------------------------------
select throws_ok(
  $$ insert into onboarding.document_reviews (tenant_id, session_id, document_id, document_version_id, suggestions_created)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000000ae1',
             '00000000-0000-4000-8000-000000000aa1', '00000000-0000-4000-8000-000000000ab1', 3) $$,
  '23505', null, 'one review per session and document version');
select is(
  (select count(*)::int from onboarding.document_reviews where session_id = '00000000-0000-4000-8000-000000000ae1'),
  1, 'the redelivered review wrote nothing');

-- Tenant ownership (cross-tenant negative) ------------------------------------------------
select throws_ok(
  $$ insert into onboarding.document_reviews (tenant_id, session_id, document_id, document_version_id, suggestions_created)
     values (pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-000000000ae1',
             '00000000-0000-4000-8000-000000000aa2', '00000000-0000-4000-8000-000000000ab2', 0) $$,
  '23514', null, 'a review can never name a tenant other than its session''s');

-- Constraints --------------------------------------------------------------------------
select throws_ok(
  $$ insert into onboarding.document_reviews (tenant_id, session_id, document_id, document_version_id, suggestions_created)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000000ae1',
             '00000000-0000-4000-8000-000000000aa3', '00000000-0000-4000-8000-000000000ab3', -1) $$,
  '23514', null, 'a count is never negative');
select throws_ok(
  $$ insert into onboarding.document_reviews (tenant_id, session_id, document_id, document_version_id, suggestions_created)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000000ae9',
             '00000000-0000-4000-8000-000000000aa4', '00000000-0000-4000-8000-000000000ab4', 0) $$,
  '23514', null, 'a review belongs to a real session');

-- Append-only --------------------------------------------------------------------------
select throws_ok(
  $$ update onboarding.document_reviews set suggestions_created = 5 where id = '00000000-0000-4000-8000-000000000af1' $$,
  '23001', null, 'a review cannot be rewritten');
select throws_ok(
  $$ delete from onboarding.document_reviews where id = '00000000-0000-4000-8000-000000000af1' $$,
  '23001', null, 'a review cannot be deleted');

-- Exposure -----------------------------------------------------------------------------
select pg_temp.act_as_user_a();
select throws_ok($$ select * from onboarding.document_reviews $$, '42501', null,
  'browser user A cannot read the raw reviews, even their own');
select pg_temp.act_as_user_b();
select throws_ok($$ select * from onboarding.document_reviews where session_id = '00000000-0000-4000-8000-000000000ae1' $$, '42501', null,
  'a member of another tenant cannot read user A''s reviews');
select pg_temp.act_as_revoked_user();
select throws_ok($$ select * from onboarding.document_reviews $$, '42501', null,
  'a revoked member reads nothing');
select pg_temp.act_as_anonymous();
select throws_ok(
  $$ insert into onboarding.document_reviews (tenant_id, session_id, document_id, document_version_id, suggestions_created)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000000ae1',
             '00000000-0000-4000-8000-000000000aa5', '00000000-0000-4000-8000-000000000ab5', 0) $$,
  '42501', null, 'anonymous denied');
select pg_temp.act_as_service_role();
select throws_ok($$ select * from onboarding.document_reviews $$, '42501', null,
  'the service role holds no grant on it');
select pg_temp.act_as_privileged();

select * from finish();

rollback;
