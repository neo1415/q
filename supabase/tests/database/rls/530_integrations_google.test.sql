-- BIZ-007 · integrations.google_accounts, integrations.oauth_states,
-- integrations.email_messages.
--
-- A person reads their own connection status and their own mailbox's
-- message metadata, only while an active member of the row's tenant; never
-- another tenant's, never after their membership is revoked, never the
-- encrypted refresh token, and never an OAuth state. No client writes.
--
-- EXPECTED DB BEHAVIOUR: the privileged server role can read every row.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(22);

insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug) values
  ('00000000-0000-4000-8000-0000000007c1', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'Mail Co A', 'mail-co-a');
insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name) values
  ('00000000-0000-4000-8000-0000000007e2', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 'VC', 'Mail Capital B');
insert into network.relationships (id, tenant_id, company_id, investor_organisation_id) values
  ('00000000-0000-4000-8000-000000007b01', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000007c1', '00000000-0000-4000-8000-0000000007e2');

-- A's, B's and the revoked person's mailboxes.
insert into integrations.google_accounts (id, tenant_id, user_id, google_subject, email, scopes, refresh_token_ciphertext) values
  ('00000000-0000-4000-8000-0000000007a1', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), '1001', 'a@example.invalid', array['openid'], decode(repeat('ab', 40), 'hex')),
  ('00000000-0000-4000-8000-0000000007a2', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b'), '1002', 'b@example.invalid', array['openid'], decode(repeat('cd', 40), 'hex')),
  ('00000000-0000-4000-8000-0000000007a3', pg_temp.rls_id('tenant_r'), pg_temp.rls_id('user_r'), '1003', 'r@example.invalid', array['openid'], decode(repeat('ef', 40), 'hex'));
insert into integrations.email_messages
  (id, tenant_id, google_account_id, relationship_id, direction, status, q_action_id, idempotency_key, rfc822_message_id, from_address, to_address, subject, body_text) values
  ('00000000-0000-4000-8000-0000000007d1', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-0000000007a2', '00000000-0000-4000-8000-000000007b01',
   'OUTBOUND', 'SENT', gen_random_uuid(), 'q-action:fixture-b-1', '<b1@capitalq.invalid>', 'b@example.invalid', 'a@example.invalid', 'Hello', 'Body');
insert into integrations.oauth_states (state_hash, tenant_id, user_id, provider, code_verifier_ciphertext, expires_at) values
  (repeat('a', 64), pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 'google', decode(repeat('01', 40), 'hex'), now() + interval '10 minutes');

-- Shape ------------------------------------------------------------------------
select is((select bool_and(relrowsecurity) from pg_class where oid in (
  'integrations.google_accounts'::regclass, 'integrations.oauth_states'::regclass,
  'integrations.email_messages'::regclass)), true, 'row level security is on for every table');
select is((select count(*)::int from pg_policies where schemaname = 'integrations' and tablename = 'oauth_states'), 0,
  'oauth states have no policy: server-internal');
select ok(not has_column_privilege('authenticated', 'integrations.google_accounts', 'refresh_token_ciphertext', 'select'),
  'no client may select the encrypted refresh token');

-- Constraints ------------------------------------------------------------------
select throws_ok(
  $$ insert into integrations.google_accounts (tenant_id, user_id, google_subject, email, scopes, refresh_token_ciphertext)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), '1004', 'a2@example.invalid', array['openid'], decode(repeat('ab', 40), 'hex')) $$,
  '23505', null, 'one live connection per person');
select throws_ok(
  $$ update integrations.google_accounts set status = 'DISCONNECTED', disconnected_at = now()
      where id = '00000000-0000-4000-8000-0000000007a1' $$,
  '23514', null, 'a disconnected account cannot keep its credential');
select throws_ok(
  $$ insert into integrations.email_messages (tenant_id, google_account_id, relationship_id, direction, status, q_action_id, idempotency_key, rfc822_message_id, from_address, to_address)
     values (pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-0000000007a2', '00000000-0000-4000-8000-000000007b01', 'OUTBOUND', 'SENT',
             gen_random_uuid(), 'q-action:fixture-b-1', '<b2@capitalq.invalid>', 'b@example.invalid', 'a@example.invalid') $$,
  '23505', null, 'one send per execution identity');
