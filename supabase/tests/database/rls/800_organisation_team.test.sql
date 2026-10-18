-- G1/G2 · organisation teams: owners, invitations, join requests,
-- ownership offers (20261207150000_organisation_team.sql).
--
-- Proves:
--   * the owner role and capability exist and map as the UI's three roles;
--   * an active organisation with members keeps at least one owner: the
--     last owner's role cannot end and their membership cannot end, while
--     a hand-over (a second owner first) and non-owners leaving are fine;
--   * invitations hold one admin/member role, a normalised email, a token
--     hash and one pending invitation per email;
--   * browser sessions read invitations only as an admin of that
--     organisation (positive, cross-tenant negative, revoked-grant), their
--     own join requests, and ownership offers they are party to; nobody in
--     a browser writes any of it.
--
-- EXPECTED DB BEHAVIOUR: the privileged server role reads and writes every
-- row. APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

-- The owner checks are deferred to commit; this suite never commits, so
-- they run at each statement here.
set constraints all immediate;

select plan(38);

-- Fixture additions ----------------------------------------------------------
-- user_a: owner + admin of org_a (roles dated yesterday so they can end).
-- user_b: also a member of org_a (membership_ba), alongside their own org_b.
insert into pg_temp.rls_fixture (label, id) values
  ('membership_ba', '00000000-0000-4000-8000-0000000000d5'),
  ('invite_a',      '00000000-0000-4000-8000-0000000000e1'),
  ('invite_b',      '00000000-0000-4000-8000-0000000000e2'),
  ('join_b',        '00000000-0000-4000-8000-0000000000e3'),
  ('offer_a',       '00000000-0000-4000-8000-0000000000e4');

insert into identity.membership_roles (membership_id, role_id, valid_from)
select pg_temp.rls_id('membership_a'), r.id, now() - interval '1 day'
  from permissions.roles r where r.code = 'organisation_owner';

insert into identity.organisation_memberships
  (id, tenant_id, organisation_id, user_id, membership_status, joined_at)
values
  (pg_temp.rls_id('membership_ba'), pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'),
   pg_temp.rls_id('user_b'), 'active', now() - interval '10 days');
insert into identity.membership_roles (membership_id, role_id, valid_from)
select pg_temp.rls_id('membership_ba'), r.id, now() - interval '1 day'
  from permissions.roles r where r.code = 'organisation_member';

-- Shape -----------------------------------------------------------------------
select has_table('identity', 'organisation_invitations', 'invitations table');
select has_table('identity', 'organisation_join_requests', 'join requests table');
select has_table('identity', 'organisation_ownership_offers', 'ownership offers table');
select ok((select bool_and(relrowsecurity) from pg_class
            where oid in ('identity.organisation_invitations'::regclass,
                          'identity.organisation_join_requests'::regclass,
                          'identity.organisation_ownership_offers'::regclass)),
  'RLS is on for all three');
select is((select count(*)::int from pg_policies
            where schemaname = 'identity'
              and tablename in ('organisation_invitations', 'organisation_join_requests', 'organisation_ownership_offers')
              and cmd <> 'SELECT'),
  0, 'no client write policy on any of them');
select ok(not has_table_privilege('authenticated', 'identity.organisation_invitations', 'insert'),
  'a browser session cannot insert an invitation');
select ok(not has_table_privilege('anon', 'identity.organisation_invitations', 'select'),
  'anon cannot read invitations');
select hasnt_column('identity', 'organisation_invitations', 'token',
  'the raw token is never stored');

-- Roles -----------------------------------------------------------------------
select is((select count(*)::int
             from permissions.role_capabilities rc
             join permissions.roles r on r.id = rc.role_id
             join permissions.capabilities c on c.id = rc.capability_id
            where r.code = 'organisation_owner' and c.code = 'organisation.own'),
  1, 'the owner role carries organisation.own');
select is((select count(*)::int
             from permissions.role_capabilities rc
             join permissions.roles r on r.id = rc.role_id
             join permissions.capabilities c on c.id = rc.capability_id
            where r.code in ('organisation_admin', 'organisation_member') and c.code = 'organisation.own'),
  0, 'admins and members do not own');

