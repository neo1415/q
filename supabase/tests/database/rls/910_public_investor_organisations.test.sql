-- R5 (20261222100000): QInvest, AlRayan Investment and Alchemist Doha are
-- canonical, UNCLAIMED investor organisations (public profiles built by Q).
-- No account, membership, representative or declared mandate exists for
-- them; they are visible on the network, linked to their research records,
-- and a browser principal still reads no tenant's investor rows or the
-- server-only research tables.
begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(16);

select is(
  (select count(*)::int from core.investor_organisations
    where id in ('b0075742-0000-4000-8000-0000000000c1',
                 'b0075742-0000-4000-8000-0000000000c2',
                 'b0075742-0000-4000-8000-0000000000c3')),
  3, 'the three investor organisations are seeded');

select is(
  (select count(*)::int from core.investor_organisations
    where id in ('b0075742-0000-4000-8000-0000000000c1',
                 'b0075742-0000-4000-8000-0000000000c2',
                 'b0075742-0000-4000-8000-0000000000c3')
      and marketplace_visibility = 'network_visible'),
  3, 'all three are network_visible (not public_external)');

select is(
  (select count(*)::int from core.investor_organisations
    where id in ('b0075742-0000-4000-8000-0000000000c1',
                 'b0075742-0000-4000-8000-0000000000c2',
                 'b0075742-0000-4000-8000-0000000000c3')
      and verification_state = 'unverified'
      and inbound_preference is null
      and deployment_state is null),
  3, 'unverified, not reachable and deployment unknown: nothing is claimed for them');

select is(
  (select count(*)::int from core.investor_organisations
    where id in ('b0075742-0000-4000-8000-0000000000c1',
                 'b0075742-0000-4000-8000-0000000000c2',
                 'b0075742-0000-4000-8000-0000000000c3')
      and public_description like 'Public profile built by Q from public sources; not on Capital Q.%'),
  3, 'each is marked as a public profile built by Q, not on Capital Q');

select is(
  (select count(*)::int from identity.organisation_memberships
    where organisation_id in ('b0075742-0000-4000-8000-0000000000b1',
                              'b0075742-0000-4000-8000-0000000000b2',
                              'b0075742-0000-4000-8000-0000000000b3')),
  0, 'unclaimed: no membership of any status exists for them');

select is(
  (select count(*)::int from core.investor_representatives
    where investor_organisation_id in ('b0075742-0000-4000-8000-0000000000c1',
                                       'b0075742-0000-4000-8000-0000000000c2',
                                       'b0075742-0000-4000-8000-0000000000c3')),
  0, 'no representative (no person speaks for them)');

select is(
  (select count(*)::int from core.investor_mandates
    where investor_organisation_id in ('b0075742-0000-4000-8000-0000000000c1',
                                       'b0075742-0000-4000-8000-0000000000c2',
                                       'b0075742-0000-4000-8000-0000000000c3')),
  0, 'no declared mandate: public research is never stored as a declared mandate');

select is(
  (select count(*)::int from q_runtime.external_persons
    where tenant_id is null and research_status = 'PREPARED_PUBLIC_SEED'
      and investor_organisation_id is not null),
  3, 'three prepared research records are linked to their investor organisation');

select is(
  (select investor_organisation_id::text from q_runtime.external_persons
    where tenant_id is null and profile_key = 'qa-demo-muhannad-taslaq'),
  'b0075742-0000-4000-8000-0000000000c3',
  'Muhannad Taslaq stands in for Alchemist Doha');

select is(
  (select count(*)::int from q_runtime.external_persons
    where tenant_id is null
      and profile_key in ('qa-demo-shadi-qishta', 'qa-demo-invest-qatar')
      and investor_organisation_id is not null),
  0, 'Shadi Qishta (not an investor) and Invest Qatar (an agency) are not linked');

select throws_ok($$
  update q_runtime.external_persons
     set investor_organisation_id = 'b0075742-0000-4000-8000-0000000000c1'
   where tenant_id is null and profile_key = 'qa-demo-alrayan' $$,
  '23505', null, 'one research record per investor organisation');

select is(
  (select status from identity.tenants where id = 'b0075742-0000-4000-8000-0000000000a1'),
  'active', 'the platform tenant that holds the public profiles exists');

-- Cross-tenant and revoked reads.
select pg_temp.act_as_user_a();
select is(
  (select count(*)::int from core.investor_organisations
    where id in ('b0075742-0000-4000-8000-0000000000c1',
                 'b0075742-0000-4000-8000-0000000000c2',
                 'b0075742-0000-4000-8000-0000000000c3')),
  0, 'a browser principal in another tenant reads none of them directly (the server applies the Discover rule)');
select throws_ok($$ select 1 from q_runtime.external_persons $$, '42501', null,
  'a browser principal cannot read the research records or their link');
select pg_temp.act_as_revoked_user();
select is(
  (select count(*)::int from core.investor_organisations
    where id = 'b0075742-0000-4000-8000-0000000000c1'),
  0, 'a revoked user reads nothing');
select throws_ok($$ select 1 from q_runtime.external_persons $$, '42501', null,
  'a revoked user cannot read the research records');

select * from finish();
rollback;
