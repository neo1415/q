-- Fact corrections retain every applicant claim without ever creating two current rows.
-- All identities and answers are synthetic; this test transaction is rolled back.
begin;
create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();
select plan(22);
insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name) values
  ('00000000-0000-4000-8000-00000000dd01', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 'VC', 'Interview Capital');

insert into gateq.gateways (id, tenant_id, investor_organisation_id, organisation_id, public_id, name, created_by_user_id) values
  ('00000000-0000-4000-8000-00000000dd11', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-00000000dd01', pg_temp.rls_id('org_b'),
   'gq_23456789abcdefghjkmnpqrs01', 'Seed programme', pg_temp.rls_id('user_b'));

insert into gateq.gateway_versions
  (id, gateway_id, tenant_id, version_number, status, inbound_mode, public_title, qualification_policy_version,
   created_by_user_id, published_by_user_id, published_at)
values
  ('00000000-0000-4000-8000-00000000dd21', '00000000-0000-4000-8000-00000000dd11', pg_temp.rls_id('tenant_b'), 1,
   'PUBLISHED', 'QUALIFIED', 'Seed-stage fintech', 'gateq-qualification.v1',
   pg_temp.rls_id('user_b'), pg_temp.rls_id('user_b'), now());

insert into gateq.applications (id, tenant_id, gateway_id, gateway_version_id, public_reference) values
  ('00000000-0000-4000-8000-00000000dd31', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-00000000dd11',
   '00000000-0000-4000-8000-00000000dd21', 'ga_23456789abcdefghjkmnpqrs01');



insert into gateq.applications (id, tenant_id, gateway_id, gateway_version_id, public_reference)
select '00000000-0000-4000-8000-00000000dd32', tenant_id, gateway_id, gateway_version_id,
       'ga_23456789abcdefghjkmnpqrs02'
from gateq.applications where id = '00000000-0000-4000-8000-00000000dd31';

create function pg_temp.fact_insert(fact_id uuid, dim text default 'company.name',
                                  app uuid default '00000000-0000-4000-8000-00000000dd31',
                                  claim text default 'Original', turn integer default 1)
returns void language sql as $f$
  insert into gateq.application_facts(id, application_id, tenant_id, dimension, value, provenance, source_turn_seq)
  values(fact_id, app, pg_temp.rls_id('tenant_b'), dim,
         jsonb_build_object('kind', 'TEXT', 'text', claim), 'APPLICANT_PROVIDED', turn)
$f$;

create function pg_temp.fact_replace(previous_id uuid, successor_id uuid, claim text, turn integer)
returns void language plpgsql as $f$
begin
  perform 1 from gateq.applications
   where id = '00000000-0000-4000-8000-00000000dd31' for update;
  set constraints gateq.application_facts_superseded_by_fkey deferred;
  update gateq.application_facts set superseded_at = now(), superseded_by = successor_id
   where id = previous_id and superseded_at is null;
  perform pg_temp.fact_insert(successor_id, 'company.name',
                             '00000000-0000-4000-8000-00000000dd31', claim, turn);
  set constraints all immediate;
end
$f$;

select pg_temp.fact_insert('00000000-0000-4000-8000-00000000dd41');
select throws_ok($$select pg_temp.fact_insert('00000000-0000-4000-8000-00000000dd42')$$,
  '23505', null, 'original insert-before-supersede order reproduces the unique-index failure');
select throws_ok($$update gateq.application_facts set superseded_at = now()
  where id = '00000000-0000-4000-8000-00000000dd41'$$,
  '23514', null, 'paired supersession CHECK still prevents half-retirement');
select throws_ok($$update gateq.application_facts set superseded_at = now(),
  superseded_by = '00000000-0000-4000-8000-00000000dd49'
  where id = '00000000-0000-4000-8000-00000000dd41'$$,
  '23503', null, 'FK remains initially immediate outside the explicit correction transaction');
select lives_ok($$select pg_temp.fact_replace('00000000-0000-4000-8000-00000000dd41',
  '00000000-0000-4000-8000-00000000dd42', 'Corrected', 3)$$,
  'retire then insert succeeds with the real successor ID');
