-- CQ-Q-008 · Q actions and approvals: closed vocabularies, cryptographic
-- fingerprint format, status/evidence consistency, one open approval per
-- action, tenant-safe foreign keys, Capital Q-owned idempotency identity,
-- and the fact that no browser principal reaches an action or approval row.
--
--   Q proposal ≠ approval ≠ permission ≠ execution ≠ outcome
--
-- EXPECTED DB BEHAVIOUR: the privileged server role can read every row.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION. Authority is enforced by the q-actions service on
-- every read and decision; the database is the second layer.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(31);

-- Fixtures ------------------------------------------------------------------------
insert into q_runtime.conversations (id, tenant_id, user_id, organisation_id, context_type) values
  ('00000000-0000-4000-8000-00000000aa01', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), pg_temp.rls_id('org_a'), 'ORGANISATION');

insert into q_runtime.runs
  (id, tenant_id, actor_user_id, actor_organisation_id, conversation_id, objective, capability, consequence_class, correlation_id)
values
  ('00000000-0000-4000-8000-00000000aa11', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), pg_temp.rls_id('org_a'),
   '00000000-0000-4000-8000-00000000aa01', 'Prepare a meeting request', 'PREPARE_ACTION', 'HIGH',
   'cor_00000000-0000-4000-8000-000000000a01');

insert into q_runtime.actions
  (id, tenant_id, run_id, organisation_id, proposed_by_user_id, action_type, action_version, risk_class,
   target_refs, proposed_payload, proposed_payload_hash, summary, status, idempotency_key)
values
  ('00000000-0000-4000-8000-00000000aa21', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-00000000aa11',
   pg_temp.rls_id('org_a'), pg_temp.rls_id('user_a'), 'test.confirm_required', 1, 'CONFIRM_REQUIRED',
   '[{"kind":"COMPANY","companyId":"00000000-0000-4000-8000-00000000cc01"}]'::jsonb,
   '{"note":"APPROVAL-PAYLOAD-PRIVATE-DO-NOT-LEAK"}'::jsonb,
   'sha256:' || repeat('a', 64), 'Q wants to record a test note.', 'AWAITING_APPROVAL',
   'q_action:00000000-0000-4000-8000-00000000aa11:00000000-0000-4000-8000-00000000aa21');

insert into q_runtime.approvals (id, tenant_id, action_id, requested_from_user_id, status, expires_at) values
  ('00000000-0000-4000-8000-00000000aa31', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-00000000aa21',
   pg_temp.rls_id('user_a'), 'PENDING', now() + interval '1 day');

-- Defaults are honest ---------------------------------------------------------------
select is((select status from q_runtime.actions where id = '00000000-0000-4000-8000-00000000aa21'),
  'AWAITING_APPROVAL', 'an action awaiting a person is AWAITING_APPROVAL');
select is((select executed_at from q_runtime.actions where id = '00000000-0000-4000-8000-00000000aa21'),
  null, 'nothing has executed');
select is((select execution_attempts from q_runtime.actions where id = '00000000-0000-4000-8000-00000000aa21'),
  0, 'no execution has been claimed');
select is((select approved_at from q_runtime.approvals where id = '00000000-0000-4000-8000-00000000aa31'),
  null, 'a pending approval carries no decision');

-- Vocabularies are closed -----------------------------------------------------------
select throws_ok(
  $$ update q_runtime.actions set status = 'SENT' where id = '00000000-0000-4000-8000-00000000aa21' $$,
  '23514', null, 'an action cannot invent a lifecycle state (a model saying SENT is not a state)');
select throws_ok(
  $$ update q_runtime.actions set risk_class = 'PROHIBITED' where id = '00000000-0000-4000-8000-00000000aa21' $$,
  '23514', null, 'a prohibited action never has a row');
select throws_ok(
  $$ update q_runtime.approvals set status = 'CONFIRMED' where id = '00000000-0000-4000-8000-00000000aa31' $$,
  '23514', null, 'an approval cannot invent a status');
select throws_ok(
  $$ update q_runtime.actions set action_type = 'RunSql' where id = '00000000-0000-4000-8000-00000000aa21' $$,
  '23514', null, 'action types are dotted lower_snake_case');

-- The fingerprint has one representation ------------------------------------------------
select throws_ok(
  $$ update q_runtime.actions set proposed_payload_hash = repeat('a', 64) where id = '00000000-0000-4000-8000-00000000aa21' $$,
  '23514', null, 'a payload hash names its algorithm');
select throws_ok(
  $$ update q_runtime.approvals set approval_payload_hash = 'sha256:not-hex' where id = '00000000-0000-4000-8000-00000000aa31' $$,
  '23514', null, 'an approval hash is a sha256 digest');

-- Status and evidence agree by construction --------------------------------------------------
select throws_ok(
  $$ update q_runtime.actions set executed_at = now() where id = '00000000-0000-4000-8000-00000000aa21' $$,
  '23514', null, 'only an EXECUTED action has an execution time');
select throws_ok(
  $$ update q_runtime.actions set status = 'FAILED' where id = '00000000-0000-4000-8000-00000000aa21' $$,
  '23514', null, 'a failed action always says why');
select throws_ok(
  $$ update q_runtime.actions set execution_result = '{"ok":true}'::jsonb where id = '00000000-0000-4000-8000-00000000aa21' $$,
  '23514', null, 'a result exists only for an action that ran');
