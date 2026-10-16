-- Multilingual Q (2026-10-16): the person's language lives on their own
-- standing row. Well-formed tags only; null is AUTO. The person reads their
-- own row and nobody else's; nobody writes it from a client.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(9);

select has_column('q_runtime', 'person_standing', 'language', 'standing has a language');
select col_is_null('q_runtime', 'person_standing', 'language', 'language is optional (null = AUTO)');

insert into q_runtime.person_standing (user_id, tenant_id, language) values
  (pg_temp.rls_id('user_a'), pg_temp.rls_id('tenant_a'), 'ar'),
  (pg_temp.rls_id('user_b'), pg_temp.rls_id('tenant_b'), null);

select lives_ok(
  $$update q_runtime.person_standing set language = 'ar-AE' where user_id = pg_temp.rls_id('user_b')$$,
  'a regional tag is accepted');
select throws_ok(
  $$update q_runtime.person_standing set language = 'Arabic' where user_id = pg_temp.rls_id('user_b')$$,
  '23514', null, 'a name instead of a tag is refused');
select throws_ok(
  $$update q_runtime.person_standing set language = 'ar; drop table x' where user_id = pg_temp.rls_id('user_b')$$,
  '23514', null, 'anything but a tag is refused');

select pg_temp.act_as_user_a();
select is((select language from q_runtime.person_standing where user_id = pg_temp.rls_id('user_a')),
  'ar', 'the person reads their own language');
select is((select count(*)::int from q_runtime.person_standing where user_id = pg_temp.rls_id('user_b')),
  0, 'nobody reads another person''s language');
select throws_ok(
  $$update q_runtime.person_standing set language = 'en' where user_id = pg_temp.rls_id('user_a')$$,
  '42501', null, 'a client cannot write it, even their own');

select pg_temp.act_as_revoked_user();
select is((select count(*)::int from q_runtime.person_standing), 0,
  'a revoked member reads no standing rows');

select * from finish();
rollback;
