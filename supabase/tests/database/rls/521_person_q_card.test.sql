-- Q Story S6 · core.handles and core.shareable_identities for a PERSON:
-- a person's own Q Card. It has no organisation, only that person may be
-- its claimer / creator, and it stays server-internal like every card.
-- Organisation cards keep their organisation.
--
-- EXPECTED DB BEHAVIOUR: the privileged server role can read every row.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(11);

-- Positive: a person claims their own handle and card.
insert into core.handles (id, handle, tenant_id, organisation_id, subject_type, subject_id, claimed_by_user_id) values
  ('00000000-0000-4000-8000-0000000005a1', 'person-a', pg_temp.rls_id('tenant_a'), null, 'PERSON',
   pg_temp.rls_id('user_a'), pg_temp.rls_id('user_a'));
insert into core.shareable_identities (id, tenant_id, organisation_id, subject_type, subject_id, public_code, field_scopes, created_by_user_id) values
  ('00000000-0000-4000-8000-0000000005b1', pg_temp.rls_id('tenant_a'), null, 'PERSON', pg_temp.rls_id('user_a'),
   'pers0n0001', '{"displayName":"public_external","headline":"public_external","personFocus":"network_visible"}',
   pg_temp.rls_id('user_a'));

select is((select subject_type from core.handles where id = '00000000-0000-4000-8000-0000000005a1'), 'PERSON',
  'a person may hold a handle');
select is((select organisation_id from core.shareable_identities where id = '00000000-0000-4000-8000-0000000005b1'), null,
  'a person''s card has no organisation');

-- Negatives: someone else's person card, an organisation on a person, a
-- company without one, an unknown subject type.
select throws_ok(
  $$ insert into core.handles (handle, tenant_id, organisation_id, subject_type, subject_id, claimed_by_user_id)
     values ('person-b-by-a', pg_temp.rls_id('tenant_a'), null, 'PERSON', pg_temp.rls_id('user_b'), pg_temp.rls_id('user_a')) $$,
  '23514', null, 'nobody claims a handle for another person');
select throws_ok(
  $$ insert into core.handles (handle, tenant_id, organisation_id, subject_type, subject_id, claimed_by_user_id)
     values ('person-b-anon', pg_temp.rls_id('tenant_b'), null, 'PERSON', pg_temp.rls_id('user_b'), null) $$,
  '23514', null, 'a person handle always names its claimer');
select throws_ok(
  $$ insert into core.handles (handle, tenant_id, organisation_id, subject_type, subject_id, claimed_by_user_id)
     values ('person-b-org', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 'PERSON', pg_temp.rls_id('user_b'), pg_temp.rls_id('user_b')) $$,
  '23514', null, 'a person handle never belongs to an organisation');
select throws_ok(
  $$ insert into core.handles (handle, tenant_id, organisation_id, subject_type, subject_id)
     values ('orgless-company', pg_temp.rls_id('tenant_a'), null, 'COMPANY', gen_random_uuid()) $$,
  '23514', null, 'a company handle still needs its organisation');
select throws_ok(
  $$ insert into core.handles (handle, tenant_id, organisation_id, subject_type, subject_id)
     values ('a-fund', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'FUND', gen_random_uuid()) $$,
  '23514', null, 'only the three subject types');
select throws_ok(
  $$ insert into core.shareable_identities (tenant_id, organisation_id, subject_type, subject_id, public_code, created_by_user_id)
     values (pg_temp.rls_id('tenant_b'), null, 'PERSON', pg_temp.rls_id('user_b'), 'pers0n0002', pg_temp.rls_id('user_a')) $$,
  '23514', null, 'nobody makes a card for another person');
select throws_ok(
  $$ update core.shareable_identities set field_scopes = '{"headline":"founder_private"}'
      where id = '00000000-0000-4000-8000-0000000005b1' $$,
  '23514', null, 'a person card still cannot name a scope narrower than network_visible');

-- Browser principals: server-internal, as before.
select pg_temp.act_as_user_a();
select throws_ok($$ select count(*) from core.shareable_identities $$, '42501', null,
  'user A cannot read their own card row directly');
select pg_temp.act_as_anonymous();
select throws_ok($$ select count(*) from core.handles $$, '42501', null,
  'an anonymous visitor cannot read handles');

select * from finish();
rollback;
