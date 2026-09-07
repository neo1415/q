-- CQ-Q-002 · Q runtime: conversations, messages, runs and append-only run
-- events. Closed vocabularies, tenant-safe foreign keys, terminal-state
-- consistency, unique per-run sequence, append-only history, and the fact
-- that no browser principal reaches a Q row at all.
--
--   Q conversation ≠ Q institutional memory
--   Q run event    ≠ domain event ≠ audit event
--   run accepted   ≠ analysis completed
--
-- EXPECTED DB BEHAVIOUR: the privileged server role can read every row.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION. Ownership (tenant + owner) is enforced by the
-- q-runtime repositories on every read; the database is the second layer.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(38);

-- Fixtures ------------------------------------------------------------------------
insert into q_runtime.conversations (id, tenant_id, user_id, organisation_id, context_type) values
  ('00000000-0000-4000-8000-000000000a01', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), pg_temp.rls_id('org_a'), 'ORGANISATION'),
  ('00000000-0000-4000-8000-000000000b01', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b'), null, 'PERSONAL');

insert into q_runtime.runs
  (id, tenant_id, actor_user_id, actor_organisation_id, conversation_id, objective, capability, consequence_class, correlation_id)
values
  ('00000000-0000-4000-8000-000000000a11', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), pg_temp.rls_id('org_a'),
   '00000000-0000-4000-8000-000000000a01', 'Understand runway', 'INVESTIGATE', 'MODERATE',
   'cor_00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-000000000b11', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b'), null,
   '00000000-0000-4000-8000-000000000b01', 'Assess fit', 'ASSESS', 'MODERATE',
   'cor_00000000-0000-4000-8000-000000000002');

insert into q_runtime.conversation_messages (id, tenant_id, conversation_id, run_id, role, content) values
  ('00000000-0000-4000-8000-000000000a21', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000000a01',
   '00000000-0000-4000-8000-000000000a11', 'USER', 'How much runway does Apex have?');

insert into q_runtime.run_events (id, tenant_id, run_id, sequence, event_type, payload) values
  ('00000000-0000-4000-8000-000000000a31', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000000a11', 1,
   'q.run.started', '{"capability":"INVESTIGATE","status":"RECEIVED"}'::jsonb);

-- Defaults are honest ---------------------------------------------------------------
select is((select status from q_runtime.runs where id = '00000000-0000-4000-8000-000000000a11'),
  'RECEIVED', 'a new run is RECEIVED: accepted, not analysed');
select is((select started_at from q_runtime.runs where id = '00000000-0000-4000-8000-000000000a11'),
  null, 'a run that nothing has picked up has no start time');
select is((select completed_at from q_runtime.runs where id = '00000000-0000-4000-8000-000000000a11'),
  null, 'a live run has no completion time');
select is((select coalesce(orchestration_version, '-') || '/' || coalesce(prompt_bundle_version, '-') || '/' || coalesce(model_policy_version, '-')
             from q_runtime.runs where id = '00000000-0000-4000-8000-000000000a11'),
  '-/-/-', 'no orchestration, prompt or model version is invented before those systems exist');

-- Vocabularies are closed -----------------------------------------------------------
select throws_ok(
  $$ update q_runtime.runs set status = 'THINKING' where id = '00000000-0000-4000-8000-000000000a11' $$,
  '23514', null, 'a run cannot invent a lifecycle state');
select throws_ok(
  $$ update q_runtime.runs set capability = 'FOUNDER_AGENT' where id = '00000000-0000-4000-8000-000000000a11' $$,
  '23514', null, 'capabilities are product outcomes, never agents');
select throws_ok(
  $$ insert into q_runtime.conversation_messages (tenant_id, conversation_id, run_id, role, content)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000000a01', '00000000-0000-4000-8000-000000000a11', 'assistant', 'x') $$,
  '23514', null, 'message roles are Capital Q''s own, not a provider''s');
select throws_ok(
  $$ insert into q_runtime.run_events (tenant_id, run_id, sequence, event_type, payload)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000000a11', 2, 'q.chain_of_thought', '{}'::jsonb) $$,
  '23514', null, 'there is no chain-of-thought event');
select throws_ok(
  $$ insert into q_runtime.run_events (tenant_id, run_id, sequence, event_type, visible_stage, payload)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000000a11', 2, 'q.stage.changed', 'Thinking about the founder...', '{}'::jsonb) $$,
  '23514', null, 'a visible stage is an approved enum, never model text');
select throws_ok(
  $$ update q_runtime.conversation_messages set content_type = 'PROVIDER_JSON' where id = '00000000-0000-4000-8000-000000000a21' $$,
  '23514', null, 'message content is plain text; there is no provider payload type');

-- Bounds ------------------------------------------------------------------------------
select throws_ok(
  $$ insert into q_runtime.conversation_messages (tenant_id, conversation_id, run_id, role, content)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000000a01', '00000000-0000-4000-8000-000000000a11', 'USER', repeat('x', 8001)) $$,
  '23514', null, 'a person''s turn is bounded at the public request limit');
select throws_ok(
  $$ insert into q_runtime.run_events (tenant_id, run_id, sequence, event_type, payload)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000000a11', 2, 'q.message.delta', jsonb_build_object('text', repeat('x', 17000))) $$,
  '23514', null, 'an event payload is bounded');

-- State consistency -------------------------------------------------------------------
select throws_ok(
  $$ update q_runtime.runs set completed_at = now() where id = '00000000-0000-4000-8000-000000000a11' $$,
  '23514', null, 'only a terminal run has a completion time');
