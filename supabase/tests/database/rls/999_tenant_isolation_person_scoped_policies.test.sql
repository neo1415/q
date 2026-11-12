-- SEC lane · cross-tenant negative coverage for browser-readable tables
-- whose suites had little or none (130 marks them RLS_REQUIRED):
--
--   core.founder_person_facts          own row only (suite 800 checks B, not writes)
--   core.founder_background_entries    own rows only (no suite before this one)
--   core.investor_portfolio_references members of the investor's organisation
--   q_runtime.person_standing          own row, active member of its tenant
--   integrations.inbound_addresses     own row, active member of its tenant
--   integrations.inbound_emails        own row, active member of its tenant
--
-- For each: a member of tenant A reads only their own, never tenant B's;
-- writes from a browser are refused; a revoked membership loses access where
-- the policy is membership-scoped; anonymous is denied.
--
-- Not asserted, flagged for the owner instead: the two founder tables are
-- person-scoped (user_id = current_app_user_id()), not membership-scoped, so
-- a person whose membership was revoked still reads their own facts and
-- background. That may be intended (it is their own data), but it is not
-- "revoked loses access"; see docs/ai-handoff/RLS-RUNTIME-ROLE-PLAN.md.
--
-- EXPECTED DB BEHAVIOUR: the privileged server role can read every row.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(43);

-- One row per person / tenant (A, B, R) ----------------------------------------------
insert into core.founder_person_facts (user_id, tenant_id, birth_year) values
  (pg_temp.rls_id('user_a'), pg_temp.rls_id('tenant_a'), 1990),
  (pg_temp.rls_id('user_b'), pg_temp.rls_id('tenant_b'), 1985),
  (pg_temp.rls_id('user_r'), pg_temp.rls_id('tenant_r'), 1980);

insert into core.founder_background_entries (id, tenant_id, user_id, title) values
  ('00000000-0000-4000-8000-000000072ba1', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 'Founded Alpha'),
  ('00000000-0000-4000-8000-000000072bb1', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b'), 'Founded Beta (TENANT-B-PRIVATE)'),
  ('00000000-0000-4000-8000-000000072bc1', pg_temp.rls_id('tenant_r'), pg_temp.rls_id('user_r'), 'Founded Gamma');

insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name) values
  ('00000000-0000-4000-8000-000000072ea1', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'VC', 'Tiso Investor A'),
  ('00000000-0000-4000-8000-000000072eb1', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 'VC', 'Tiso Investor B'),
  ('00000000-0000-4000-8000-000000072ec1', pg_temp.rls_id('tenant_r'), pg_temp.rls_id('org_r'), 'VC', 'Tiso Investor R');
