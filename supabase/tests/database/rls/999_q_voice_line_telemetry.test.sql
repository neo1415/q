-- Q voice audit RC5 (20261231592000): per-line telemetry on the voice
-- transcript and the routing decision on a run. Each side keeps only its
-- own telemetry; browsers still read and write nothing.
begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(9);

select has_column('q_runtime', 'voice_line_turns', 'q_run_id', 'a Q line names its run');
select has_column('q_runtime', 'voice_line_turns', 'handed', 'and the words handed to the voice');
select has_column('q_runtime', 'runs', 'routing', 'a run keeps its routing decision');

select lives_ok($$
  insert into q_runtime.voice_line_turns
    (tenant_id, user_id, voice_session_id, role, content, routed, spoken_at,
     q_run_id, handed, audio_started_at, audio_ended_at, diverged)
  values
    (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 'line-999t', 'Q',
     'fifty thousand euros', 'live', now(), gen_random_uuid(),
     'fifty thousand euros', now(), now() + interval '2 seconds', false) $$,
  'a Q line stores its run, handed words and audio times');

select lives_ok($$
  insert into q_runtime.voice_line_turns
    (tenant_id, user_id, voice_session_id, role, content, routed, spoken_at, speech_ended_at)
  values
    (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 'line-999t', 'USER',
     'what is the range', 'live', now(), now()) $$,
  'a person''s line stores when their speech ended');

select throws_ok($$
  insert into q_runtime.voice_line_turns
    (tenant_id, user_id, voice_session_id, role, content, routed, spoken_at, handed)
  values
    (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 'line-999t', 'USER',
     'hello', 'live', now(), 'hello') $$,
  '23514', null, 'a person''s line never carries handed words');

select throws_ok($$
  insert into q_runtime.voice_line_turns
    (tenant_id, user_id, voice_session_id, role, content, routed, spoken_at,
     audio_started_at, audio_ended_at)
  values
    (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 'line-999t', 'Q',
     'hi', 'live', now(), now(), now() - interval '1 second') $$,
  '23514', null, 'audio never ends before it starts');

set local role authenticated;
select throws_ok($$ select q_run_id, handed from q_runtime.voice_line_turns $$,
  '42501', null, 'a browser principal still cannot read the telemetry');
select throws_ok($$ select routing from q_runtime.runs $$,
  '42501', null, 'nor a run''s routing');
reset role;

select * from finish();
rollback;