select throws_ok(
  $$ insert into integrations.email_messages (tenant_id, google_account_id, relationship_id, direction, status, rfc822_message_id, from_address, to_address, body_text, reply_to_email_id)
     values (pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-0000000007a2', '00000000-0000-4000-8000-000000007b01', 'INBOUND', 'RECEIVED',
             '<r1@example.invalid>', 'a@example.invalid', 'b@example.invalid', 'a body', '00000000-0000-4000-8000-0000000007d1') $$,
  '23514', null, 'an inbound reply never carries a body');
select throws_ok(
  $$ insert into integrations.email_messages (tenant_id, google_account_id, relationship_id, direction, status, q_action_id, idempotency_key, rfc822_message_id, from_address, to_address)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000007a2', '00000000-0000-4000-8000-000000007b01', 'OUTBOUND', 'SENT',
             gen_random_uuid(), 'q-action:fixture-x-1', '<x@capitalq.invalid>', 'b@example.invalid', 'a@example.invalid') $$,
  '23503', null, 'a message belongs to its mailbox''s tenant');
select throws_ok(
  $$ insert into integrations.oauth_states (state_hash, tenant_id, user_id, provider, code_verifier_ciphertext, expires_at, return_to)
     values (repeat('b', 64), pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 'google', decode(repeat('01', 40), 'hex'), now() + interval '1 minute', 'https://evil.example/') $$,
  '23514', null, 'the return path is same-origin only');

-- Privileged server role -----------------------------------------------------------
select is((select count(*)::int from integrations.google_accounts), 3, 'the server role reads every account');

-- Positive: A reads A's own status --------------------------------------------------
select pg_temp.act_as_user_a();
select is((select count(*)::int from integrations.google_accounts), 1, 'user A sees exactly one account');
select is((select email from integrations.google_accounts), 'a@example.invalid', 'and it is A''s own');
select throws_ok($$ select refresh_token_ciphertext from integrations.google_accounts $$, '42501', null,
  'user A cannot read even their own encrypted token');
select throws_ok($$ select count(*) from integrations.oauth_states $$, '42501', null,
  'user A cannot read OAuth states');
select throws_ok($$ update integrations.google_accounts set email = 'x@example.invalid' $$, '42501', null,
  'user A cannot write an account');

-- Cross-tenant negative: A never sees B's mailbox or its mail -----------------------
select is((select count(*)::int from integrations.google_accounts where id = '00000000-0000-4000-8000-0000000007a2'), 0,
  'user A cannot see user B''s account');
select is((select count(*)::int from integrations.email_messages), 0,
  'user A cannot see mail from user B''s mailbox, even on a relationship with A''s company');

-- Positive: B reads B's own mail ------------------------------------------------------
select pg_temp.act_as_user_b();
select is((select count(*)::int from integrations.email_messages), 1, 'user B sees their own sent mail');
select throws_ok($$ insert into integrations.email_messages (tenant_id, google_account_id, relationship_id, direction, status, rfc822_message_id, from_address, to_address)
  values (pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-0000000007a2', '00000000-0000-4000-8000-000000007b01', 'INBOUND', 'RECEIVED', '<y@x>', 'a', 'b') $$,
  '42501', null, 'user B cannot write mail rows');

-- Revoked membership -----------------------------------------------------------------
select pg_temp.act_as_revoked_user();
select is((select count(*)::int from integrations.google_accounts), 0,
  'a person whose membership was revoked sees no account, not even their own');

-- Anonymous --------------------------------------------------------------------------
select pg_temp.act_as_anonymous();
select throws_ok($$ select count(*) from integrations.google_accounts $$, '42501', null,
  'an anonymous visitor cannot read accounts');
select throws_ok($$ select count(*) from integrations.email_messages $$, '42501', null,
  'an anonymous visitor cannot read mail');

select * from finish();
rollback;