-- Invitation rules -------------------------------------------------------------
select lives_ok(
  $$ insert into identity.organisation_invitations
       (id, tenant_id, organisation_id, email, role_code, token_hash, invited_by_user_id, expires_at)
     values (pg_temp.rls_id('invite_a'), pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'),
             'peter@example.invalid', 'member', repeat('a', 64), pg_temp.rls_id('user_a'),
             now() + interval '7 days') $$,
  'the server records an invitation');
select throws_ok(
  $$ insert into identity.organisation_invitations
       (tenant_id, organisation_id, email, role_code, token_hash, invited_by_user_id, expires_at)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'),
             'peter@example.invalid', 'admin', repeat('b', 64), pg_temp.rls_id('user_a'),
             now() + interval '7 days') $$,
  '23505', null, 'one pending invitation per email per organisation');
select throws_ok(
  $$ insert into identity.organisation_invitations
       (tenant_id, organisation_id, email, role_code, token_hash, invited_by_user_id, expires_at)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'),
             'Grace@Example.invalid', 'member', repeat('c', 64), pg_temp.rls_id('user_a'),
             now() + interval '7 days') $$,
  '23514', null, 'the email is stored normalised');
select throws_ok(
  $$ insert into identity.organisation_invitations
       (tenant_id, organisation_id, email, role_code, token_hash, invited_by_user_id, expires_at)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'),
             'owner@example.invalid', 'owner', repeat('d', 64), pg_temp.rls_id('user_a'),
             now() + interval '7 days') $$,
  '23514', null, 'nobody is invited as an owner');
select throws_ok(
  $$ insert into identity.organisation_invitations
       (tenant_id, organisation_id, email, role_code, token_hash, invited_by_user_id, expires_at)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'),
             'raw@example.invalid', 'member', 'not-a-hash', pg_temp.rls_id('user_a'),
             now() + interval '7 days') $$,
  '23514', null, 'only a SHA-256 hash is accepted as the token');
select throws_ok(
  $$ update identity.organisation_invitations set status = 'accepted', decided_at = now(),
            decided_by_user_id = pg_temp.rls_id('user_b')
      where id = pg_temp.rls_id('invite_a') $$,
  '23514', null, 'accepted always names the membership it created');
select throws_ok(
  $$ insert into identity.organisation_invitations
       (tenant_id, organisation_id, email, role_code, token_hash, invited_by_user_id, expires_at)
     values (pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_a'),
             'cross@example.invalid', 'member', repeat('e', 64), pg_temp.rls_id('user_a'),
             now() + interval '7 days') $$,
  '23503', null, 'an invitation cannot name another tenant''s organisation');

insert into identity.organisation_invitations
  (id, tenant_id, organisation_id, email, role_code, token_hash, invited_by_user_id, expires_at)
values (pg_temp.rls_id('invite_b'), pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'),
        'nina@example.invalid', 'member', repeat('f', 64), pg_temp.rls_id('user_b'),
        now() + interval '7 days');
insert into identity.organisation_join_requests (id, tenant_id, organisation_id, user_id)
values (pg_temp.rls_id('join_b'), pg_temp.rls_id('tenant_r'), pg_temp.rls_id('org_r'), pg_temp.rls_id('user_b'));
insert into identity.organisation_ownership_offers
  (id, tenant_id, organisation_id, from_membership_id, to_membership_id)
values (pg_temp.rls_id('offer_a'), pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'),
        pg_temp.rls_id('membership_a'), pg_temp.rls_id('membership_ba'));

-- RLS -------------------------------------------------------------------------
select pg_temp.act_as_user_a();
select is((select count(*)::int from identity.organisation_invitations
            where organisation_id = pg_temp.rls_id('org_a')),
  1, 'an admin reads their organisation''s invitations');
select is((select count(*)::int from identity.organisation_invitations
            where organisation_id = pg_temp.rls_id('org_b')),
  0, 'but never another tenant''s');
select is((select count(*)::int from identity.organisation_join_requests),
  0, 'nor another organisation''s join requests');
select is((select count(*)::int from identity.organisation_ownership_offers),
  1, 'the owner sees the offer they made');
