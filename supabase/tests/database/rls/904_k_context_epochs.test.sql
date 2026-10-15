-- RECOVERY K Part 11 (20261220193000): the fingerprints cached Q context
-- is keyed by change the moment access changes, and only then. Revocation,
-- role expiry, a membership ending, a visibility change, a disclosure
-- revoked and a relationship moving each change a fingerprint; reading it
-- again with nothing changed does not.
begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(16);

create temporary table epochs (label text primary key, value text) on commit drop;

create function pg_temp.actor_epoch() returns text language sql as $$
  select private.actor_authz_epoch(pg_temp.rls_id('user_a'), pg_temp.rls_id('tenant_a'),
                                   pg_temp.rls_id('membership_a'))
$$;
create function pg_temp.subject_epoch() returns text language sql as $$
  select private.subject_access_epoch('00000000-0000-4000-8000-0000009040c1', pg_temp.rls_id('org_b'))
$$;
create function pg_temp.keep(p_label text, p_value text) returns void language sql as $$
  insert into epochs values (p_label, p_value)
$$;

-- Privileges ---------------------------------------------------------------
select ok(not has_function_privilege('authenticated', 'private.actor_authz_epoch(uuid, uuid, uuid)', 'execute'),
  'a browser principal cannot read access fingerprints');
select ok(not has_function_privilege('anon', 'private.subject_access_epoch(uuid, uuid)', 'execute'),
  'nor can anonymous');

-- The asker ------------------------------------------------------------------
select pg_temp.keep('a0', pg_temp.actor_epoch());
select matches((select value from epochs where label = 'a0'), '^[0-9a-f]{32}$', 'a fingerprint, not data');
select is(pg_temp.actor_epoch(), (select value from epochs where label = 'a0'),
  'stable when nothing changed (a cached entry stays reachable)');
select isnt(
  private.actor_authz_epoch(pg_temp.rls_id('user_a'), pg_temp.rls_id('tenant_b'), pg_temp.rls_id('membership_a')),
  (select value from epochs where label = 'a0'),
  'another tenant is another key space');
select isnt(
  private.actor_authz_epoch(pg_temp.rls_id('user_b'), pg_temp.rls_id('tenant_a'), pg_temp.rls_id('membership_a')),
  (select value from epochs where label = 'a0'),
  'another person is another key space');

insert into permissions.grants (id, tenant_id, principal_type, principal_id, capability_id, effect, scope)
select '00000000-0000-4000-8000-000000904091', pg_temp.rls_id('tenant_a'), 'user', pg_temp.rls_id('user_a'),
       c.id, 'ALLOW', jsonb_build_object('tenantId', pg_temp.rls_id('tenant_a'))
  from permissions.capabilities c where c.code = 'company.view';
select pg_temp.keep('a1', pg_temp.actor_epoch());
select isnt((select value from epochs where label = 'a1'), (select value from epochs where label = 'a0'),
  'a new grant changes it');

update permissions.grants set revoked_at = now() where id = '00000000-0000-4000-8000-000000904091';
select pg_temp.keep('a2', pg_temp.actor_epoch());
select isnt((select value from epochs where label = 'a2'), (select value from epochs where label = 'a1'),
  'revoking that grant changes it');

update identity.membership_roles set valid_until = now() - interval '1 second', valid_from = now() - interval '2 days'
 where membership_id = pg_temp.rls_id('membership_a');
select pg_temp.keep('a3', pg_temp.actor_epoch());
select isnt((select value from epochs where label = 'a3'), (select value from epochs where label = 'a2'),
  'a role that has expired changes it');

update identity.organisation_memberships set membership_status = 'revoked', left_at = now()
 where id = pg_temp.rls_id('membership_a');
select isnt(pg_temp.actor_epoch(), (select value from epochs where label = 'a3'),
  'leaving the organisation changes it');

-- The company being asked about, as seen by investor organisation B ------------
insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug, marketplace_visibility) values
  ('00000000-0000-4000-8000-0000009040c1', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'),
   'Epoch Co', 'epoch-co-904', 'network_visible');
insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name) values
  ('00000000-0000-4000-8000-0000009040e2', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 'VC', 'Epoch Investor');
select pg_temp.keep('s0', pg_temp.subject_epoch());
select is(pg_temp.subject_epoch(), (select value from epochs where label = 's0'), 'stable when nothing changed');
select isnt(
  private.subject_access_epoch('00000000-0000-4000-8000-0000009040c1', pg_temp.rls_id('org_r')),
  (select value from epochs where label = 's0'),
  'another viewer organisation is another key space');

update core.companies set marketplace_visibility = 'founder_private'
 where id = '00000000-0000-4000-8000-0000009040c1';
select pg_temp.keep('s1', pg_temp.subject_epoch());
select isnt((select value from epochs where label = 's1'), (select value from epochs where label = 's0'),
  'the founder hiding the company changes it');

insert into permissions.disclosure_policies
  (id, tenant_id, owner_organisation_id, resource_type, resource_id, scope_type, recipient_type, recipient_id,
   access_level, created_by_user_id)
values ('00000000-0000-4000-8000-000000904092', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'document',
        '00000000-0000-4000-8000-000000904093', 'specifically_shared', 'ORGANISATION', pg_temp.rls_id('org_b'),
        'view', pg_temp.rls_id('user_a'));
select pg_temp.keep('s2', pg_temp.subject_epoch());
update permissions.disclosure_policies set revoked_at = now() + interval '1 second' where id = '00000000-0000-4000-8000-000000904092';
select pg_temp.keep('s3', pg_temp.subject_epoch());
select isnt((select value from epochs where label = 's3'), (select value from epochs where label = 's2'),
  'revoking a disclosure changes it');

insert into network.relationships (id, tenant_id, company_id, investor_organisation_id) values
  ('00000000-0000-4000-8000-000000904ab1', pg_temp.rls_id('tenant_a'),
   '00000000-0000-4000-8000-0000009040c1', '00000000-0000-4000-8000-0000009040e2');
select pg_temp.keep('s4', pg_temp.subject_epoch());
select isnt((select value from epochs where label = 's4'), (select value from epochs where label = 's3'),
  'a relationship between them changes it');

update network.relationships set current_state = 'PASSED', state_updated_at = now() + interval '1 second'
 where id = '00000000-0000-4000-8000-000000904ab1';
select isnt(pg_temp.subject_epoch(), (select value from epochs where label = 's4'),
  'the relationship moving (a pass, a connection) changes it');

select * from finish();
rollback;
