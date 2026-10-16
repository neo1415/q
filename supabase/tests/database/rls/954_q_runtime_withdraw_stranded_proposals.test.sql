-- Live 2026-10-16: a card whose run was cancelled stayed PENDING forever --
-- never approvable, yet counted as already waiting. When a run ends, its
-- open proposals end with it; other runs' proposals are untouched.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(8);

insert into q_runtime.conversations (id, tenant_id, user_id, organisation_id, context_type) values
  ('00000000-0000-4000-8000-00000000f901', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), pg_temp.rls_id('org_a'), 'ORGANISATION');

insert into q_runtime.runs
  (id, tenant_id, actor_user_id, actor_organisation_id, conversation_id, objective, capability, consequence_class, correlation_id, status)
values
  ('00000000-0000-4000-8000-00000000f911', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), pg_temp.rls_id('org_a'),
   '00000000-0000-4000-8000-00000000f901', 'Plan a job', 'PREPARE_ACTION', 'HIGH',
   'cor_00000000-0000-4000-8000-00000000f911', 'AWAITING_APPROVAL'),
  ('00000000-0000-4000-8000-00000000f912', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), pg_temp.rls_id('org_a'),
   '00000000-0000-4000-8000-00000000f901', 'Another card', 'PREPARE_ACTION', 'HIGH',
   'cor_00000000-0000-4000-8000-00000000f912', 'AWAITING_APPROVAL');

insert into q_runtime.actions
  (id, tenant_id, run_id, organisation_id, proposed_by_user_id, action_type, action_version, risk_class,
   target_refs, proposed_payload, proposed_payload_hash, summary, status, idempotency_key)
values
  ('00000000-0000-4000-8000-00000000f921', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-00000000f911',
   pg_temp.rls_id('org_a'), pg_temp.rls_id('user_a'), 'test.confirm_required', 1, 'CONFIRM_REQUIRED',
   '[{"kind":"COMPANY","companyId":"00000000-0000-4000-8000-00000000cc01"}]'::jsonb, '{}'::jsonb, 'sha256:' || repeat('b', 64), 'A job for the team.', 'AWAITING_APPROVAL',
   'q_action:00000000-0000-4000-8000-00000000f911:00000000-0000-4000-8000-00000000f921'),
  ('00000000-0000-4000-8000-00000000f922', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-00000000f912',
   pg_temp.rls_id('org_a'), pg_temp.rls_id('user_a'), 'test.confirm_required', 1, 'CONFIRM_REQUIRED',
   '[{"kind":"COMPANY","companyId":"00000000-0000-4000-8000-00000000cc01"}]'::jsonb, '{}'::jsonb, 'sha256:' || repeat('c', 64), 'Another card.', 'AWAITING_APPROVAL',
   'q_action:00000000-0000-4000-8000-00000000f912:00000000-0000-4000-8000-00000000f922');

insert into q_runtime.approvals (id, tenant_id, action_id, requested_from_user_id, status, expires_at) values
  ('00000000-0000-4000-8000-00000000f931', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-00000000f921',
   pg_temp.rls_id('user_a'), 'PENDING', now() + interval '1 day'),
  ('00000000-0000-4000-8000-00000000f932', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-00000000f922',
   pg_temp.rls_id('user_a'), 'PENDING', now() + interval '1 day');

-- A run that moves but does not end leaves its card open.
update q_runtime.runs set status = 'CANCEL_REQUESTED' where id = '00000000-0000-4000-8000-00000000f911';
select is((select status from q_runtime.approvals where id = '00000000-0000-4000-8000-00000000f931'),
  'PENDING', 'a cancellation still in flight leaves the card as it is');

-- The run ends: its card ends with it.
update q_runtime.runs
   set status = 'CANCELLED', completed_at = now(), failure_code = 'RUN_CANCELLED'
 where id = '00000000-0000-4000-8000-00000000f911';
select is((select status from q_runtime.approvals where id = '00000000-0000-4000-8000-00000000f931'),
  'REVOKED', 'a cancelled run''s pending approval is revoked');
select is((select revoked_by_user_id from q_runtime.approvals where id = '00000000-0000-4000-8000-00000000f931'),
  null, 'revoked by the system, never attributed to the person');
select isnt((select revoked_at from q_runtime.approvals where id = '00000000-0000-4000-8000-00000000f931'),
  null, 'with the time it was revoked');
select is((select status from q_runtime.actions where id = '00000000-0000-4000-8000-00000000f921'),
  'WITHDRAWN', 'and its action is withdrawn');
select is((select version from q_runtime.approvals where id = '00000000-0000-4000-8000-00000000f931'),
  2, 'the approval''s version advances, so a stale writer cannot decide it');

-- Another run's card is untouched.
select is((select status from q_runtime.approvals where id = '00000000-0000-4000-8000-00000000f932'),
  'PENDING', 'another run''s card stays open');
select is((select status from q_runtime.actions where id = '00000000-0000-4000-8000-00000000f922'),
  'AWAITING_APPROVAL', 'and its action still awaits approval');

select * from finish();
rollback;
