-- Q in meetings S5, S6, S7, S9 (20261231599340).
--
-- The post-call reading and the admin's facilitation record are server
-- data: no browser principal reads or writes the new tables (not anon, not
-- a signed-in party, not a platform admin from a browser). Commitment notes
-- are append-only; the evidence grade is a closed list kept apart from the
-- status, and nothing can be graded VERIFIED. A review flag is one per
-- commitment and reason. A request filed from a meeting names the meeting.
--
-- EXPECTED DB BEHAVIOUR: the privileged server role reads every row.
-- DB BYPASS ≠ BUSINESS AUTHORISATION (the server decides the party and side).

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(25);

insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug) values
  ('00000000-0000-4000-8000-0000000093c1', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'Outcome Co A', 'outcome-co-a');
insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name) values
  ('00000000-0000-4000-8000-0000000093e2', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 'VC', 'Outcome Capital B');
insert into network.relationships (id, tenant_id, company_id, investor_organisation_id, current_state) values
  ('00000000-0000-4000-8000-000000009301', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000093c1', '00000000-0000-4000-8000-0000000093e2', 'CONNECTED');
insert into network.commitments (id, tenant_id, relationship_id, amount, currency_code, level, status, stated_by_side, stated_by_user_id, idempotency_key, condition) values
  ('00000000-0000-4000-8000-0000000093d1', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000009301', 250000, 'USD', 'SOFT', 'STATED', 'INVESTOR',
   pg_temp.rls_id('user_b'), 'outcome-commit-0001', 'if diligence checks out');

-- S9: the evidence axis --------------------------------------------------------
select is((select evidence_status from network.commitments where id = '00000000-0000-4000-8000-0000000093d1'),
  'SELF_REPORTED', 'a commitment starts as one side''s word');
select is((select condition from network.commitments where id = '00000000-0000-4000-8000-0000000093d1'),
  'if diligence checks out', 'the condition is kept apart from the amount');
select throws_ok(
  $$ update network.commitments set evidence_status = 'PLATFORM_VERIFIED' where id = '00000000-0000-4000-8000-0000000093d1' $$,
  '23514', null, 'nothing is platform verified without a verification source');
select throws_ok(
  $$ update network.commitments set evidence_status = 'EXTERNALLY_VERIFIED' where id = '00000000-0000-4000-8000-0000000093d1' $$,
  '23514', null, 'nor externally verified');
select lives_ok(
  $$ update network.commitments set evidence_status = 'MULTI_SOURCE_SUPPORTED' where id = '00000000-0000-4000-8000-0000000093d1' $$,
  'both sides'' word is a grade the server may set');

-- S9: notes are append-only ---------------------------------------------------
insert into network.commitment_notes (id, tenant_id, relationship_id, commitment_id, author_user_id, side, kind, body, proposed_amount, proposed_currency_code, idempotency_key) values
  ('00000000-0000-4000-8000-0000000093f1', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000009301', '00000000-0000-4000-8000-0000000093d1',
   pg_temp.rls_id('user_a'), 'COMPANY', 'CHANGE', 'We agreed 200,000 on the call, not 250,000.', 200000, 'USD', 'note-change-0001');
select throws_ok(
  $$ update network.commitment_notes set body = 'rewritten' $$,
  '55000', null, 'a note is never rewritten');
select throws_ok(
  $$ delete from network.commitment_notes $$,
  '55000', null, 'nor deleted');
select throws_ok(
  $$ insert into network.commitment_notes (tenant_id, relationship_id, commitment_id, author_user_id, side, kind, body, proposed_amount, idempotency_key)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000009301', '00000000-0000-4000-8000-0000000093d1',
             pg_temp.rls_id('user_a'), 'COMPANY', 'CHANGE', 'No currency', 1, 'note-change-0002') $$,
  '23514', null, 'a changed amount carries its currency');
select throws_ok(
  $$ insert into network.commitment_notes (tenant_id, relationship_id, commitment_id, author_user_id, side, kind, body, proposed_amount, proposed_currency_code, idempotency_key)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000009301', '00000000-0000-4000-8000-0000000093d1',
             pg_temp.rls_id('user_a'), 'COMPANY', 'NOTE', 'A note', 1, 'USD', 'note-note-0003') $$,
  '23514', null, 'only a change proposes an amount');
select throws_ok(
  $$ insert into network.commitment_notes (tenant_id, relationship_id, commitment_id, author_user_id, side, kind, body, idempotency_key)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000009301', '00000000-0000-4000-8000-0000000093d1',
             pg_temp.rls_id('user_a'), 'COMPANY', 'NOTE', 'Again', 'note-change-0001') $$,
  '23505', null, 'a note is filed once per key');

