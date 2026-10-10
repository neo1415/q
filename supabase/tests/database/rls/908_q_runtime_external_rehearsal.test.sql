-- Rehearsal with a researched external person (20261222092000).
-- 'EXTERNAL_PERSON' is a persona and rehearsal counterpart kind; the public
-- evidence a rehearsal was prepared from is frozen per viewer and brief
-- version. A person reads only their own rows, in a tenant they are an
-- active member of; nobody in the browser writes them.
--
-- EXPECTED DB BEHAVIOUR: the privileged server role writes every row.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(15);

-- Positive (server) -----------------------------------------------------------------
select lives_ok(
  $$ insert into q_runtime.rehearsal_external_subjects
       (id, tenant_id, viewer_user_id, external_person_id, brief_version, evidence_bundle_id,
        subject, brief)
     values ('00000000-0000-4000-8000-0000000908a1', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'),
             '00000000-0000-4000-8000-0000000908f1', 1, '00000000-0000-4000-8000-0000000908b1',
             '{"displayName":"Person One"}', '{"version":1}') $$,
  'the server freezes user A''s evidence for an external person');
select lives_ok(
  $$ insert into q_runtime.rehearsal_external_subjects
       (tenant_id, viewer_user_id, external_person_id, brief_version, subject)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'),
             '00000000-0000-4000-8000-0000000908f1', 2, '{"displayName":"Person One"}') $$,
  'a newer brief version is a new row (history, not overwrite); no brief is thin evidence');
select lives_ok(
  $$ insert into q_runtime.rehearsal_external_subjects
       (tenant_id, viewer_user_id, external_person_id, brief_version, subject)
     values (pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b'),
             '00000000-0000-4000-8000-0000000908f1', 1, '{"displayName":"Person One"}') $$,
  'user B freezes their own evidence for the same person');
select lives_ok(
  $$ insert into q_runtime.rehearsal_external_subjects
       (tenant_id, viewer_user_id, external_person_id, brief_version, subject)
     values (pg_temp.rls_id('tenant_r'), pg_temp.rls_id('user_r'),
             '00000000-0000-4000-8000-0000000908f1', 1, '{"displayName":"Person One"}') $$,
  'the revoked user''s old evidence');
select lives_ok(
  $$ insert into q_runtime.persona_profiles
       (tenant_id, viewer_user_id, subject_kind, subject_id, subject_name, profile, signal_digest)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'),
             'EXTERNAL_PERSON', '00000000-0000-4000-8000-0000000908f1', 'Person One',
             '{"summary":"x"}', 'digest-ext-0001') $$,
  'a persona of an external person is recorded');
select lives_ok(
  $$ insert into q_runtime.rehearsals
       (tenant_id, user_id, counterpart_kind, counterpart_id, counterpart_name, user_role, persona)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 'EXTERNAL_PERSON',
             '00000000-0000-4000-8000-0000000908f1', 'Person One', 'FOUNDER', '{"summary":"x"}') $$,
  'a rehearsal with an external person is recorded, with no investor columns');

-- Constraints -----------------------------------------------------------------------
select throws_ok(
  $$ insert into q_runtime.rehearsal_external_subjects
       (tenant_id, viewer_user_id, external_person_id, brief_version, subject)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'),
             '00000000-0000-4000-8000-0000000908f1', 1, '{}') $$,
  '23505', null, 'one snapshot per viewer, person and brief version');
select throws_ok(
  $$ insert into q_runtime.rehearsal_external_subjects
       (tenant_id, viewer_user_id, external_person_id, brief_version, subject)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'),
             '00000000-0000-4000-8000-0000000908f2', 0, '{}') $$,
  '23514', null, 'a brief version starts at one');
select throws_ok(
  $$ insert into q_runtime.persona_profiles
       (tenant_id, viewer_user_id, subject_kind, subject_id, subject_name, profile, signal_digest)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'),
             'PERSON', '00000000-0000-4000-8000-0000000908f3', 'X', '{}', 'digest-ext-0002') $$,
  '23514', null, 'counterpart kinds stay a closed set');

-- Exposure ----------------------------------------------------------------------------
select pg_temp.act_as_user_a();
select throws_ok($$ select * from q_runtime.rehearsal_external_subjects $$, '42501', null,
  'the browser has no access to q_runtime: the API reads for the person');
select pg_temp.act_as_privileged();

-- Defence in depth: were the schema ever exposed, the policies hold.
grant usage on schema q_runtime to authenticated;

select pg_temp.act_as_user_a();
select is((select count(*)::int from q_runtime.rehearsal_external_subjects), 2,
  'user A reads their own two snapshots only');
select throws_ok(
  $$ insert into q_runtime.rehearsal_external_subjects
       (tenant_id, viewer_user_id, external_person_id, brief_version, subject)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'),
             '00000000-0000-4000-8000-0000000908f9', 1, '{}') $$,
  '42501', null, 'the browser cannot write evidence, even its own');

select pg_temp.act_as_user_b();
select is((select count(*)::int from q_runtime.rehearsal_external_subjects
            where viewer_user_id = pg_temp.rls_id('user_a')), 0,
  'user B cannot read user A''s evidence');

select pg_temp.act_as_revoked_user();
select is((select count(*)::int from q_runtime.rehearsal_external_subjects), 0,
  'a revoked member reads nothing, not even their own');

select pg_temp.act_as_anonymous();
select throws_ok($$ select * from q_runtime.rehearsal_external_subjects $$, '42501', null,
  'anonymous denied');
select pg_temp.act_as_privileged();

select * from finish();

rollback;
