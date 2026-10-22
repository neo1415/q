-- Organisation activity capability (20261228210000_organisation_activity_capability.sql).
--
-- Proves:
--   * organisation.activity.view exists and is active;
--   * organisation_admin carries it (owners hold organisation_admin beside
--     organisation_owner, so they do too); organisation_member does not;
--   * re-running the grant is idempotent;
--   * no browser role may write the role templates (reference data stays
--     server-owned; nothing here loosens a grant).

begin;

create extension if not exists pgtap with schema extensions;

select plan(7);

select is((select status from permissions.capabilities
            where code = 'organisation.activity.view'),
  'active', 'the capability exists and is active');

select is((select count(*)::int
             from permissions.role_capabilities rc
             join permissions.roles r on r.id = rc.role_id
             join permissions.capabilities c on c.id = rc.capability_id
            where r.code = 'organisation_admin'
              and c.code = 'organisation.activity.view'
              and rc.effect = 'ALLOW'),
  1, 'admins (and so owners) may see the activity feed');

select is((select count(*)::int
             from permissions.role_capabilities rc
             join permissions.roles r on r.id = rc.role_id
             join permissions.capabilities c on c.id = rc.capability_id
            where r.code = 'organisation_member'
              and c.code = 'organisation.activity.view'),
  0, 'members may not');

select lives_ok($$
  insert into permissions.role_capabilities (role_id, capability_id, effect)
  select r.id, c.id, 'ALLOW'
    from permissions.roles r
    join permissions.capabilities c
      on (r.code, c.code) in (('organisation_admin', 'organisation.activity.view'))
  on conflict (role_id, capability_id) do nothing $$,
  're-running the grant is harmless');

select is((select count(*)::int
             from permissions.role_capabilities rc
             join permissions.capabilities c on c.id = rc.capability_id
            where c.code = 'organisation.activity.view'),
  1, 'still exactly one grant of it');

select ok(not has_table_privilege('authenticated', 'permissions.role_capabilities', 'INSERT'),
  'a browser session cannot grant itself capabilities');

select ok(not has_table_privilege('anon', 'permissions.capabilities', 'INSERT'),
  'an anonymous session cannot add capabilities');

select * from finish();
rollback;