select lives_ok($$select pg_temp.fact_replace('00000000-0000-4000-8000-00000000dd42',
  '00000000-0000-4000-8000-00000000dd43', 'Corrected again', 5)$$,
  'a subsequent correction also succeeds');
select is((select count(*)::int from gateq.application_facts), 3, 'both historical claims survive');
select is((select count(*)::int from gateq.application_facts where superseded_at is null), 1,
  'exactly one claim remains current');
select is((select value->>'text' from gateq.application_facts where id = '00000000-0000-4000-8000-00000000dd41'),
  'Original', 'first payload is never rewritten');
select is((select array_agg(source_turn_seq order by source_turn_seq) from gateq.application_facts),
  array[1,3,5], 'all original source-turn references survive');
select ok((select bool_and(provenance = 'APPLICANT_PROVIDED') from gateq.application_facts),
  'correction never upgrades applicant provenance');
select is((select superseded_by from gateq.application_facts where id = '00000000-0000-4000-8000-00000000dd41'),
  '00000000-0000-4000-8000-00000000dd42'::uuid, 'first history link names the actual successor');
select is((select superseded_by from gateq.application_facts where id = '00000000-0000-4000-8000-00000000dd42'),
  '00000000-0000-4000-8000-00000000dd43'::uuid, 'second history link forms a real chain');
select throws_ok($$select pg_temp.fact_replace('00000000-0000-4000-8000-00000000dd43',
  '00000000-0000-4000-8000-00000000dd44', 'Failed correction', 0)$$,
  '23514', null, 'a failed successor insert rolls back the entire correction');
select is((select count(*)::int from gateq.application_facts), 3, 'rollback adds no history row');
select is((select value->>'text' from gateq.application_facts where superseded_at is null),
  'Corrected again', 'rollback restores the former current claim');

-- Rejected links execute inside pgTAP exception subtransactions and leave no mutation.
create function pg_temp.fact_bad_link(successor_id uuid)
returns void language plpgsql as $f$
begin
  set constraints all deferred;
  update gateq.application_facts set superseded_at = now(), superseded_by = successor_id
   where id = '00000000-0000-4000-8000-00000000dd43';
  set constraints all immediate;
end
$f$;
select throws_ok($$select pg_temp.fact_bad_link('00000000-0000-4000-8000-00000000dd49')$$,
  '23503', null, 'deferred dangling successor is refused at constraint validation');
select throws_ok($$select pg_temp.fact_bad_link('00000000-0000-4000-8000-00000000dd43')$$,
  '23514', null, 'self-referencing workaround is forbidden');
select pg_temp.fact_insert('00000000-0000-4000-8000-00000000dd45', 'company.sector');
select throws_ok($$select pg_temp.fact_bad_link('00000000-0000-4000-8000-00000000dd45')$$,
  '23514', null, 'successor cannot belong to a different dimension');
select pg_temp.fact_insert('00000000-0000-4000-8000-00000000dd46', 'company.name',
  '00000000-0000-4000-8000-00000000dd32');
select throws_ok($$select pg_temp.fact_bad_link('00000000-0000-4000-8000-00000000dd46')$$,
  '23514', null, 'successor cannot belong to another application');
select throws_ok($$select pg_temp.fact_insert('00000000-0000-4000-8000-00000000dd47')$$,
  '23505', null, 'partial unique index remains strict after repeated correction and rollback');
select throws_ok($$insert into gateq.application_sessions
  (application_id, tenant_id, token_hash, expires_at, last_turn_id, last_turn_reply)
  values ('00000000-0000-4000-8000-00000000dd31', pg_temp.rls_id('tenant_b'),
          repeat('c',64), now() + interval '14 days', 'opening', 'Welcome')$$,
  '23514', null, 'historical durable opening key cannot be copied into the legacy session cache');
select lives_ok($$insert into gateq.application_sessions
  (application_id, tenant_id, token_hash, expires_at, last_turn_id, last_turn_reply)
  values ('00000000-0000-4000-8000-00000000dd31', pg_temp.rls_id('tenant_b'),
          repeat('c',64), now() + interval '14 days', 'gateq-opening', 'Welcome')$$,
  'the transcript-free opening key satisfies the unchanged session CHECK');
select * from finish();
rollback;