select throws_ok(
  $$ update q_runtime.approvals set status = 'APPROVED' where id = '00000000-0000-4000-8000-00000000aa31' $$,
  '23514', null, 'APPROVED requires who, when and the approved fingerprint');
select throws_ok(
  $$ update q_runtime.approvals set status = 'REJECTED', rejected_at = now() where id = '00000000-0000-4000-8000-00000000aa31' $$,
  '23514', null, 'REJECTED requires the rejecting person');
select throws_ok(
  $$ update q_runtime.approvals set approved_at = now(), approved_by_user_id = pg_temp.rls_id('user_a') where id = '00000000-0000-4000-8000-00000000aa31' $$,
  '23514', null, 'a pending approval cannot carry decision evidence');
select throws_ok(
  $$ insert into q_runtime.approvals (tenant_id, action_id, requested_from_user_id, expires_at)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-00000000aa21', pg_temp.rls_id('user_a'), now() - interval '1 minute') $$,
  '23514', null, 'an approval expires after it was requested');
select lives_ok(
  $$ update q_runtime.approvals
        set status = 'APPROVED', approved_at = now(), approved_by_user_id = pg_temp.rls_id('user_a'),
            approval_payload_hash = 'sha256:' || repeat('a', 64)
      where id = '00000000-0000-4000-8000-00000000aa31' $$,
  'a complete decision is accepted');

-- One open request per action -----------------------------------------------------------------
select lives_ok(
  $$ insert into q_runtime.approvals (id, tenant_id, action_id, requested_from_user_id, expires_at)
     values ('00000000-0000-4000-8000-00000000aa32', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-00000000aa21',
             pg_temp.rls_id('user_a'), now() + interval '1 day') $$,
  'a new request can follow a decided one (history is kept)');
select throws_ok(
  $$ insert into q_runtime.approvals (tenant_id, action_id, requested_from_user_id, expires_at)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-00000000aa21', pg_temp.rls_id('user_a'), now() + interval '1 day') $$,
  '23505', null, 'two PENDING approvals for one action would be two chances to approve it');

-- Capital Q owns the execution identity ----------------------------------------------------------
select throws_ok(
  $$ insert into q_runtime.actions
       (tenant_id, run_id, organisation_id, proposed_by_user_id, action_type, action_version, risk_class,
        target_refs, proposed_payload, proposed_payload_hash, summary, idempotency_key)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-00000000aa11', pg_temp.rls_id('org_a'), pg_temp.rls_id('user_a'),
             'test.confirm_required', 1, 'CONFIRM_REQUIRED',
             '[{"kind":"COMPANY","companyId":"00000000-0000-4000-8000-00000000cc01"}]'::jsonb, '{}'::jsonb,
             'sha256:' || repeat('b', 64), 'again',
             'q_action:00000000-0000-4000-8000-00000000aa11:00000000-0000-4000-8000-00000000aa21') $$,
  '23505', null, 'the idempotency key is unique');
select throws_ok(
  $$ update q_runtime.actions set idempotency_key = 'provider-response-123' where id = '00000000-0000-4000-8000-00000000aa21' $$,
  '23514', null, 'a provider response id is not the execution identity');

-- Tenancy is a foreign-key path, never a convention ---------------------------------------
select throws_ok(
  $$ insert into q_runtime.approvals (tenant_id, action_id, requested_from_user_id, status, expires_at)
     values (pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-00000000aa21', pg_temp.rls_id('user_b'), 'EXPIRED', now() + interval '1 day') $$,
  '23503', null, 'an approval cannot point at an action in another tenant');
select throws_ok(
  $$ insert into q_runtime.actions
       (tenant_id, run_id, proposed_by_user_id, action_type, action_version, risk_class,
        target_refs, proposed_payload, proposed_payload_hash, summary, idempotency_key)
     values (pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-00000000aa11', pg_temp.rls_id('user_b'),
             'test.confirm_required', 1, 'CONFIRM_REQUIRED',
             '[{"kind":"COMPANY","companyId":"00000000-0000-4000-8000-00000000cc01"}]'::jsonb, '{}'::jsonb,
             'sha256:' || repeat('c', 64), 'x',
             'q_action:00000000-0000-4000-8000-00000000aa11:00000000-0000-4000-8000-00000000aa99') $$,
  '23503', null, 'an action cannot be attached to a run in another tenant');

-- No place for credentials or reasoning ------------------------------------------------------
select hasnt_column('q_runtime', 'actions', 'access_token', 'an action holds no token');
select hasnt_column('q_runtime', 'actions', 'reasoning', 'an action holds no reasoning');
select hasnt_column('q_runtime', 'approvals', 'oauth_token', 'an approval holds no OAuth token');

-- Browser principals ---------------------------------------------------------------------------------
select pg_temp.act_as_user_a();
select throws_ok($$ select count(*) from q_runtime.actions $$,
  '42501', null, 'an authenticated browser session cannot read Q actions, even its own');
select throws_ok($$ select count(*) from q_runtime.approvals $$,
  '42501', null, 'a browser cannot read approvals: an approval id is not a bearer token');
select throws_ok(
  $$ update q_runtime.approvals set status = 'APPROVED' where id = '00000000-0000-4000-8000-00000000aa32' $$,
  '42501', null, 'a browser cannot decide an approval directly');

select pg_temp.act_as_privileged();
select is((select count(*)::int from q_runtime.approvals), 2,
  'the privileged server role reads every approval; authority is enforced by the q-actions service');

select * from finish();
rollback;