-- S9: the admin review queue --------------------------------------------------
insert into network.commitment_review_flags (commitment_id, relationship_id, reason_code, detail) values
  ('00000000-0000-4000-8000-0000000093d1', '00000000-0000-4000-8000-000000009301', 'AMOUNT_MISMATCH', 'The company says 200,000 USD; the investor stated 250,000 USD.');
select throws_ok(
  $$ insert into network.commitment_review_flags (commitment_id, relationship_id, reason_code, detail)
     values ('00000000-0000-4000-8000-0000000093d1', '00000000-0000-4000-8000-000000009301', 'AMOUNT_MISMATCH', 'again') $$,
  '23505', null, 'one open flag per commitment and reason');
select throws_ok(
  $$ insert into network.commitment_review_flags (commitment_id, relationship_id, reason_code, detail)
     values ('00000000-0000-4000-8000-0000000093d1', '00000000-0000-4000-8000-000000009301', 'LOOKS_FISHY', 'x') $$,
  '23514', null, 'reasons are a closed list');
select is((select amount::text from network.commitments where id = '00000000-0000-4000-8000-0000000093d1'), '250000',
  'a flag and a proposed change leave the stated amount as it was');

-- S5: a request from a meeting names it ---------------------------------------
select throws_ok(
  $$ insert into network.diligence_requests (tenant_id, relationship_id, requested_by_user_id, title, idempotency_key, source_event_id)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000009301', pg_temp.rls_id('user_b'), 'Cap table',
             'meeting-req-0001', '00000000-0000-4000-8000-0000000093aa') $$,
  '23514', null, 'a request''s reading item needs its meeting');

-- S6b: the in-call share line is a host note kind ------------------------------
select ok((select pg_get_constraintdef(oid) like '%SHARED_IN_CALL%' from pg_constraint
            where conname = 'meeting_host_notes_kind_check'
              and conrelid = 'communication.meeting_host_notes'::regclass),
  'the in-call share line is a kind of host note');

-- Server-only: RLS on, no client grants, no policies ---------------------------
select ok((select bool_and(c.relrowsecurity) from pg_class c
            where c.oid in ('network.commitment_notes'::regclass, 'network.commitment_review_flags'::regclass,
                            'platform_ops.meeting_digests'::regclass, 'communication.meeting_follow_up_seen'::regclass)),
  'every new table has row level security on');
select is((select count(*)::int from information_schema.role_table_grants
            where grantee in ('anon', 'authenticated', 'PUBLIC')
              and (table_schema, table_name) in (('network', 'commitment_notes'), ('network', 'commitment_review_flags'),
                                                 ('platform_ops', 'meeting_digests'), ('communication', 'meeting_follow_up_seen'))), 0,
  'no browser principal holds a grant on any of them');
select is((select count(*)::int from pg_policies
            where (schemaname, tablename) in (('network', 'commitment_notes'), ('network', 'commitment_review_flags'),
                                              ('platform_ops', 'meeting_digests'), ('communication', 'meeting_follow_up_seen'))), 0,
  'server-only tables carry no policies');

select pg_temp.act_as_user_a();
select throws_ok($$ select count(*) from network.commitment_notes $$, '42501', null,
  'a party cannot read notes directly (the server reads them for the right side)');
select throws_ok($$ select count(*) from platform_ops.meeting_digests $$, '42501', null,
  'a signed-in person cannot read the admin''s meeting digests');
select throws_ok($$ select count(*) from network.commitment_review_flags $$, '42501', null,
  'nor the review queue');
select throws_ok($$ select count(*) from communication.meeting_follow_up_seen $$, '42501', null,
  'nor the follow-up marks');
select pg_temp.act_as_anonymous();
select throws_ok($$ select count(*) from platform_ops.meeting_digests $$, '42501', null,
  'an anonymous visitor cannot read the digests');
select throws_ok($$ insert into network.commitment_notes (tenant_id, relationship_id, commitment_id, author_user_id, side, kind, body, idempotency_key)
     values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'COMPANY', 'NOTE', 'x', 'anon-note-0001') $$,
  '42501', null, 'nor write a note');
select pg_temp.reset_test_identity();

select is((select count(*)::int from network.commitment_notes), 1,
  'EXPECTED DB BEHAVIOUR: the server role reads the note');

select * from finish();
rollback;
