-- platform_ops.email_deliveries · SUPPRESSED for reserved test domains.
--
-- A suppressed message is recorded with its reason and is never SENT; the
-- ledger stays append-only and server-only.
--
-- EXPECTED DB BEHAVIOUR: the privileged server role writes and reads rows.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION (only the sender wrapper writes here).

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(9);

select lives_ok(
  $$insert into platform_ops.email_deliveries (source, provider, outcome, error_class, recipient_domain, recipient_hash)
      values ('api.team_invitation', 'SMTP', 'SUPPRESSED', 'RESERVED_TEST_DOMAIN', 'fictional.capitalq.local', repeat('a', 64))$$,
  'a suppressed message is recorded with its reason');
select throws_ok(
  $$insert into platform_ops.email_deliveries (source, provider, outcome, error_class, recipient_domain, recipient_hash)
      values ('api.team_invitation', 'SMTP', 'SUPPRESSED', null, 'example.test', repeat('a', 64))$$,
  '23514', null, 'a suppression always says why');
select throws_ok(
  $$insert into platform_ops.email_deliveries (source, provider, outcome, error_class, recipient_domain, recipient_hash)
      values ('api.team_invitation', 'SMTP', 'SENT', 'RESERVED_TEST_DOMAIN', 'example.test', repeat('a', 64))$$,
  '23514', null, 'a sent row carries no error class');
select lives_ok(
  $$insert into platform_ops.email_deliveries (source, provider, outcome, error_class, recipient_domain, recipient_hash)
      values ('api.team_invitation', 'SMTP', 'SENT', null, 'capitalq.ai', repeat('b', 64))$$,
  'a sent message is still recorded as before');
select throws_ok(
  $$insert into platform_ops.email_deliveries (source, provider, outcome, error_class, recipient_domain, recipient_hash)
      values ('api.team_invitation', 'SMTP', 'FAILED', null, 'capitalq.ai', repeat('b', 64))$$,
  '23514', null, 'a failure still needs its class');
select throws_ok(
  $$insert into platform_ops.email_deliveries (source, provider, outcome, error_class, recipient_domain, recipient_hash)
      values ('api.team_invitation', 'SMTP', 'DELIVERED', null, 'capitalq.ai', repeat('b', 64))$$,
  '23514', null, 'an unknown outcome is refused');
select throws_ok(
  $$update platform_ops.email_deliveries set outcome = 'SENT', error_class = null where outcome = 'SUPPRESSED'$$,
  '23001', null, 'a suppression is never rewritten as sent');

-- Client roles: nothing, including a revoked member.
select pg_temp.act_as('auth_a');
select throws_ok($$select count(*) from platform_ops.email_deliveries$$, '42501', null,
  'an authenticated person cannot read the delivery ledger');
select pg_temp.act_as('auth_r');
select throws_ok(
  $$insert into platform_ops.email_deliveries (source, provider, outcome, error_class, recipient_domain, recipient_hash)
      values ('api.team_invitation', 'SMTP', 'SENT', null, 'capitalq.ai', repeat('c', 64))$$,
  '42501', null, 'a revoked member cannot write a delivery row');

select * from finish();
rollback;