select throws_ok(
  $$ update q_runtime.runs set status = 'FAILED', completed_at = now() where id = '00000000-0000-4000-8000-000000000a11' $$,
  '23514', null, 'a failed run always records why');
select throws_ok(
  $$ insert into q_runtime.conversations (tenant_id, user_id, organisation_id, context_type)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), null, 'ORGANISATION') $$,
  '23514', null, 'an organisation context always names the organisation');
select throws_ok(
  $$ insert into q_runtime.conversations (tenant_id, user_id, organisation_id, context_type)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), pg_temp.rls_id('org_b'), 'ORGANISATION') $$,
  '23503', null, 'a conversation cannot be held under an organisation outside its tenant');

-- Tenancy is a foreign-key path, never a convention ---------------------------------------
select throws_ok(
  $$ insert into q_runtime.conversation_messages (tenant_id, conversation_id, run_id, role, content)
     values (pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-000000000a01', '00000000-0000-4000-8000-000000000a11', 'USER', 'x') $$,
  '23503', null, 'a message cannot be attached to a conversation in another tenant');
select throws_ok(
  $$ insert into q_runtime.runs (tenant_id, actor_user_id, conversation_id, objective, capability, consequence_class, correlation_id)
     values (pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b'), '00000000-0000-4000-8000-000000000a01', 'x', 'ANSWER', 'LOW',
             'cor_00000000-0000-4000-8000-000000000003') $$,
  '23503', null, 'a run cannot continue a conversation in another tenant');
select throws_ok(
  $$ insert into q_runtime.run_events (tenant_id, run_id, sequence, event_type, payload)
     values (pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-000000000a11', 2, 'q.stage.changed', '{}'::jsonb) $$,
  '23503', null, 'an event cannot be attached to a run in another tenant');

-- Sequence -----------------------------------------------------------------------------------
select throws_ok(
  $$ insert into q_runtime.run_events (tenant_id, run_id, sequence, event_type, payload)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000000a11', 1, 'q.stage.changed', '{"stage":"CHECKING_EVIDENCE"}'::jsonb) $$,
  '23505', null, '(run, sequence) is unique');
select throws_ok(
  $$ insert into q_runtime.run_events (tenant_id, run_id, sequence, event_type, payload)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000000a11', 0, 'q.stage.changed', '{"stage":"CHECKING_EVIDENCE"}'::jsonb) $$,
  '23514', null, 'sequences start at 1');

-- Append-only ----------------------------------------------------------------------------------
select throws_ok(
  $$ update q_runtime.run_events set payload = '{}'::jsonb where id = '00000000-0000-4000-8000-000000000a31' $$,
  '23514', null, 'a run event is never rewritten');
select throws_ok(
  $$ delete from q_runtime.run_events where id = '00000000-0000-4000-8000-000000000a31' $$,
  '23514', null, 'a run event is never deleted');

-- Idempotency records hold hashes only ---------------------------------------------------------
select throws_ok(
  $$ insert into q_runtime.run_creation_requests (user_id, idempotency_key_hash, request_hash, run_id, tenant_id)
     values (pg_temp.rls_id('user_a'), 'raw-idempotency-key', repeat('a', 64), '00000000-0000-4000-8000-000000000a11', pg_temp.rls_id('tenant_a')) $$,
  '23514', null, 'a raw idempotency key is never stored');

-- No place for reasoning, prompts or provider payloads -----------------------------------------------
select hasnt_column('q_runtime', 'runs', 'reasoning', 'a run has no reasoning column');
select hasnt_column('q_runtime', 'run_events', 'reasoning', 'a run event has no reasoning column');
select hasnt_column('q_runtime', 'conversation_messages', 'raw_provider_payload', 'a message has no provider payload column');
select hasnt_column('q_runtime', 'runs', 'model', 'a run names no model');

-- Browser principals ---------------------------------------------------------------------------------
select pg_temp.act_as_anonymous();
select throws_ok($$ select count(*) from q_runtime.conversations $$,
  '42501', null, 'anonymous cannot read Q conversations');

select pg_temp.act_as_user_a();
select throws_ok($$ select count(*) from q_runtime.conversations $$,
  '42501', null, 'an authenticated browser session cannot read Q conversations, even its own');
select throws_ok($$ select count(*) from q_runtime.runs $$,
  '42501', null, 'a browser cannot read Q runs');
select throws_ok($$ select count(*) from q_runtime.conversation_messages $$,
  '42501', null, 'a browser cannot read Q messages');
select throws_ok($$ select count(*) from q_runtime.run_events $$,
  '42501', null, 'a browser cannot read Q run events');
select throws_ok(
  $$ update q_runtime.runs set status = 'COMPLETED' where id = '00000000-0000-4000-8000-000000000a11' $$,
  '42501', null, 'a browser cannot move a run''s status');

select pg_temp.act_as_user_b();
select throws_ok($$ select count(*) from q_runtime.conversations $$,
  '42501', null, 'another tenant''s member cannot read Q conversations either');

select pg_temp.act_as_service_role();
select throws_ok($$ select count(*) from q_runtime.runs $$,
  '42501', null, 'service_role holds no grant on Q runtime tables');

select pg_temp.act_as_privileged();
select is((select count(*)::int from q_runtime.conversations), 2,
  'the privileged server role reads every conversation; DB privilege is not business authorisation');
select is((select count(*)::int from q_runtime.runs), 2,
  'the privileged server role reads every run; ownership is enforced by the runtime on every read');

select * from finish();
rollback;
