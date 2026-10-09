-- RECOVERY G-D24 (20261220194000): an in-flight run records its engine's
-- heartbeat. Server-only like the rest of q_runtime.runs: no browser role
-- can read or forge it.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(5);

select has_column('q_runtime', 'runs', 'engine_heartbeat_at', 'runs carry an engine heartbeat');
select col_type_is('q_runtime', 'runs', 'engine_heartbeat_at', 'timestamp with time zone', 'a timestamptz');
select col_is_null('q_runtime', 'runs', 'engine_heartbeat_at',
  'nullable: a run no heartbeating engine held keeps the silence rule');
select ok(not has_column_privilege('authenticated', 'q_runtime.runs', 'engine_heartbeat_at', 'update'),
  'a browser principal cannot forge a heartbeat');
select ok(not has_column_privilege('anon', 'q_runtime.runs', 'engine_heartbeat_at', 'select'),
  'nor can anonymous read it');

select * from finish();
rollback;