select throws_ok(
  $$ insert into identity.organisation_invitations
       (tenant_id, organisation_id, email, role_code, token_hash, invited_by_user_id, expires_at)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'),
             'browser@example.invalid', 'member', repeat('9', 64), pg_temp.rls_id('user_a'),
             now() + interval '7 days') $$,
  '42501', null, 'an admin in a browser still cannot write one');

select pg_temp.act_as_user_b();
select is((select count(*)::int from identity.organisation_invitations
            where organisation_id = pg_temp.rls_id('org_a')),
  0, 'a member who is not an admin reads no invitations');
select is((select count(*)::int from identity.organisation_join_requests),
  1, 'a person reads their own join request');
select is((select count(*)::int from identity.organisation_ownership_offers),
  1, 'the member offered ownership sees the offer');

select pg_temp.act_as_revoked_user();
select is((select count(*)::int from identity.organisation_invitations), 0,
  'a revoked member reads no invitations');
select is((select count(*)::int from identity.organisation_ownership_offers), 0,
  'nor offers they are not party to');

-- Revoked grant: user_b made an admin of org_a reads its invitations; once
-- that role ends, they read none.
select pg_temp.reset_test_identity();
insert into identity.membership_roles (membership_id, role_id, valid_from)
select pg_temp.rls_id('membership_ba'), r.id, now() - interval '1 hour'
  from permissions.roles r where r.code = 'organisation_admin';
select pg_temp.act_as_user_b();
select is((select count(*)::int from identity.organisation_invitations
            where organisation_id = pg_temp.rls_id('org_a')),
  1, 'made an admin, they read the invitations');
select pg_temp.reset_test_identity();
update identity.membership_roles set valid_until = now()
 where membership_id = pg_temp.rls_id('membership_ba')
   and role_id = (select id from permissions.roles where code = 'organisation_admin');
select pg_temp.act_as_user_b();
select is((select count(*)::int from identity.organisation_invitations
            where organisation_id = pg_temp.rls_id('org_a')),
  0, 'the admin role ended, they read none');

-- The last-owner invariant ------------------------------------------------------
select pg_temp.reset_test_identity();
select throws_ok(
  $$ update identity.membership_roles set valid_until = now()
      where membership_id = pg_temp.rls_id('membership_a')
        and role_id = (select id from permissions.roles where code = 'organisation_owner') $$,
  '23514', null, 'the last owner cannot step down');
select throws_ok(
  $$ delete from identity.membership_roles
      where membership_id = pg_temp.rls_id('membership_a')
        and role_id = (select id from permissions.roles where code = 'organisation_owner') $$,
  '23514', null, 'nor have the owner role deleted');
select throws_ok(
  $$ update identity.organisation_memberships set membership_status = 'left', left_at = now()
      where id = pg_temp.rls_id('membership_a') $$,
  '23514', null, 'nor leave');
select throws_ok(
  $$ update identity.organisation_memberships set membership_status = 'revoked', left_at = now()
      where id = pg_temp.rls_id('membership_a') $$,
  '23514', null, 'nor be removed');
select lives_ok(
  $$ update identity.organisation_memberships set membership_status = 'left', left_at = now()
      where id = pg_temp.rls_id('membership_b') $$,
  'a member who is not an owner leaves freely');

-- Hand-over: user_b accepts ownership; then user_a may step down and leave.
select lives_ok(
  $$ insert into identity.membership_roles (membership_id, role_id, valid_from)
     select pg_temp.rls_id('membership_ba'), r.id, now() - interval '1 minute'
       from permissions.roles r where r.code = 'organisation_owner' $$,
  'a second owner is made');
select lives_ok(
  $$ update identity.membership_roles set valid_until = now()
      where membership_id = pg_temp.rls_id('membership_a')
        and role_id = (select id from permissions.roles where code = 'organisation_owner') $$,
  'with another owner, the first steps down');
select lives_ok(
  $$ update identity.organisation_memberships set membership_status = 'left', left_at = now()
      where id = pg_temp.rls_id('membership_a') $$,
  'and leaves');
select lives_ok(
  $$ update identity.organisation_memberships set membership_status = 'left', left_at = now()
      where id = pg_temp.rls_id('membership_ba') $$,
  'the very last person leaving leaves nobody to own; the team service refuses that (code-level test)');

select * from finish();
rollback;
