-- Demo rehearsal access (20261222120000): "this tenant's founders may rehearse
-- with a researched simulation of this prepared public entity". An
-- entitlement only: it never creates or changes a relationship, event,
-- message, meeting, interest or mandate. Server-written; a tenant's active
-- members may read their own tenant's grants; a revoked grant stays as
-- history and nobody in the browser can write.
--
-- EXPECTED DB BEHAVIOUR: the privileged server role writes every row.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION.
begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(21);

-- What the entitlement must never touch.
create temporary table before_counts on commit drop as
select (select count(*) from network.relationships) as relationships,
       (select count(*) from network.relationship_events) as events,
       (select count(*) from core.investor_mandates) as mandates,
       (select count(*)::int from q_runtime.external_persons
         where tenant_id is null and research_status = 'PREPARED_PUBLIC_SEED') as seeds;
grant select on before_counts to authenticated;

-- Positive (server) -----------------------------------------------------------------
select is(
  (select q_runtime.grant_demo_rehearsal_access(pg_temp.rls_id('tenant_a'))),
  (select count(*)::int from q_runtime.external_persons
    where tenant_id is null and research_status = 'PREPARED_PUBLIC_SEED'),
  'a tenant is granted every prepared public entity');
select is(
  (select count(*)::int from q_runtime.demo_rehearsal_access
    where tenant_id = pg_temp.rls_id('tenant_a') and revoked_at is null),
  (select count(*)::int from q_runtime.external_persons
    where tenant_id is null and research_status = 'PREPARED_PUBLIC_SEED'),
  'each grant is live');
select is(
  (select q_runtime.grant_demo_rehearsal_access(pg_temp.rls_id('tenant_a'))),
  0, 'granting again is idempotent');

select is(
  (select count(*)::int from q_runtime.demo_rehearsal_access a
     join q_runtime.external_persons p on p.id = a.external_person_id
    where a.tenant_id = pg_temp.rls_id('tenant_a')
      and p.profile_key in ('qa-demo-shadi-qishta', 'qa-demo-qinvest',
                            'qa-demo-muhannad-taslaq', 'qa-demo-invest-qatar',
                            'qa-demo-alrayan')),
  5, 'the five prepared Qatar entities are among them');

-- Revoked grant: history, and a reload never re-grants it.
select lives_ok(
  $$ update q_runtime.demo_rehearsal_access a
        set revoked_at = clock_timestamp()
       from q_runtime.external_persons p
      where p.id = a.external_person_id and p.profile_key = 'qa-demo-invest-qatar'
        and a.tenant_id = pg_temp.rls_id('tenant_a') $$,
  'a grant can be revoked');
select is(q_runtime.grant_demo_rehearsal_access(pg_temp.rls_id('tenant_a')), 0,
  'a reload does not re-grant a revoked entity');
select is(
  (select count(*)::int from q_runtime.demo_rehearsal_access
    where tenant_id = pg_temp.rls_id('tenant_a') and revoked_at is not null),
  1, 'the revoked grant is kept as history');

-- Constraints -----------------------------------------------------------------------
select throws_ok(
  $$ insert into q_runtime.demo_rehearsal_access (tenant_id, external_person_id)
     select tenant_id, external_person_id from q_runtime.demo_rehearsal_access limit 1 $$,
  '23505', null, 'one grant per tenant and entity');
select throws_ok(
  $$ insert into q_runtime.demo_rehearsal_access (tenant_id, external_person_id)
     values (pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-0000000911f1') $$,
  '23503', null, 'a grant needs a real research record');
select throws_ok(
  $$ insert into q_runtime.demo_rehearsal_access (tenant_id, external_person_id, revoked_at, granted_at)
     select pg_temp.rls_id('tenant_b'), id, now() - interval '1 day', now()
       from q_runtime.external_persons where profile_key = 'qa-demo-qinvest' $$,
  '23514', null, 'a grant cannot be revoked before it was granted');

-- Tenant B gets one grant; tenant R (revoked member) has an old one.
select lives_ok(
  $$ insert into q_runtime.demo_rehearsal_access (tenant_id, external_person_id)
     select pg_temp.rls_id('tenant_b'), id
       from q_runtime.external_persons where profile_key = 'qa-demo-qinvest' $$,
  'tenant B holds one grant');
select lives_ok(
  $$ select q_runtime.grant_demo_rehearsal_access(pg_temp.rls_id('tenant_r')) $$,
  'tenant R holds old grants');

-- It is an entitlement, not a connection.
select is(
  (select (select count(*) from network.relationships) = b.relationships
      and (select count(*) from network.relationship_events) = b.events
      and (select count(*) from core.investor_mandates) = b.mandates
     from before_counts b),
  true, 'no relationship, relationship event or mandate was created or removed');

-- Exposure ----------------------------------------------------------------------------
select pg_temp.act_as_user_a();
select throws_ok($$ select * from q_runtime.demo_rehearsal_access $$, '42501', null,
  'the browser has no access to q_runtime: the API reads for the person');
select pg_temp.act_as_privileged();

-- Defence in depth: were the schema ever exposed, the policies hold.
grant usage on schema q_runtime to authenticated;

select pg_temp.act_as_user_a();
select is((select count(*)::int from q_runtime.demo_rehearsal_access),
  (select seeds from before_counts),
  'user A reads their own tenant''s grants only');
select throws_ok(
  $$ insert into q_runtime.demo_rehearsal_access (tenant_id, external_person_id)
     select pg_temp.rls_id('tenant_a'), id from q_runtime.external_persons limit 1 $$,
  '42501', null, 'the browser cannot grant itself access');
select throws_ok(
  $$ select q_runtime.grant_demo_rehearsal_access(pg_temp.rls_id('tenant_a')) $$,
  '42501', null, 'the browser cannot call the granting function');

select pg_temp.act_as_user_b();
select is((select count(*)::int from q_runtime.demo_rehearsal_access
            where tenant_id = pg_temp.rls_id('tenant_a')), 0,
  'user B cannot read tenant A''s grants');
select is((select count(*)::int from q_runtime.demo_rehearsal_access), 1,
  'user B reads only their own tenant''s grant');

select pg_temp.act_as_revoked_user();
select is((select count(*)::int from q_runtime.demo_rehearsal_access), 0,
  'a revoked member reads nothing, not even their tenant''s old grants');

select pg_temp.act_as_anonymous();
select throws_ok($$ select * from q_runtime.demo_rehearsal_access $$, '42501', null,
  'anonymous denied');
select pg_temp.act_as_privileged();

select * from finish();

rollback;
