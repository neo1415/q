-- Inbound email · integrations.inbound_addresses, integrations.inbound_emails.
--
-- A person reads their own Q address token and the email that arrived at
-- it, only while an active member of the row's tenant; never another
-- tenant's, never after their membership is revoked. No client writes.
-- Email rows are append-only; an address only ever revokes; one ACTIVE
-- address per person; one row per Postmark MessageID.
--
-- EXPECTED DB BEHAVIOUR: the privileged server role can read every row.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(24);

insert into integrations.inbound_addresses (id, tenant_id, user_id, token) values
  ('00000000-0000-4000-8000-0000000071a1', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 'aaaaaaaaaaaaaaaaaaaaaaaaaa'),
  ('00000000-0000-4000-8000-0000000071a2', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b'), 'bbbbbbbbbbbbbbbbbbbbbbbbbb'),
  ('00000000-0000-4000-8000-0000000071a3', pg_temp.rls_id('tenant_r'), pg_temp.rls_id('user_r'), 'rrrrrrrrrrrrrrrrrrrrrrrrrr');
insert into integrations.inbound_emails
  (id, tenant_id, user_id, inbound_address_id, provider, provider_message_id, from_address, subject, text_body, attachments) values
  ('00000000-0000-4000-8000-0000000071e1', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), '00000000-0000-4000-8000-0000000071a1',
   'POSTMARK', 'pm-a-1', 'sender@example.invalid', 'Hello A', 'Body A', '[{"name":"deck.pdf","contentType":"application/pdf","size":1200}]'),
  ('00000000-0000-4000-8000-0000000071e2', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b'), '00000000-0000-4000-8000-0000000071a2',
   'POSTMARK', 'pm-b-1', 'sender@example.invalid', 'Hello B', 'Body B', '[]'),
  ('00000000-0000-4000-8000-0000000071e3', pg_temp.rls_id('tenant_r'), pg_temp.rls_id('user_r'), '00000000-0000-4000-8000-0000000071a3',
   'POSTMARK', 'pm-r-1', 'sender@example.invalid', 'Hello R', 'Body R', '[]');

-- Shape ------------------------------------------------------------------------
select is((select bool_and(relrowsecurity) from pg_class where oid in (
  'integrations.inbound_addresses'::regclass, 'integrations.inbound_emails'::regclass)), true,
  'row level security is on for both tables');
select ok(not has_table_privilege('authenticated', 'integrations.inbound_emails', 'insert')
      and not has_table_privilege('authenticated', 'integrations.inbound_emails', 'update')
      and not has_table_privilege('authenticated', 'integrations.inbound_addresses', 'insert')
      and not has_table_privilege('authenticated', 'integrations.inbound_addresses', 'update'),
  'no client grant writes either table');

-- Constraints ------------------------------------------------------------------
select throws_ok(
  $$ insert into integrations.inbound_addresses (tenant_id, user_id, token)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 'cccccccccccccccccccccccccc') $$,
  '23505', null, 'one ACTIVE address per person');
select throws_ok(
  $$ insert into integrations.inbound_addresses (tenant_id, user_id, token)
     values (pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b'), 'NOT-A-TOKEN') $$,
  '23514', null, 'a token is 26 lowercase base32 characters');
select throws_ok(
  $$ insert into integrations.inbound_emails (tenant_id, user_id, inbound_address_id, provider, provider_message_id, from_address)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), '00000000-0000-4000-8000-0000000071a1', 'POSTMARK', 'pm-a-1', 'x@example.invalid') $$,
  '23505', null, 'one row per provider MessageID');
select throws_ok(
  $$ insert into integrations.inbound_emails (tenant_id, user_id, inbound_address_id, provider, provider_message_id, from_address)
     values (pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_a'), '00000000-0000-4000-8000-0000000071a1', 'POSTMARK', 'pm-x-1', 'x@example.invalid') $$,
  '23503', null, 'an email belongs to its address''s tenant');
select throws_ok(
  $$ insert into integrations.inbound_emails (tenant_id, user_id, inbound_address_id, provider, provider_message_id, from_address, subject)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), '00000000-0000-4000-8000-0000000071a1', 'POSTMARK', 'pm-a-2', 'x@example.invalid', E'a\r\nBcc: y') $$,
  '23514', null, 'a subject carries no line break');
