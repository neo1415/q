-- P14 / F5 (20261209130000): the raise's terms are exact, complete and the
-- company's own.
begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(7);

insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug) values
  ('00000000-0000-4000-8000-0000000084c1', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'Terms Co A', 'terms-co-a');
insert into core.capital_objectives (id, tenant_id, company_id, target_amount, currency_code, created_by_user_id)
values ('00000000-0000-4000-8000-0000000084d1', pg_temp.rls_id('tenant_a'),
        '00000000-0000-4000-8000-0000000084c1', 1800000, 'USD', pg_temp.rls_id('user_a'));

select lives_ok(
  $$ update core.capital_objectives
        set valuation_kind = 'CAP', valuation_amount = 12000000, minimum_cheque_amount = 25000
      where id = '00000000-0000-4000-8000-0000000084d1' $$,
  'a cap and a minimum cheque are recorded as exact numbers');
select is((select valuation_amount::text from core.capital_objectives
            where id = '00000000-0000-4000-8000-0000000084d1'), '12000000',
  'the valuation reads back exactly');
select throws_ok(
  $$ update core.capital_objectives set valuation_kind = null
      where id = '00000000-0000-4000-8000-0000000084d1' $$,
  '23514', null, 'an amount without its kind is refused');
select throws_ok(
  $$ update core.capital_objectives set minimum_cheque_amount = 0
      where id = '00000000-0000-4000-8000-0000000084d1' $$,
  '23514', null, 'a zero minimum cheque is refused (unknown is null, never zero)');
select throws_ok(
  $$ update core.capital_objectives set valuation_kind = 'GUESS', valuation_amount = 1
      where id = '00000000-0000-4000-8000-0000000084d1' $$,
  '23514', null, 'only the declared valuation kinds');

select pg_temp.act_as_user_b();
select is((select count(*)::int from core.capital_objectives
            where id = '00000000-0000-4000-8000-0000000084d1'), 0,
  'another tenant never reads the raise or its terms');
select pg_temp.act_as_revoked_user();
select is((select count(*)::int from core.capital_objectives
            where id = '00000000-0000-4000-8000-0000000084d1'), 0,
  'a revoked user reads nothing');

select * from finish();
rollback;
