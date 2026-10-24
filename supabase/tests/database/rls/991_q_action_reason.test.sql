-- Approval card upgrade (20261231120000): an action's optional reason,
-- bounded, presentation only; the table stays out of every browser role.
begin;

create extension if not exists pgtap with schema extensions;

select plan(5);

select has_column('q_runtime', 'actions', 'reason', 'an action can carry its reason');
select col_is_null('q_runtime', 'actions', 'reason', 'the reason is optional');
select col_type_is('q_runtime', 'actions', 'reason', 'text', 'the reason is text');

select ok(
  exists (
    select 1 from pg_constraint c
     where c.conrelid = 'q_runtime.actions'::regclass
       and c.contype = 'c'
       and pg_get_constraintdef(c.oid) like '%reason%200%'),
  'the reason is at most 200 characters');

select ok(
  not has_table_privilege('authenticated', 'q_runtime.actions', 'select'),
  'no browser principal reads an action, reason included');

select * from finish();
rollback;