select throws_ok(
  $$ insert into integrations.inbound_emails (tenant_id, user_id, inbound_address_id, provider, provider_message_id, from_address, attachments)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), '00000000-0000-4000-8000-0000000071a1', 'POSTMARK', 'pm-a-3', 'x@example.invalid', '{"bytes":"x"}') $$,
  '23514', null, 'attachments are a list of metadata');
select throws_ok(
  $$ update integrations.inbound_emails set subject = 'changed' where id = '00000000-0000-4000-8000-0000000071e1' $$,
  '42501', null, 'an email row is append-only, even for the server');
select throws_ok(
  $$ delete from integrations.inbound_emails where id = '00000000-0000-4000-8000-0000000071e1' $$,
  '42501', null, 'an email row is never deleted');
select throws_ok(
  $$ update integrations.inbound_addresses set token = 'dddddddddddddddddddddddddd' where id = '00000000-0000-4000-8000-0000000071a1' $$,
  '42501', null, 'an address token never changes');
select lives_ok(
  $$ update integrations.inbound_addresses set status = 'REVOKED', revoked_at = clock_timestamp() where id = '00000000-0000-4000-8000-0000000071a2' $$,
  'the server can revoke an address');
select throws_ok(
  $$ update integrations.inbound_addresses set status = 'ACTIVE', revoked_at = null where id = '00000000-0000-4000-8000-0000000071a2' $$,
  '42501', null, 'a revoked address never comes back');
select lives_ok(
  $$ insert into integrations.inbound_addresses (tenant_id, user_id, token)
     values (pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b'), 'eeeeeeeeeeeeeeeeeeeeeeeeee') $$,
  'after revoking, a person gets a new address');

-- Privileged server role -----------------------------------------------------------
select is((select count(*)::int from integrations.inbound_emails), 3, 'the server role reads every email');

-- Positive: A reads A's own ---------------------------------------------------------
select pg_temp.act_as_user_a();
select is((select token from integrations.inbound_addresses), 'aaaaaaaaaaaaaaaaaaaaaaaaaa', 'user A reads exactly their own address');
select is((select subject from integrations.inbound_emails), 'Hello A', 'user A reads exactly their own email');
select throws_ok($$ insert into integrations.inbound_addresses (tenant_id, user_id, token)
  values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 'ffffffffffffffffffffffffff') $$,
  '42501', null, 'user A cannot issue an address');
select throws_ok($$ insert into integrations.inbound_emails (tenant_id, user_id, inbound_address_id, provider, provider_message_id, from_address)
  values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), '00000000-0000-4000-8000-0000000071a1', 'POSTMARK', 'pm-a-9', 'x@example.invalid') $$,
  '42501', null, 'user A cannot write an email row');

-- Cross-tenant negative ---------------------------------------------------------------
select is((select count(*)::int from integrations.inbound_emails where id = '00000000-0000-4000-8000-0000000071e2'), 0,
  'user A cannot see user B''s email');
select is((select count(*)::int from integrations.inbound_addresses where user_id = pg_temp.rls_id('user_b')), 0,
  'user A cannot see user B''s address');

-- Revoked membership -----------------------------------------------------------------
select pg_temp.act_as_revoked_user();
select is((select count(*)::int from integrations.inbound_emails), 0,
  'a person whose membership was revoked sees no email, not even their own');

-- Anonymous --------------------------------------------------------------------------
select pg_temp.act_as_anonymous();
select throws_ok($$ select count(*) from integrations.inbound_addresses $$, '42501', null,
  'an anonymous visitor cannot read addresses');
select throws_ok($$ select count(*) from integrations.inbound_emails $$, '42501', null,
  'an anonymous visitor cannot read email');

select * from finish();
rollback;
