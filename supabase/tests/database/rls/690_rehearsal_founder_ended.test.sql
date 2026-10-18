-- 20261128090000 · q_runtime.rehearsals: a rehearsal the person ended
-- themselves is FOUNDER_ENDED, distinct from the played person leaving
-- (LEFT_EARLY). Outcomes stay a closed set.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(3);

select lives_ok(
  $$ insert into q_runtime.rehearsals
       (tenant_id, user_id, counterpart_kind, counterpart_id, counterpart_name, persona, outcome)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 'INVESTOR_ORGANISATION',
             '00000000-0000-4000-8000-0000000069f1', 'Fund One', '{}', 'FOUNDER_ENDED') $$,
  'a rehearsal the founder ended is recorded as FOUNDER_ENDED');
select lives_ok(
  $$ insert into q_runtime.rehearsals
       (tenant_id, user_id, counterpart_kind, counterpart_id, counterpart_name, persona, outcome)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 'INVESTOR_ORGANISATION',
             '00000000-0000-4000-8000-0000000069f1', 'Fund One', '{}', 'LEFT_EARLY') $$,
  'the played person leaving is still LEFT_EARLY');
select throws_ok(
  $$ insert into q_runtime.rehearsals
       (tenant_id, user_id, counterpart_kind, counterpart_id, counterpart_name, persona, outcome)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 'COMPANY',
             '00000000-0000-4000-8000-0000000069f2', 'C', '{}', 'MAYBE') $$,
  '23514', null, 'outcomes are still a closed set');

select * from finish();
rollback;
