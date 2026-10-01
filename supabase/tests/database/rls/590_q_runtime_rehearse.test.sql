-- REHEARSE (20261111000000): persona profiles and generalised rehearsals.
-- A person reads only their own persona profiles and rehearsals, in a
-- tenant they are an active member of; nobody in the browser writes them.
--
-- EXPECTED DB BEHAVIOUR: the privileged server role writes every row.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(18);

-- Positive (server) -----------------------------------------------------------------
select lives_ok(
  $$ insert into q_runtime.persona_profiles
       (id, tenant_id, viewer_user_id, subject_kind, subject_id, subject_name, profile, sources, signal_digest)
     values ('00000000-0000-4000-8000-0000000059a1', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'),
             'INVESTOR_ORGANISATION', '00000000-0000-4000-8000-0000000059f1', 'Fund One',
             '{"summary":"x"}', '[{"kind":"PROFILE","label":"Discover","ref":null,"at":null}]', 'digest-a-0001') $$,
  'the server records user A''s persona of an investor');
select lives_ok(
  $$ insert into q_runtime.persona_profiles
       (tenant_id, viewer_user_id, subject_kind, subject_id, subject_name, profile, signal_digest)
     values (pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b'),
             'COMPANY', '00000000-0000-4000-8000-0000000059f2', 'Company Two', '{"summary":"y"}', 'digest-b-0001') $$,
  'the server records user B''s persona of a company');
select lives_ok(
  $$ insert into q_runtime.persona_profiles
       (tenant_id, viewer_user_id, subject_kind, subject_id, subject_name, profile, signal_digest)
     values (pg_temp.rls_id('tenant_r'), pg_temp.rls_id('user_r'),
             'COMPANY', '00000000-0000-4000-8000-0000000059f3', 'Company Three', '{"summary":"z"}', 'digest-r-0001') $$,
  'the server records the revoked user''s old persona');
select lives_ok(
  $$ insert into q_runtime.rehearsals
       (tenant_id, user_id, counterpart_kind, counterpart_id, counterpart_name, user_role,
        persona, persona_profile_id, outcome, score)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 'INVESTOR_ORGANISATION',
             '00000000-0000-4000-8000-0000000059f1', 'Fund One', 'FOUNDER', '{"summary":"x"}',
             '00000000-0000-4000-8000-0000000059a1', 'STRONG_LATER', 78) $$,
  'a founder''s rehearsal with an investor is recorded');
select lives_ok(
  $$ insert into q_runtime.rehearsals
       (tenant_id, user_id, counterpart_kind, counterpart_id, counterpart_name, user_role, persona)
     values (pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b'), 'COMPANY',
             '00000000-0000-4000-8000-0000000059f2', 'Company Two', 'INVESTOR', '{"summary":"y"}') $$,
  'an investor''s rehearsal with a company is recorded (no investor columns)');

-- Constraints -----------------------------------------------------------------------
select throws_ok(
  $$ insert into q_runtime.persona_profiles
       (tenant_id, viewer_user_id, subject_kind, subject_id, subject_name, profile, signal_digest)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'),
             'INVESTOR_ORGANISATION', '00000000-0000-4000-8000-0000000059f1', 'Fund One', '{}', 'digest-a-0002') $$,
  '23505', null, 'one persona per viewer and subject');
select throws_ok(
  $$ insert into q_runtime.persona_profiles
       (tenant_id, viewer_user_id, subject_kind, subject_id, subject_name, profile, signal_digest, truth_class)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'),
             'COMPANY', '00000000-0000-4000-8000-0000000059f9', 'X', '{}', 'digest-a-0003', 'VERIFIED') $$,
  '23514', null, 'a persona is never anything but Q inference');
select throws_ok(
  $$ insert into q_runtime.rehearsals
       (tenant_id, user_id, counterpart_kind, counterpart_id, counterpart_name, persona, score)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 'COMPANY',
             '00000000-0000-4000-8000-0000000059f2', 'C', '{}', 140) $$,
  '23514', null, 'a score is out of a hundred');
select throws_ok(
  $$ insert into q_runtime.rehearsals
       (tenant_id, user_id, counterpart_kind, counterpart_id, counterpart_name, persona, outcome)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 'COMPANY',
             '00000000-0000-4000-8000-0000000059f2', 'C', '{}', 'MAYBE') $$,
  '23514', null, 'outcomes are a closed set');

select throws_ok(
  $$ insert into q_runtime.rehearsals
       (tenant_id, user_id, counterpart_kind, counterpart_id, counterpart_name, persona, difficulty)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 'COMPANY',
             '00000000-0000-4000-8000-0000000059f2', 'C', '{}', 'BRUTAL') $$,
  '23514', null, 'difficulty is a closed set (20261111010000)');

-- Exposure: q_runtime is not a browser schema at all ------------------------------
select pg_temp.act_as_user_a();
select throws_ok($$ select * from q_runtime.persona_profiles $$, '42501', null,
  'the browser has no access to q_runtime: the API reads for the person');
select pg_temp.act_as_privileged();

-- Defence in depth: were the schema ever exposed, the policies hold. The
-- usage grant below exists only inside this rolled-back test.
grant usage on schema q_runtime to authenticated;

-- Own reads -------------------------------------------------------------------------
select pg_temp.act_as_user_a();
select is((select count(*)::int from q_runtime.persona_profiles), 1,
  'user A reads their own persona profile only');
select is((select count(*)::int from q_runtime.rehearsals where counterpart_kind is not null), 1,
  'user A reads their own rehearsal only');
select throws_ok(
  $$ insert into q_runtime.persona_profiles
       (tenant_id, viewer_user_id, subject_kind, subject_id, subject_name, profile, signal_digest)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'),
             'COMPANY', '00000000-0000-4000-8000-0000000059fa', 'X', '{}', 'digest-a-0009') $$,
  '42501', null, 'the browser cannot write a persona, even its own');

-- Cross-tenant ----------------------------------------------------------------------
select pg_temp.act_as_user_b();
select is((select count(*)::int from q_runtime.persona_profiles
            where viewer_user_id = pg_temp.rls_id('user_a')), 0,
  'user B cannot read user A''s persona');
select is((select count(*)::int from q_runtime.rehearsals
            where user_id = pg_temp.rls_id('user_a')), 0,
  'user B cannot read user A''s rehearsal');

-- Revoked ---------------------------------------------------------------------------
select pg_temp.act_as_revoked_user();
select is((select count(*)::int from q_runtime.persona_profiles), 0,
  'a revoked member reads no persona, not even their own');

select pg_temp.act_as_anonymous();
select throws_ok($$ select * from q_runtime.persona_profiles $$, '42501', null,
  'anonymous denied');
select pg_temp.act_as_privileged();

select * from finish();

rollback;