insert into core.investor_portfolio_references (id, tenant_id, investor_organisation_id, company_name, created_by_user_id) values
  ('00000000-0000-4000-8000-000000072fa1', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000072ea1', 'Portfolio A Co', pg_temp.rls_id('user_a')),
  ('00000000-0000-4000-8000-000000072fb1', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-000000072eb1', 'Portfolio B Co', pg_temp.rls_id('user_b')),
  ('00000000-0000-4000-8000-000000072fc1', pg_temp.rls_id('tenant_r'), '00000000-0000-4000-8000-000000072ec1', 'Portfolio R Co', pg_temp.rls_id('user_r'));

insert into q_runtime.person_standing (user_id, tenant_id) values
  (pg_temp.rls_id('user_a'), pg_temp.rls_id('tenant_a')),
  (pg_temp.rls_id('user_b'), pg_temp.rls_id('tenant_b')),
  (pg_temp.rls_id('user_r'), pg_temp.rls_id('tenant_r'));

insert into integrations.inbound_addresses (id, tenant_id, user_id, token) values
  ('00000000-0000-4000-8000-000000072aa1', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 'aaaaaaaaaaaaaaaaaaaaaaaaaa'),
  ('00000000-0000-4000-8000-000000072ab1', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b'), 'bbbbbbbbbbbbbbbbbbbbbbbbbb'),
  ('00000000-0000-4000-8000-000000072ac1', pg_temp.rls_id('tenant_r'), pg_temp.rls_id('user_r'), 'cccccccccccccccccccccccccc');
insert into integrations.inbound_emails (id, tenant_id, user_id, inbound_address_id, provider, provider_message_id, from_address, subject) values
  ('00000000-0000-4000-8000-000000072ae1', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), '00000000-0000-4000-8000-000000072aa1',
   'POSTMARK', 'tiso-msg-a', 'sender-a@example.invalid', 'For A'),
  ('00000000-0000-4000-8000-000000072be2', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b'), '00000000-0000-4000-8000-000000072ab1',
   'POSTMARK', 'tiso-msg-b', 'sender-b@example.invalid', 'TENANT-B-PRIVATE term sheet'),
  ('00000000-0000-4000-8000-000000072ce3', pg_temp.rls_id('tenant_r'), pg_temp.rls_id('user_r'), '00000000-0000-4000-8000-000000072ac1',
   'POSTMARK', 'tiso-msg-r', 'sender-r@example.invalid', 'For R');

-- Tenant A member (20) -------------------------------------------------------------------
select pg_temp.act_as_user_a();
select is((select count(*)::int from core.founder_person_facts where user_id = pg_temp.rls_id('user_a')), 1,
  'founder facts: A reads their own (positive control)');
select is((select count(*)::int from core.founder_person_facts where user_id <> pg_temp.rls_id('user_a')), 0,
  'founder facts: A reads nobody else''s, in any tenant');
select is((select count(*)::int from core.founder_background_entries where id = '00000000-0000-4000-8000-000000072ba1'), 1,
  'founder background: A reads their own (positive control)');
select is((select count(*)::int from core.founder_background_entries where id = '00000000-0000-4000-8000-000000072bb1'), 0,
  'founder background: A cannot read tenant B''s line by a guessed id');
select is((select count(*)::int from core.investor_portfolio_references where id = '00000000-0000-4000-8000-000000072fa1'), 1,
  'portfolio: a member of investor A''s organisation reads its references (positive control)');
select is((select count(*)::int from core.investor_portfolio_references where tenant_id <> pg_temp.rls_id('tenant_a')), 0,
  'portfolio: A reads no other tenant''s references');
select is((select count(*)::int from q_runtime.person_standing where user_id = pg_temp.rls_id('user_a')), 1,
  'standing: A reads their own (positive control)');
select is((select count(*)::int from q_runtime.person_standing where user_id = pg_temp.rls_id('user_b')), 0,
  'standing: A cannot read tenant B''s standing');
select is((select count(*)::int from integrations.inbound_addresses where id = '00000000-0000-4000-8000-000000072aa1'), 1,
  'inbound address: A reads their own (positive control)');
select is((select count(*)::int from integrations.inbound_addresses where token = 'bbbbbbbbbbbbbbbbbbbbbbbbbb'), 0,
  'inbound address: A cannot find tenant B''s token, even knowing it');
select is((select count(*)::int from integrations.inbound_emails where id = '00000000-0000-4000-8000-000000072ae1'), 1,
  'inbound email: A reads their own (positive control)');
select is((select count(*)::int from integrations.inbound_emails where subject like '%TENANT-B-PRIVATE%'), 0,
  'inbound email: A cannot read tenant B''s mail');

select throws_ok(
  $$ update core.founder_person_facts set birth_year = 2000 where user_id = pg_temp.rls_id('user_b') $$,
  '42501', null, 'founder facts: A cannot rewrite tenant B''s facts');
select throws_ok(
  $$ delete from core.founder_background_entries where id = '00000000-0000-4000-8000-000000072bb1' $$,
  '42501', null, 'founder background: A cannot delete tenant B''s line');
select throws_ok(
  $$ insert into core.founder_background_entries (tenant_id, user_id, title)
     values (pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b'), 'Planted line') $$,
  '42501', null, 'founder background: A cannot plant a line on tenant B''s founder');
select throws_ok(
  $$ insert into core.investor_portfolio_references (tenant_id, investor_organisation_id, company_name, created_by_user_id)
     values (pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-000000072eb1', 'Planted Co', pg_temp.rls_id('user_a')) $$,
  '42501', null, 'portfolio: A cannot add a reference to investor B');
select throws_ok(
  $$ update q_runtime.person_standing set strikes = 0, suspended_at = null where user_id = pg_temp.rls_id('user_b') $$,
  '42501', null, 'standing: A cannot change tenant B''s standing');
select throws_ok(
  $$ update integrations.inbound_addresses set status = 'REVOKED', revoked_at = now()
      where id = '00000000-0000-4000-8000-000000072ab1' $$,
  '42501', null, 'inbound address: A cannot revoke tenant B''s address');
select throws_ok(
  $$ delete from integrations.inbound_emails where id = '00000000-0000-4000-8000-000000072be2' $$,
  '42501', null, 'inbound email: A cannot delete tenant B''s mail');
select throws_ok(
  $$ insert into integrations.inbound_emails (tenant_id, user_id, inbound_address_id, provider, provider_message_id, from_address)
     values (pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b'), '00000000-0000-4000-8000-000000072ab1', 'POSTMARK', 'tiso-planted', 'x@example.invalid') $$,
  '42501', null, 'inbound email: A cannot plant mail in tenant B''s Q inbox');

-- Tenant B member, the other direction (7) ----------------------------------------------
select pg_temp.act_as_user_b();
select is((select count(*)::int from core.investor_portfolio_references where id = '00000000-0000-4000-8000-000000072fb1'), 1,
  'portfolio: B reads investor B''s references (positive control)');
select is((select count(*)::int from core.founder_person_facts where user_id = pg_temp.rls_id('user_a')), 0,
  'founder facts: B cannot read A''s');
select is((select count(*)::int from core.founder_background_entries where user_id = pg_temp.rls_id('user_a')), 0,
  'founder background: B cannot read A''s');
select is((select count(*)::int from core.investor_portfolio_references where id = '00000000-0000-4000-8000-000000072fa1'), 0,
  'portfolio: B cannot read investor A''s references');
select is((select count(*)::int from q_runtime.person_standing where user_id = pg_temp.rls_id('user_a')), 0,
  'standing: B cannot read A''s');
select is((select count(*)::int from integrations.inbound_addresses where user_id = pg_temp.rls_id('user_a')), 0,
  'inbound address: B cannot read A''s');
select is((select count(*)::int from integrations.inbound_emails where user_id = pg_temp.rls_id('user_a')), 0,
  'inbound email: B cannot read A''s');

-- Revoked member (fixture R: revoked, with a stale active context) (6) --------------
select pg_temp.act_as_revoked_user();
select is((select count(*)::int from core.investor_portfolio_references), 0,
  'portfolio: a revoked member reads nothing, their former organisation''s included');
select is((select count(*)::int from q_runtime.person_standing), 0,
  'standing: a revoked member reads nothing, their own row included');
select is((select count(*)::int from integrations.inbound_addresses), 0,
  'inbound address: a revoked member reads nothing, their own included');
select is((select count(*)::int from integrations.inbound_emails), 0,
  'inbound email: a revoked member reads nothing, their own mail included');
select is((select count(*)::int from core.founder_person_facts where user_id <> pg_temp.rls_id('user_r')), 0,
  'founder facts: a revoked member reads nobody else''s');
select is((select count(*)::int from core.founder_background_entries where user_id <> pg_temp.rls_id('user_r')), 0,
  'founder background: a revoked member reads nobody else''s');

-- A loses access the moment their membership is revoked (4) ----------------------------
select pg_temp.act_as_privileged();
update identity.organisation_memberships
   set membership_status = 'revoked', left_at = now()
 where id = pg_temp.rls_id('membership_a');
select pg_temp.act_as_user_a();
select is((select count(*)::int from core.investor_portfolio_references), 0,
  'portfolio: after revocation A reads nothing');
select is((select count(*)::int from q_runtime.person_standing), 0,
  'standing: after revocation A reads nothing');
select is((select count(*)::int from integrations.inbound_addresses), 0,
  'inbound address: after revocation A reads nothing');
select is((select count(*)::int from integrations.inbound_emails), 0,
  'inbound email: after revocation A reads nothing');

-- Anonymous (6) --------------------------------------------------------------------------
select pg_temp.act_as_anonymous();
select throws_ok($$ select * from core.founder_person_facts $$, '42501', null, 'founder facts: anonymous denied');
select throws_ok($$ select * from core.founder_background_entries $$, '42501', null, 'founder background: anonymous denied');
select throws_ok($$ select * from core.investor_portfolio_references $$, '42501', null, 'portfolio: anonymous denied');
select throws_ok($$ select * from q_runtime.person_standing $$, '42501', null, 'standing: anonymous denied');
select throws_ok($$ select * from integrations.inbound_addresses $$, '42501', null, 'inbound address: anonymous denied');
select throws_ok($$ select * from integrations.inbound_emails $$, '42501', null, 'inbound email: anonymous denied');

select pg_temp.act_as_privileged();

select * from finish();

rollback;
