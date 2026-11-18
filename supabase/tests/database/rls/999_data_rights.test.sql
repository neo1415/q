-- Decision 107 (20261231599107): data rights.
--
--   * the two request ledgers are server-only: RLS on, no browser grant,
--     and an authenticated person reads nothing;
--   * a profile may lose its auth account only once closed, and deleting
--     the auth account of a closed profile nulls the link;
--   * one export in flight per person, one open deletion per person;
--   * erasure mode: the named append-only guards still refuse outside it,
--     and inside it allow only the narrow change (a name, a deletion of the
--     person's private observation, an erased revision statement);
--   * the export-ready notice kind and the private export bucket exist.
begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(20);

-- Ledgers ------------------------------------------------------------------------

select ok((select relrowsecurity from pg_class where oid = 'identity.data_export_requests'::regclass),
  'export requests have RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'identity.account_deletion_requests'::regclass),
  'deletion requests have RLS enabled');
select is((select count(*)::int from information_schema.role_table_grants
            where table_schema = 'identity'
              and table_name in ('data_export_requests', 'account_deletion_requests')
              and grantee in ('anon', 'authenticated', 'public')),
  0, 'no browser role holds any privilege on either ledger');

insert into identity.data_export_requests (user_id, idempotency_key)
values (pg_temp.rls_id('user_a'), 'pgtap-export-a1');
select throws_ok(
  $$ insert into identity.data_export_requests (user_id, idempotency_key)
     values (pg_temp.rls_id('user_a'), 'pgtap-export-a2') $$,
  '23505', null, 'a second export in flight for the same person is refused');
insert into identity.data_export_requests (user_id, idempotency_key)
values (pg_temp.rls_id('user_b'), 'pgtap-export-b1');

insert into identity.account_deletion_requests (user_id, scheduled_for, step_up_method, step_up_at)
values (pg_temp.rls_id('user_a'), now() + interval '14 days', 'password', now());
select throws_ok(
  $$ insert into identity.account_deletion_requests (user_id, scheduled_for, step_up_method, step_up_at)
     values (pg_temp.rls_id('user_a'), now() + interval '14 days', 'otp', now()) $$,
  '23505', null, 'a second open deletion for the same person is refused');
select throws_ok(
  $$ insert into identity.account_deletion_requests (user_id, scheduled_for, step_up_method, step_up_at, requested_at)
     values (pg_temp.rls_id('user_b'), now() - interval '1 day', 'password', now(), now()) $$,
  '23514', null, 'a deletion cannot be scheduled before it was asked for');

select pg_temp.act_as_user_a();
select throws_ok($$ select count(*) from identity.data_export_requests $$,
  '42501', null, 'a signed-in person cannot read the export ledger, even their own rows');
select throws_ok($$ select count(*) from identity.account_deletion_requests $$,
  '42501', null, 'a signed-in person cannot read the deletion ledger');
reset role;

-- Tombstone ----------------------------------------------------------------------

select throws_ok(
  $$ update identity.user_profiles set auth_user_id = null where id = pg_temp.rls_id('user_b') $$,
  '23514', null, 'an active profile cannot lose its auth account');
select throws_ok(
  $$ delete from auth.users where id = pg_temp.rls_id('auth_b') $$,
  '23514', null, 'deleting the auth account of an active profile is refused');

update identity.user_profiles
   set status = 'closed', closed_at = now(), display_name = 'Former user'
 where id = pg_temp.rls_id('user_r');
delete from auth.users where id = pg_temp.rls_id('auth_r');
select is((select auth_user_id from identity.user_profiles where id = pg_temp.rls_id('user_r')),
  null, 'deleting a closed profile''s auth account sets the link null; the tombstone stays');
select throws_ok(
  $$ update identity.user_profiles set status = 'active' where id = pg_temp.rls_id('user_r') $$,
  '23514', null, 'a tombstone without an auth account cannot become active again');

-- Erasure mode -------------------------------------------------------------------

insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug)
values ('00000000-0000-4000-8000-0000000d0102', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'DR Co', 'dr-co-pgtap');
insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name)
values ('00000000-0000-4000-8000-0000000d0103', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 'VC', 'DR Capital');
insert into network.relationships (id, tenant_id, company_id, investor_organisation_id, current_state)
values ('00000000-0000-4000-8000-0000000d0101', pg_temp.rls_id('tenant_a'),
        '00000000-0000-4000-8000-0000000d0102', '00000000-0000-4000-8000-0000000d0103', 'CONNECTED');
insert into communication.meetings
  (id, tenant_id, relationship_id, organiser_user_id, organiser_tenant_id, purpose, starts_at, ends_at,
   time_zone, google_event_id, idempotency_key)
values ('00000000-0000-4000-8000-0000000d0104', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000d0101',
        pg_temp.rls_id('user_a'), pg_temp.rls_id('tenant_a'), 'Intro', now(), now() + interval '30 minutes',
        'Africa/Lagos', 'evtpgtap1', 'pgtap-meeting-1');
insert into communication.meeting_events (meeting_id, tenant_id, seq, occurred_at, speaker_name, speaker_user_id, kind, body)
values ('00000000-0000-4000-8000-0000000d0104', pg_temp.rls_id('tenant_a'), 1, now(), 'Ada A', pg_temp.rls_id('user_a'), 'NOTE', 'We grew 20%');
insert into communication.meeting_private_observations (meeting_id, tenant_id, owner_user_id, source, body, observed_at)
values ('00000000-0000-4000-8000-0000000d0104', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 'SCREEN_SHARE', 'Private note', now());

select throws_ok(
  $$ update communication.meeting_events set speaker_name = 'Former user' where speaker_user_id = pg_temp.rls_id('user_a') $$,
  '55000', null, 'outside erasure mode a transcript name cannot change');
select throws_ok(
  $$ delete from communication.meeting_private_observations where owner_user_id = pg_temp.rls_id('user_a') $$,
  '55000', null, 'outside erasure mode a private observation cannot be deleted');

select set_config('cq.data_rights_erasure', 'on', true);
select throws_ok(
  $$ update communication.meeting_events set body = 'rewritten' where speaker_user_id = pg_temp.rls_id('user_a') $$,
  '55000', null, 'even in erasure mode, what was said cannot be rewritten');
select lives_ok(
  $$ update communication.meeting_events set speaker_name = 'Former user' where speaker_user_id = pg_temp.rls_id('user_a') $$,
  'in erasure mode the speaker''s name can be removed');
select is((select body from communication.meeting_events where speaker_user_id = pg_temp.rls_id('user_a')),
  'We grew 20%', 'the words stay in the other side''s record');
select lives_ok(
  $$ delete from communication.meeting_private_observations where owner_user_id = pg_temp.rls_id('user_a') $$,
  'in erasure mode the person''s private observation can be deleted');
select set_config('cq.data_rights_erasure', '', true);

-- Notice and bucket --------------------------------------------------------------

select lives_ok(
  $$ insert into communication.notifications (tenant_id, user_id, kind, title, dedupe_key)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 'DATA_EXPORT_READY',
             'Your data download is ready', 'data_export_ready:pgtap') $$,
  'the export-ready notice kind is accepted');
select is((select public from storage.buckets where id = 'cq-data-exports-private'),
  false, 'the export bucket exists and is private');

select * from finish();

rollback;
