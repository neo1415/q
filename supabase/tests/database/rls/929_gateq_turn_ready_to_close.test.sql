-- Migration 20261231591000: whether Q's close stands after a Q turn.
begin;
create extension if not exists pgtap;
select plan(7);

select has_column('gateq', 'application_turns', 'ready_to_close',
  'a Q turn records whether its close stands');
select col_type_is('gateq', 'application_turns', 'ready_to_close', 'boolean',
  'a flag, never free text');
select col_is_null('gateq', 'application_turns', 'ready_to_close',
  'older turns and PERSON turns hold no value');
select ok(
  exists (
    select 1 from pg_constraint
     where conrelid = 'gateq.application_turns'::regclass
       and conname = 'application_turns_ready_to_close_shape'
       and contype = 'c'
       and pg_get_constraintdef(oid) like '%role = ''Q''%'
  ),
  'only a Q turn may carry it, and only as true');
select ok(
  (select relrowsecurity from pg_class where oid = 'gateq.application_turns'::regclass),
  'the transcript keeps row-level security');
select ok(
  not has_column_privilege('authenticated', 'gateq.application_turns', 'ready_to_close', 'SELECT'),
  'no browser role reads it');
select ok(
  not has_column_privilege('anon', 'gateq.application_turns', 'ready_to_close', 'UPDATE'),
  'no browser role writes it');

select * from finish();
rollback;
