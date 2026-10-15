-- D (20261227100000): Qatar Development Bank, Rasmal Ventures and Doha Tech
-- Angels are canonical, UNCLAIMED investor organisations built from public
-- research, like the three of 20261222100000. QIA's Fund of Funds programme
-- invests in funds, so it is a research record only, never an investor
-- organisation a founder could be routed to. No account, membership,
-- representative or mandate exists for any of them.
begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(9);

select is(
  (select count(*)::int from core.investor_organisations
    where id in ('b0075742-0000-4000-8000-0000000000c4',
                 'b0075742-0000-4000-8000-0000000000c5',
                 'b0075742-0000-4000-8000-0000000000c6')
      and marketplace_visibility = 'network_visible'
      and verification_state = 'unverified'
      and inbound_preference is null
      and deployment_state is null
      and public_description like 'Public profile built by Q from public sources; not on Capital Q.%'),
  3, 'three more unclaimed public investor profiles, claiming nothing for them');

select is(
  (select count(*)::int from identity.organisation_memberships
    where organisation_id in ('b0075742-0000-4000-8000-0000000000b4',
                              'b0075742-0000-4000-8000-0000000000b5',
                              'b0075742-0000-4000-8000-0000000000b6')),
  0, 'unclaimed: no membership');

select is(
  (select count(*)::int from core.investor_representatives
    where investor_organisation_id in ('b0075742-0000-4000-8000-0000000000c4',
                                       'b0075742-0000-4000-8000-0000000000c5',
                                       'b0075742-0000-4000-8000-0000000000c6')),
  0, 'no representative');

select is(
  (select count(*)::int from core.investor_mandates
    where investor_organisation_id in ('b0075742-0000-4000-8000-0000000000c4',
                                       'b0075742-0000-4000-8000-0000000000c5',
                                       'b0075742-0000-4000-8000-0000000000c6')),
  0, 'no declared mandate');

select is(
  (select count(*)::int from q_runtime.external_persons
    where tenant_id is null and research_status = 'PREPARED_PUBLIC_SEED'
      and profile_key in ('qa-demo-qdb', 'qa-demo-rasmal', 'qa-demo-doha-tech-angels', 'qa-demo-qia-fof')),
  4, 'four more prepared public research records');

select is(
  (select investor_organisation_id from q_runtime.external_persons
    where tenant_id is null and profile_key = 'qa-demo-qia-fof'),
  null::uuid, 'QIA Fund of Funds invests in funds: not linked to an investor organisation');

select is(
  (select count(*)::int from q_runtime.external_persons
    where tenant_id is null and research_status = 'PREPARED_PUBLIC_SEED'
      and quotes <> '[]'::jsonb),
  0, 'no prepared public profile carries a quote');

select pg_temp.act_as_user_a();
select is(
  (select count(*)::int from core.investor_organisations
    where id in ('b0075742-0000-4000-8000-0000000000c4',
                 'b0075742-0000-4000-8000-0000000000c5',
                 'b0075742-0000-4000-8000-0000000000c6')),
  0, 'a browser principal in another tenant reads none of them directly');
select pg_temp.act_as_revoked_user();
select throws_ok($$ select 1 from q_runtime.external_persons $$, '42501', null,
  'a revoked user cannot read the research records');

select * from finish();
rollback;
