-- CQ-INV-002 · declared investor mandates and their constraints.
--
-- Readable by members of the organisation behind the investor organisation;
-- invisible to every other tenant, to anonymous callers and to revoked
-- members. No browser principal writes. Database invariants: exact money,
-- min <= max, hard-exclusion coherence, closed vocabularies, no executable
-- JSON, tenant coherence through composite keys.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(34);

insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name) values
  ('00000000-0000-4000-8000-0000000000e1', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'VC', 'Investor A'),
  ('00000000-0000-4000-8000-0000000000e2', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 'FAMILY_OFFICE', 'Investor B');
insert into core.investor_mandates (id, tenant_id, investor_organisation_id, name, discovery_mode, min_cheque, max_cheque, currency_code, raw_mandate_text, created_by_user_id) values
  ('00000000-0000-4000-8000-00000000a001', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000000e1', 'Mandate A', 'EXPLORATORY', 250000, 2000000, 'USD', 'PRIVATE-INVESTOR-MANDATE-TEXT-DO-NOT-EMIT', pg_temp.rls_id('user_a')),
  ('00000000-0000-4000-8000-00000000b001', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-0000000000e2', 'Mandate B', null, null, null, null, 'B private thesis', pg_temp.rls_id('user_b'));
insert into core.investor_mandate_constraints (id, tenant_id, mandate_id, dimension, operator, value_jsonb, importance, is_hard_exclusion) values
  ('00000000-0000-4000-8000-00000000a101', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-00000000a001', 'red_flag', 'IN', '{"kind":"codes","values":["gambling"]}', 'HARD_EXCLUSION', true),
  ('00000000-0000-4000-8000-00000000a102', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-00000000a001', 'business.attribute', 'IN', '{"kind":"codes","values":["hardware"]}', 'AVOID', false),
  ('00000000-0000-4000-8000-00000000b101', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-00000000b001', 'stage', 'IN', '{"kind":"codes","values":["seed"]}', 'MUST', false);

-- Defaults and invariants -------------------------------------------------------
select is((select status from core.investor_mandates where id = '00000000-0000-4000-8000-00000000a001'), 'DRAFT', 'a new mandate is DRAFT');
select is((select version from core.investor_mandates where id = '00000000-0000-4000-8000-00000000a001'), 1, 'a new mandate is version 1');
select is((select min_cheque::text from core.investor_mandates where id = '00000000-0000-4000-8000-00000000a001'), '250000', 'money is exact numeric');
select is((select count(*)::int from core.investor_mandates where investor_organisation_id = '00000000-0000-4000-8000-0000000000e1'), 1, 'one investor may hold several mandates (no unique investor constraint)');
select lives_ok(
  $$ insert into core.investor_mandates (tenant_id, investor_organisation_id, name, created_by_user_id)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000000e1', 'Second mandate A', pg_temp.rls_id('user_a')) $$,
  'a second mandate for the same investor organisation is allowed');
select throws_ok(
  $$ update core.investor_mandates set min_cheque = 5000000 where id = '00000000-0000-4000-8000-00000000a001' $$,
  '23514', null, 'min cheque cannot exceed max cheque');
select throws_ok(
  $$ update core.investor_mandates set min_cheque = -1 where id = '00000000-0000-4000-8000-00000000a001' $$,
  '23514', null, 'a cheque cannot be negative');
select throws_ok(
  $$ update core.investor_mandates set currency_code = null where id = '00000000-0000-4000-8000-00000000a001' $$,
  '23514', null, 'an amount without a currency is not money');
select throws_ok(
  $$ update core.investor_mandates set status = 'OPEN' where id = '00000000-0000-4000-8000-00000000a001' $$,
  '23514', null, 'status vocabulary is closed (GateQ values are not mandate statuses)');
select throws_ok(
  $$ update core.investor_mandates set status = 'ACTIVE' where id = '00000000-0000-4000-8000-00000000a001' $$,
  '23514', null, 'ACTIVE requires effective_from');
select throws_ok(
  $$ update core.investor_mandates set discovery_mode = 'CLOSED' where id = '00000000-0000-4000-8000-00000000a001' $$,
  '23514', null, 'discovery mode vocabulary is closed');
select throws_ok(
  $$ insert into core.investor_mandates (tenant_id, investor_organisation_id, name, created_by_user_id)
     values (pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-0000000000e1', 'Wrong tenant', pg_temp.rls_id('user_b')) $$,
  '23503', null, 'a mandate cannot name an investor organisation under another tenant');
select throws_ok(
  $$ update core.investor_mandate_constraints set is_hard_exclusion = false where id = '00000000-0000-4000-8000-00000000a101' $$,
  '23514', null, 'HARD_EXCLUSION with is_hard_exclusion = false is contradictory');
select throws_ok(
  $$ update core.investor_mandate_constraints set is_hard_exclusion = true where id = '00000000-0000-4000-8000-00000000a102' $$,
  '23514', null, 'AVOID with is_hard_exclusion = true is contradictory (soft avoid is not a hard exclusion)');
select throws_ok(
  $$ insert into core.investor_mandate_constraints (tenant_id, mandate_id, dimension, operator, value_jsonb, importance)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-00000000a001', 'religion', 'IN', '{"kind":"codes","values":["x"]}', 'AVOID') $$,
  '23514', null, 'a protected characteristic is not a dimension');
select throws_ok(
  $$ insert into core.investor_mandate_constraints (tenant_id, mandate_id, dimension, operator, value_jsonb, importance)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-00000000a001', 'stage', 'SQL', '{"kind":"text","text":"drop table"}', 'MUST') $$,
  '23514', null, 'operator vocabulary is closed; nothing executable is accepted');
select throws_ok(
  $$ insert into core.investor_mandate_constraints (tenant_id, mandate_id, dimension, operator, value_jsonb, importance)
     values (pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-00000000a001', 'stage', 'IN', '{"kind":"codes","values":["seed"]}', 'MUST') $$,
  '23503', null, 'a constraint cannot name a mandate under another tenant');
select is((select discovery_mode from core.investor_mandates where id = '00000000-0000-4000-8000-00000000a001'), 'EXPLORATORY',
  'exploratory mode coexists with a hard exclusion (neither rewrites the other)');

-- User A ------------------------------------------------------------------------
select pg_temp.act_as_user_a();
select is((select count(*)::int from core.investor_mandates where id = '00000000-0000-4000-8000-00000000a001'), 1, 'mandates: A -> Mandate A visible');
select is((select count(*)::int from core.investor_mandates where id = '00000000-0000-4000-8000-00000000b001'), 0, 'mandates: A -> Mandate B invisible (valid id, wrong tenant)');
select is((select count(*)::int from core.investor_mandate_constraints where mandate_id = '00000000-0000-4000-8000-00000000a001'), 2, 'constraints: A reads Mandate A constraints');
select is((select count(*)::int from core.investor_mandate_constraints where id = '00000000-0000-4000-8000-00000000b101'), 0, 'constraints: a guessed constraint B id leaks nothing');
select throws_ok(
  $$ update core.investor_mandates set status = 'CLOSED', effective_to = now() where id = '00000000-0000-4000-8000-00000000a001' $$,
  '42501', null, 'mandates: a browser principal cannot write');
select throws_ok(
  $$ update core.investor_mandate_constraints set importance = 'HARD_EXCLUSION', is_hard_exclusion = true where id = '00000000-0000-4000-8000-00000000a102' $$,
  '42501', null, 'constraints: a browser principal cannot escalate an AVOID into a hard exclusion');
select throws_ok(
  $$ delete from core.investor_mandates where id = '00000000-0000-4000-8000-00000000a001' $$,
  '42501', null, 'mandates: a browser principal cannot delete');

-- User B ------------------------------------------------------------------------
select pg_temp.act_as_user_b();
select is((select count(*)::int from core.investor_mandates where id = '00000000-0000-4000-8000-00000000b001'), 1, 'mandates: B -> Mandate B visible');
select is((select count(*)::int from core.investor_mandates where raw_mandate_text like '%DO-NOT-EMIT%'), 0, 'mandates: B cannot read A''s raw mandate text');
select is((select count(*)::int from core.investor_mandate_constraints where mandate_id = '00000000-0000-4000-8000-00000000a001'), 0, 'constraints: B -> Mandate A constraints invisible');

-- Revoked organisation membership -------------------------------------------------
select pg_temp.act_as_privileged();
insert into core.investor_representatives (tenant_id, investor_organisation_id, organisation_id, user_id, membership_id, business_title)
values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000000e1', pg_temp.rls_id('org_a'), pg_temp.rls_id('user_a'), pg_temp.rls_id('membership_a'), 'Partner');
update identity.organisation_memberships
   set membership_status = 'revoked', left_at = now()
 where id = pg_temp.rls_id('membership_a');
select pg_temp.act_as_user_a();
select is((select count(*)::int from core.investor_mandates), 0, 'mandates: after revocation A (still a current representative) reads nothing');
select is((select count(*)::int from core.investor_mandate_constraints), 0, 'constraints: after revocation A reads nothing');

-- Anonymous and service role ---------------------------------------------------------
select pg_temp.act_as_anonymous();
select throws_ok($$ select * from core.investor_mandates $$, '42501', null, 'mandates: anonymous denied');
select throws_ok($$ select * from core.investor_mandate_constraints $$, '42501', null, 'constraints: anonymous denied');
select throws_ok($$ select * from core.investor_mandate_creation_requests $$, '42501', null, 'creation idempotency: anonymous denied');
select pg_temp.act_as_service_role();
select throws_ok($$ select * from core.investor_mandates $$, '42501', null, 'service_role: no grant on mandates');

select * from finish();

rollback;
