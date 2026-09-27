-- R34 safety · communication.blocks, communication.reports,
-- communication.report_reasons.
--
-- Only active members of the blocking (reporting) organisation read its
-- block (report) rows; the blocked side reads nothing; never another
-- tenant's rows, never after membership is revoked, never anonymously. No
-- client writes. While a block is active no message or edit can be
-- inserted, even by the server role; an unsend still can.
--
-- EXPECTED DB BEHAVIOUR: the privileged server role can read every row.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(27);

-- Company A (tenant A) ↔ investor B (tenant B); company R (tenant R, whose
-- only member is revoked) ↔ investor B.
insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug) values
  ('00000000-0000-4000-8000-0000000009c1', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'Safety Co A', 'safety-co-a'),
  ('00000000-0000-4000-8000-0000000009c2', pg_temp.rls_id('tenant_r'), pg_temp.rls_id('org_r'), 'Safety Co R', 'safety-co-r');
insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name) values
  ('00000000-0000-4000-8000-0000000009e2', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 'VC', 'Safety Capital B');
insert into network.relationships (id, tenant_id, company_id, investor_organisation_id, current_state) values
  ('00000000-0000-4000-8000-000000009b01', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000009c1', '00000000-0000-4000-8000-0000000009e2', 'CONNECTED'),
  ('00000000-0000-4000-8000-000000009b02', pg_temp.rls_id('tenant_r'), '00000000-0000-4000-8000-0000000009c2', '00000000-0000-4000-8000-0000000009e2', 'CONNECTED');
insert into communication.conversations (id, tenant_id, relationship_id) values
  ('00000000-0000-4000-8000-000000009f01', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000009b01');
insert into communication.messages (id, tenant_id, conversation_id, sender_user_id, sender_side, kind, body, idempotency_key) values
  ('00000000-0000-4000-8000-000000009d01', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000009f01', pg_temp.rls_id('user_b'), 'INVESTOR', 'TEXT', 'Hello from B', 'safety-b-0001');

-- A blocks B on A↔B; R (as a server write) blocks B on R↔B.
insert into communication.blocks (id, tenant_id, relationship_id, blocker_organisation_id, blocker_user_id, blocker_side, blocked_organisation_id, idempotency_key) values
  ('00000000-0000-4000-8000-000000009a01', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000009b01', pg_temp.rls_id('org_a'), pg_temp.rls_id('user_a'), 'COMPANY', pg_temp.rls_id('org_b'), 'block-a-0001'),
  ('00000000-0000-4000-8000-000000009a02', pg_temp.rls_id('tenant_r'), '00000000-0000-4000-8000-000000009b02', pg_temp.rls_id('org_r'), pg_temp.rls_id('user_r'), 'COMPANY', pg_temp.rls_id('org_b'), 'block-r-0001');
-- A reports B's message; B reports the A↔B thread.
insert into communication.reports (id, tenant_id, relationship_id, message_id, reporter_organisation_id, reporter_user_id, reason_code, note, idempotency_key) values
  ('00000000-0000-4000-8000-000000009e01', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000009b01', '00000000-0000-4000-8000-000000009d01', pg_temp.rls_id('org_a'), pg_temp.rls_id('user_a'), 'SPAM', 'Repeated pitches', 'report-a-0001'),
  ('00000000-0000-4000-8000-000000009e02', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000009b01', null, pg_temp.rls_id('org_b'), pg_temp.rls_id('user_b'), 'OTHER', null, 'report-b-0001');

-- Shape ------------------------------------------------------------------------
select is((select bool_and(relrowsecurity) from pg_class where oid in (
  'communication.blocks'::regclass, 'communication.reports'::regclass,
  'communication.report_reasons'::regclass)), true, 'row level security is on for every table');
select ok(not has_table_privilege('authenticated', 'communication.blocks', 'insert')
      and not has_table_privilege('authenticated', 'communication.blocks', 'update')
      and not has_table_privilege('authenticated', 'communication.reports', 'insert'),
  'no client role may write a block or a report');
select ok(not has_table_privilege('anon', 'communication.blocks', 'select')
      and not has_table_privilege('anon', 'communication.reports', 'select'),
  'the anonymous role has no grant');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'private'
              and p.proname in ('communication_blocks_lift_only', 'communication_messages_block_guard')
              and (has_function_privilege('public', p.oid, 'execute')
                   or has_function_privilege('authenticated', p.oid, 'execute'))), 0,
  'the new trigger functions are not executable by PUBLIC or authenticated');
select ok(not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                       where n.nspname = 'communication' and t.typtype = 'e'),
  'report reasons are reference data, not a Postgres enum');

-- Constraints ------------------------------------------------------------------
select throws_ok(
  $$ insert into communication.blocks (tenant_id, relationship_id, blocker_organisation_id, blocker_user_id, blocker_side, blocked_organisation_id, idempotency_key)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000009b01', pg_temp.rls_id('org_a'), pg_temp.rls_id('user_a'), 'COMPANY', pg_temp.rls_id('org_b'), 'block-a-0002') $$,
  '23505', null, 'one active block per side per relationship');
select throws_ok(
  $$ insert into communication.blocks (tenant_id, relationship_id, blocker_organisation_id, blocker_user_id, blocker_side, blocked_organisation_id, idempotency_key)
     values (pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-000000009b01', pg_temp.rls_id('org_b'), pg_temp.rls_id('user_b'), 'INVESTOR', pg_temp.rls_id('org_a'), 'block-b-0009') $$,
  '23503', null, 'a block belongs to its relationship''s tenant');
select throws_ok(
  $$ insert into communication.reports (tenant_id, relationship_id, reporter_organisation_id, reporter_user_id, reason_code, idempotency_key)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000009b01', pg_temp.rls_id('org_a'), pg_temp.rls_id('user_a'), 'NOT_A_REASON', 'report-a-0002') $$,
  '23503', null, 'a report reason comes from the reference data');
select throws_ok(
  $$ insert into communication.reports (tenant_id, relationship_id, reporter_organisation_id, reporter_user_id, reason_code, note, idempotency_key)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000009b01', pg_temp.rls_id('org_a'), pg_temp.rls_id('user_a'), 'SPAM', repeat('x', 501), 'report-a-0003') $$,
  '23514', null, 'a report note is at most 500 characters');
select is((select status from communication.reports where id = '00000000-0000-4000-8000-000000009e01'), 'OPEN',
  'a report opens as OPEN');
select throws_ok(
  $$ update communication.blocks set blocker_side = 'INVESTOR' where id = '00000000-0000-4000-8000-000000009a01' $$,
  '55000', null, 'a block is never rewritten');
select throws_ok(
  $$ delete from communication.blocks where id = '00000000-0000-4000-8000-000000009a01' $$,
  '55000', null, 'a block is never deleted');

-- Block guard ------------------------------------------------------------------
select throws_ok(
  $$ insert into communication.messages (tenant_id, conversation_id, sender_user_id, sender_side, kind, body, idempotency_key)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000009f01', pg_temp.rls_id('user_b'), 'INVESTOR', 'TEXT', 'still there?', 'safety-b-0002') $$,
  '55000', null, 'the blocked side cannot send, even through the server role');
select throws_ok(
  $$ insert into communication.messages (tenant_id, conversation_id, sender_user_id, sender_side, kind, body, idempotency_key)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000009f01', pg_temp.rls_id('user_a'), 'COMPANY', 'TEXT', 'one more thing', 'safety-a-0002') $$,
  '55000', null, 'nor can the blocking side');
select lives_ok(
  $$ insert into communication.messages (tenant_id, conversation_id, sender_user_id, sender_side, kind, revises_message_id, idempotency_key)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000009f01', pg_temp.rls_id('user_b'), 'INVESTOR', 'TOMBSTONE',
             '00000000-0000-4000-8000-000000009d01', 'safety-b-0003') $$,
  'unsending one''s own message stays possible while blocked');
update communication.blocks set lifted_at = clock_timestamp(), lifted_by_user_id = pg_temp.rls_id('user_a')
 where id = '00000000-0000-4000-8000-000000009a01';
select lives_ok(
  $$ insert into communication.messages (tenant_id, conversation_id, sender_user_id, sender_side, kind, body, idempotency_key)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000009f01', pg_temp.rls_id('user_a'), 'COMPANY', 'TEXT', 'welcome back', 'safety-a-0003') $$,
  'once lifted, messages flow again');
select throws_ok(
  $$ update communication.blocks set lifted_at = clock_timestamp() where id = '00000000-0000-4000-8000-000000009a01' $$,
  '55000', null, 'a block is lifted once');
-- Block again for the RLS checks below.
insert into communication.blocks (id, tenant_id, relationship_id, blocker_organisation_id, blocker_user_id, blocker_side, blocked_organisation_id, idempotency_key) values
  ('00000000-0000-4000-8000-000000009a03', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000009b01', pg_temp.rls_id('org_a'), pg_temp.rls_id('user_a'), 'COMPANY', pg_temp.rls_id('org_b'), 'block-a-0003');

-- Positive: A reads its own organisation's blocks and reports ------------------
select pg_temp.act_as_user_a();
select is((select count(*)::int from communication.blocks), 2, 'user A reads its organisation''s blocks, lifted and active');
select is((select count(*)::int from communication.reports), 1, 'user A reads only its organisation''s report');
select is((select count(*)::int from communication.report_reasons), 7, 'user A reads the report reasons');
select throws_ok(
  $$ insert into communication.reports (tenant_id, relationship_id, reporter_organisation_id, reporter_user_id, reason_code, idempotency_key)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000009b01', pg_temp.rls_id('org_a'), pg_temp.rls_id('user_a'), 'SPAM', 'report-a-0004') $$,
  '42501', null, 'user A cannot write a report directly');
select throws_ok(
  $$ update communication.blocks set lifted_at = now() $$,
  '42501', null, 'user A cannot lift a block directly');

-- Blocked side and cross-tenant negative: B never reads a block on it ---------
select pg_temp.act_as_user_b();
select is((select count(*)::int from communication.blocks), 0,
  'the blocked side reads no block, so it is never told who blocked');
select is((select count(*)::int from communication.reports), 1,
  'user B reads only its own organisation''s report, never the one about it');

-- Revoked membership -----------------------------------------------------------
select pg_temp.act_as_revoked_user();
select is((select count(*)::int from communication.blocks), 0,
  'a person whose membership was revoked no longer reads their organisation''s block');

-- Anonymous --------------------------------------------------------------------
select pg_temp.act_as_anonymous();
select throws_ok($$ select count(*) from communication.blocks $$, '42501', null,
  'an anonymous visitor cannot read blocks');
select throws_ok($$ select count(*) from communication.reports $$, '42501', null,
  'an anonymous visitor cannot read reports');

select * from finish();
rollback;
