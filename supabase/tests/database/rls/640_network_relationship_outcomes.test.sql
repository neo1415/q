-- Post-meeting outcomes (2026-10-02) · network.relationship_pass_reasons,
-- network.relationship_passes, and the chat party predicate under
-- relationship-state.v2.
--
-- Founder decision (a): a pass's reason is the investor's private note. The
-- company side reads a pass row only when the investor shared it; never
-- another tenant's, never after membership is revoked, never anonymously.
-- No client writes; passes are append-only for every role.
--
-- EXPECTED DB BEHAVIOUR: the privileged server role reads every row.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION (the server also requires the investor side and a
-- matched relationship).

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(23);

-- Company A (tenant A) ↔ investor B (tenant B), and company R (tenant R) ↔
-- investor B: user A is a party to the first only.
insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug) values
  ('00000000-0000-4000-8000-0000000063c1', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'Outcome Co A', 'outcome-co-a'),
  ('00000000-0000-4000-8000-0000000063c2', pg_temp.rls_id('tenant_r'), pg_temp.rls_id('org_r'), 'Outcome Co R', 'outcome-co-r');
insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name) values
  ('00000000-0000-4000-8000-0000000063e2', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 'VC', 'Outcome Capital B');
insert into network.relationships (id, tenant_id, company_id, investor_organisation_id, current_state) values
  ('00000000-0000-4000-8000-000000006301', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000063c1', '00000000-0000-4000-8000-0000000063e2', 'PASSED'),
  ('00000000-0000-4000-8000-000000006302', pg_temp.rls_id('tenant_r'), '00000000-0000-4000-8000-0000000063c2', '00000000-0000-4000-8000-0000000063e2', 'PASSED');
insert into communication.conversations (id, tenant_id, relationship_id) values
  ('00000000-0000-4000-8000-000000006311', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000006301');

-- On A: one private pass (a reason only the investor sees) and one shared.
-- On R: a shared pass user A must never see.
insert into network.relationship_passes
  (id, tenant_id, relationship_id, investor_organisation_id, passed_by_user_id, reason_code, note, share_with_founder, idempotency_key) values
  ('00000000-0000-4000-8000-0000000063a1', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-000000006301', '00000000-0000-4000-8000-0000000063e2',
   pg_temp.rls_id('user_b'), 'VALUATION', 'private: priced above our band', false, 'outcome-pass-0001'),
  ('00000000-0000-4000-8000-0000000063a2', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-000000006301', '00000000-0000-4000-8000-0000000063e2',
   pg_temp.rls_id('user_b'), 'TIMING', 'shared: too early for this fund', true, 'outcome-pass-0002'),
  ('00000000-0000-4000-8000-0000000063a3', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-000000006302', '00000000-0000-4000-8000-0000000063e2',
   pg_temp.rls_id('user_b'), 'MARKET', 'shared with R only', true, 'outcome-pass-0003');

-- Shape --------------------------------------------------------------------------
select is((select bool_and(relrowsecurity) from pg_class where oid in (
  'network.relationship_passes'::regclass, 'network.relationship_pass_reasons'::regclass)),
  true, 'row level security is on for both tables');
select ok(not has_table_privilege('authenticated', 'network.relationship_passes', 'insert'),
  'no client role may record a pass');
select ok(not has_table_privilege('anon', 'network.relationship_passes', 'select'),
  'the anonymous role has no grant on passes');
select is((select count(*)::int from network.relationship_pass_reasons where active), 11,
  'the eleven reason categories of Product Specification 6.6.10 are reference rows');

-- Constraints ---------------------------------------------------------------------
select throws_ok(
  $$ insert into network.relationship_passes (tenant_id, relationship_id, investor_organisation_id, passed_by_user_id, reason_code, idempotency_key)
     values (pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-000000006301', '00000000-0000-4000-8000-0000000063e2',
             pg_temp.rls_id('user_b'), 'NOT_A_REASON', 'outcome-pass-0004') $$,
  '23503', null, 'a reason is one of the reference rows');
select throws_ok(
  $$ insert into network.relationship_passes (tenant_id, relationship_id, investor_organisation_id, passed_by_user_id, share_with_founder, idempotency_key)
     values (pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-000000006301', '00000000-0000-4000-8000-0000000063e2',
             pg_temp.rls_id('user_b'), true, 'outcome-pass-0005') $$,
  '23514', null, 'sharing a reason needs a reason or a note');
select throws_ok(
  $$ insert into network.relationship_passes (tenant_id, relationship_id, investor_organisation_id, passed_by_user_id, idempotency_key)
     values (pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-000000006301', '00000000-0000-4000-8000-0000000063e2',
             pg_temp.rls_id('user_b'), 'outcome-pass-0001') $$,
  '23505', null, 'one pass per person per idempotency key');
select lives_ok(
  $$ insert into network.relationship_passes (tenant_id, relationship_id, investor_organisation_id, passed_by_user_id, idempotency_key)
     values (pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-000000006301', '00000000-0000-4000-8000-0000000063e2',
             pg_temp.rls_id('user_b'), 'outcome-pass-0006') $$,
  'a pass without a reason is allowed: a reason is never demanded');
select throws_ok(
  $$ update network.relationship_passes set share_with_founder = true where id = '00000000-0000-4000-8000-0000000063a1' $$,
  '55000', null, 'even the server role cannot change a pass');
select throws_ok(
  $$ delete from network.relationship_passes where id = '00000000-0000-4000-8000-0000000063a1' $$,
  '55000', null, 'even the server role cannot delete a pass');

-- Privileged server role -----------------------------------------------------------
select is((select count(*)::int from network.relationship_passes
            where id in ('00000000-0000-4000-8000-0000000063a1', '00000000-0000-4000-8000-0000000063a2',
                         '00000000-0000-4000-8000-0000000063a3')), 3, 'the server role reads every pass');

-- No raw client access: Network is read through the server ------------------------
select pg_temp.act_as_user_a();
select throws_ok($$ select * from network.relationship_passes $$, '42501', null,
  'no raw client access: a pass is read through the server');
select pg_temp.act_as_privileged();
-- Defence in depth, inside this rolled-back transaction: were raw access
-- ever granted, the policies alone would still hold.
grant usage on schema network to authenticated;

-- The investor side reads its own passes, reasons and notes -------------------------
select pg_temp.act_as_user_b();
select is((select count(*)::int from network.relationship_passes
            where relationship_id = '00000000-0000-4000-8000-000000006301'), 3,
  'user B reads every pass its organisation made on A, private ones included');
select is((select note from network.relationship_passes where id = '00000000-0000-4000-8000-0000000063a1'),
  'private: priced above our band', 'user B reads its own private note');
select is((select count(*)::int from network.relationship_pass_reasons), 11,
  'an authenticated person reads the reason categories');

-- The company side reads a pass only when its reason was shared ---------------------
select pg_temp.act_as_user_a();
select is((select count(*)::int from network.relationship_passes), 1,
  'user A sees exactly the one pass shared with them');
select is((select reason_code from network.relationship_passes), 'TIMING',
  'and it is the shared one');
select is((select count(*)::int from network.relationship_passes
            where note like 'private:%' or reason_code = 'VALUATION'), 0,
  'the private reason and note never reach the founder');
select is((select count(*)::int from network.relationship_passes
            where relationship_id = '00000000-0000-4000-8000-000000006302'), 0,
  'cross-tenant: user A never sees a pass shared on someone else''s relationship');
select throws_ok(
  $$ insert into network.relationship_passes (tenant_id, relationship_id, investor_organisation_id, passed_by_user_id, idempotency_key)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000006301', '00000000-0000-4000-8000-0000000063e2',
             pg_temp.rls_id('user_a'), 'outcome-pass-0007') $$,
  '42501', null, 'a founder cannot record a pass, on themselves or anyone');
select ok(private.is_conversation_party('00000000-0000-4000-8000-000000006311'),
  'the thread stays open after a pass: the match outlives CONNECTED');

-- Revoked and anonymous --------------------------------------------------------------
select pg_temp.act_as_revoked_user();
select is((select count(*)::int from network.relationship_passes), 0,
  'a revoked member sees no pass, shared or not');
select pg_temp.act_as_anonymous();
select throws_ok($$ select count(*) from network.relationship_passes $$, '42501', null,
  'the anonymous role cannot read passes');

select * from finish();
rollback;
