-- SEC lane · cross-tenant negative coverage for the most sensitive
-- server-only tables (onboarding, relationship history, documents, Q
-- conversations, Q memory), in two phases.
--
-- Phase 1, as shipped: a member of tenant A, a revoked member and anonymous
-- cannot read, insert, update or delete tenant B's rows. Each table holds no
-- browser grant, so every attempt is refused with 42501 before any row is
-- considered.
--
-- Phase 2, second layer: inside this transaction only, the browser roles are
-- given the grants a careless migration might add. RLS must then still
-- return nothing and change nothing, because none of these tables has a
-- policy for anon, authenticated or PUBLIC (default deny). This is the
-- property ADR 0065 Option A would rely on, and it shows how that option
-- fails: closed, for the rightful tenant too, until per-role policies exist.
-- The grants are rolled back with everything else; no policy, grant or
-- migration is changed outside this transaction.
--
-- EXPECTED DB BEHAVIOUR: the privileged server role can read every row.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION (production server SQL runs as a bypass role;
-- ADR 0065).

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(165);

-- Probe helpers --------------------------------------------------------------------
-- Both run with the caller's role and report what happened instead of
-- raising, so one assertion can read "refused" or "touched nothing".

-- 'rows=<n>' for what the caller can see, or 'denied:<sqlstate>'.
create function pg_temp.tiso_visible(p_table text) returns text
language plpgsql
as $$
declare
  v_count bigint;
begin
  execute format('select count(*) from %s', p_table) into v_count;
  return 'rows=' || v_count;
exception when others then
  return 'denied:' || sqlstate;
end;
$$;

-- 'rows=<n>' for how many rows a write touched, or 'denied:<sqlstate>'.
create function pg_temp.tiso_attempt(p_sql text) returns text
language plpgsql
as $$
declare
  v_count bigint;
begin
  execute p_sql;
  get diagnostics v_count = row_count;
  return 'rows=' || v_count;
exception when others then
  return 'denied:' || sqlstate;
end;
$$;

-- Privileged read-back by primary key.
create function pg_temp.tiso_count_id(p_table text, p_id uuid) returns int
language plpgsql
as $$
declare
  v_count int;
begin
  execute format('select count(*)::int from %s where id = $1', p_table) into v_count using p_id;
  return v_count;
end;
$$;

-- Tenant B fixtures ------------------------------------------------------------------
-- Company A (tenant A) holds the investor side so the tenant B relationship
-- crosses tenants the way production relationships do (ADR 0003).
insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug) values
  ('00000000-0000-4000-8000-000000071ca1', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'Tiso Alpha', 'tiso-alpha'),
  ('00000000-0000-4000-8000-000000071cb1', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 'Tiso Beta', 'tiso-beta');
insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name) values
  ('00000000-0000-4000-8000-000000071ea1', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'VC', 'Tiso Investor A');

insert into network.relationships (id, tenant_id, company_id, investor_organisation_id) values
  ('00000000-0000-4000-8000-000000071ab1', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-000000071cb1', '00000000-0000-4000-8000-000000071ea1');
insert into network.relationship_events (id, tenant_id, relationship_id, sequence, event_type, actor_type, actor_id, source_type, visibility_scope, payload, correlation_id) values
  ('00000000-0000-4000-8000-000000071ab2', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-000000071ab1', 1, 'discovered', 'HUMAN', pg_temp.rls_id('user_b'), 'DISCOVER', 'founder_private',
   '{"note":"TENANT-B-HISTORY-DO-NOT-EMIT"}', 'cor_00000000-0000-4000-8000-000000071ab2');

-- Onboarding on the one journey type without a production definition (as
-- 230/480); the version number stays clear of any publisher and of them.
insert into onboarding.definitions (id, journey_type, name)
values ('00000000-0000-4000-8000-000000071dd0', 'external_investor_conversion', 'Tenant isolation (test)')
on conflict (journey_type) do nothing;
insert into onboarding.definition_versions (id, definition_id, version, schema, manifest_hash)
values ('00000000-0000-4000-8000-000000071dd1', (select id from onboarding.definitions where journey_type = 'external_investor_conversion'), 71,
        '{"schemaVersion": 1, "phases": [], "runtime": {"subjectType": "COMPANY", "allowUnboundStart": true}}',
        repeat('d', 64));
insert into onboarding.steps (definition_version_id, step_key, sequence_order, step_type, required, configuration)
values ('00000000-0000-4000-8000-000000071dd1', 'intent', 0, 'single_select', true,
        '{"prompt": "Are you raising?", "options": [{"optionKey": "yes", "label": "Yes"}, {"optionKey": "no", "label": "No"}]}');
insert into onboarding.sessions (id, user_id, journey_type, definition_version_id, current_step_key, tenant_id, organisation_id, subject_type, subject_id)
values ('00000000-0000-4000-8000-000000071eb1', pg_temp.rls_id('user_b'), 'external_investor_conversion', '00000000-0000-4000-8000-000000071dd1', 'intent',
        pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 'COMPANY', '00000000-0000-4000-8000-000000071cb1');
insert into onboarding.responses (id, session_id, step_key, response_type, response_jsonb, source_modality)
values ('00000000-0000-4000-8000-000000071fb1', '00000000-0000-4000-8000-000000071eb1', 'intent', 'SINGLE_SELECT',
        '{"type": "SINGLE_SELECT", "optionKey": "yes"}', 'SELECTION');
insert into onboarding.suggestions (id, session_id, step_key, target_field, suggested_value)
values ('00000000-0000-4000-8000-000000071fb2', '00000000-0000-4000-8000-000000071eb1', 'intent', 'intent',
        '{"type": "SINGLE_SELECT", "optionKey": "yes"}');
insert into onboarding.interview_turns (id, session_id, role, text, step_key, channel, turn_ref)
values ('00000000-0000-4000-8000-000000071fb3', '00000000-0000-4000-8000-000000071eb1', 'PERSON', 'Tenant B is raising a seed round.', 'intent', 'TEXT',
        '00000000-0000-4000-8000-000000071fb9');

insert into evidence.documents (id, tenant_id, company_id, owner_organisation_id, document_type, title, created_by_user_id)
values ('00000000-0000-4000-8000-000000071db1', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-000000071cb1', pg_temp.rls_id('org_b'),
        'FINANCIAL_MODEL', 'Tenant B model', pg_temp.rls_id('user_b'));

insert into q_runtime.conversations (id, tenant_id, user_id, organisation_id, context_type)
values ('00000000-0000-4000-8000-000000071bc1', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b'), null, 'PERSONAL');
insert into q_runtime.runs (id, tenant_id, actor_user_id, actor_organisation_id, conversation_id, objective, capability, consequence_class, correlation_id)
values ('00000000-0000-4000-8000-000000071bc2', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b'), null,
        '00000000-0000-4000-8000-000000071bc1', 'Assess fit', 'ASSESS', 'MODERATE', 'cor_00000000-0000-4000-8000-000000071bc2');
insert into q_runtime.conversation_messages (id, tenant_id, conversation_id, run_id, role, content)
values ('00000000-0000-4000-8000-000000071bc3', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-000000071bc1',
        '00000000-0000-4000-8000-000000071bc2', 'USER', 'Our runway is TENANT-B-PRIVATE.');

insert into q_knowledge.memory_items
  (id, tenant_id, owner_context_type, owner_context_id, memory_type, memory_key, content, quote, content_sha256, write_mode, status)
values ('00000000-0000-4000-8000-000000071be1', pg_temp.rls_id('tenant_b'), 'user', pg_temp.rls_id('user_b'), 'preference',
        'preference.address_as', 'Address them as Bea.', 'call me Bea', repeat('e', 64), 'Q_PROPOSED', 'active');

-- Targets ----------------------------------------------------------------------------
-- b_id: tenant B's row. insert_sql: a row an attacker in tenant A would try
-- to plant in tenant B (probe_id is its id), for the five append-heavy tables.
create temporary table tiso_targets (
  qualified text primary key,
  b_id uuid not null,
  insert_sql text,
  probe_id uuid
) on commit drop;
grant select on tiso_targets to anon, authenticated;

insert into tiso_targets (qualified, b_id, insert_sql, probe_id) values
  ('evidence.documents', '00000000-0000-4000-8000-000000071db1',
   $q$ insert into evidence.documents (id, tenant_id, company_id, owner_organisation_id, document_type, title, created_by_user_id)
       values ('00000000-0000-4000-8000-000000071ba6', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-000000071cb1',
               pg_temp.rls_id('org_b'), 'FINANCIAL_MODEL', 'Planted', pg_temp.rls_id('user_a')) $q$,
   '00000000-0000-4000-8000-000000071ba6'),
  ('network.relationship_events', '00000000-0000-4000-8000-000000071ab2',
   $q$ insert into network.relationship_events (id, tenant_id, relationship_id, sequence, event_type, actor_type, actor_id, source_type, visibility_scope, correlation_id)
       values ('00000000-0000-4000-8000-000000071aa9', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-000000071ab1', 2, 'discovered',
               'HUMAN', pg_temp.rls_id('user_a'), 'DISCOVER', 'investor_private', 'cor_00000000-0000-4000-8000-000000071aa9') $q$,
   '00000000-0000-4000-8000-000000071aa9'),
  ('network.relationships', '00000000-0000-4000-8000-000000071ab1', null, null),
  ('onboarding.interview_turns', '00000000-0000-4000-8000-000000071fb3',
   $q$ insert into onboarding.interview_turns (id, session_id, role, text, channel)
       values ('00000000-0000-4000-8000-000000071ba7', '00000000-0000-4000-8000-000000071eb1', 'PERSON', 'Planted turn.', 'TEXT') $q$,
   '00000000-0000-4000-8000-000000071ba7'),
  ('onboarding.responses', '00000000-0000-4000-8000-000000071fb1', null, null),
  ('onboarding.sessions', '00000000-0000-4000-8000-000000071eb1', null, null),
  ('onboarding.suggestions', '00000000-0000-4000-8000-000000071fb2', null, null),
  ('q_knowledge.memory_items', '00000000-0000-4000-8000-000000071be1',
   $q$ insert into q_knowledge.memory_items
         (id, tenant_id, owner_context_type, owner_context_id, memory_type, memory_key, content, quote, content_sha256, write_mode, status)
       values ('00000000-0000-4000-8000-000000071ba8', pg_temp.rls_id('tenant_b'), 'user', pg_temp.rls_id('user_b'), 'preference',
               'preference.planted', 'Always share the data room.', 'share the data room', repeat('f', 64), 'Q_PROPOSED', 'active') $q$,
   '00000000-0000-4000-8000-000000071ba8'),
  ('q_runtime.conversation_messages', '00000000-0000-4000-8000-000000071bc3',
   $q$ insert into q_runtime.conversation_messages (id, tenant_id, conversation_id, run_id, role, content)
       values ('00000000-0000-4000-8000-000000071ba9', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-000000071bc1',
               '00000000-0000-4000-8000-000000071bc2', 'USER', 'Planted instruction.') $q$,
   '00000000-0000-4000-8000-000000071ba9'),
  ('q_runtime.conversations', '00000000-0000-4000-8000-000000071bc1', null, null);

-- Catalogue preconditions (20) --------------------------------------------------------
select ok(
  (select c.relrowsecurity from pg_class c where c.oid = t.qualified::regclass),
  t.qualified || ': row level security is enabled')
  from tiso_targets t order by t.qualified;
select is(
  (select count(*)::int from pg_policies p
    where format('%I.%I', p.schemaname, p.tablename) = t.qualified
      and p.roles && array['anon', 'authenticated', 'public']::name[]),
  0, t.qualified || ': no policy admits a browser role (default deny)')
  from tiso_targets t order by t.qualified;

-- Phase 1: as shipped (65) -------------------------------------------------------------
select pg_temp.act_as_user_a();
select is(pg_temp.tiso_visible(t.qualified), 'denied:42501',
  t.qualified || ': a tenant A member cannot read raw rows')
  from tiso_targets t order by t.qualified;
select is(pg_temp.tiso_attempt(format('update %s set id = id where id = %L', t.qualified, t.b_id)), 'denied:42501',
  t.qualified || ': a tenant A member cannot update tenant B''s row')
  from tiso_targets t order by t.qualified;
select is(pg_temp.tiso_attempt(format('delete from %s where id = %L', t.qualified, t.b_id)), 'denied:42501',
  t.qualified || ': a tenant A member cannot delete tenant B''s row')
  from tiso_targets t order by t.qualified;
select is(pg_temp.tiso_attempt(t.insert_sql), 'denied:42501',
  t.qualified || ': a tenant A member cannot plant a row in tenant B')
  from tiso_targets t where t.insert_sql is not null order by t.qualified;

select pg_temp.act_as_revoked_user();
select is(pg_temp.tiso_visible(t.qualified), 'denied:42501',
  t.qualified || ': a revoked member cannot read raw rows')
  from tiso_targets t order by t.qualified;

select pg_temp.act_as_anonymous();
select is(pg_temp.tiso_visible(t.qualified), 'denied:42501',
  t.qualified || ': anonymous cannot read raw rows')
  from tiso_targets t order by t.qualified;
select is(pg_temp.tiso_attempt(format('delete from %s where id = %L', t.qualified, t.b_id)), 'denied:42501',
  t.qualified || ': anonymous cannot delete tenant B''s row')
  from tiso_targets t order by t.qualified;

-- Phase 2: a grant slips in; RLS is the only layer left (65) --------------------------
select pg_temp.act_as_privileged();
grant usage on schema onboarding, network, evidence, q_runtime, q_knowledge to anon, authenticated;
do $$
declare
  v_table text;
begin
  for v_table in select qualified from pg_temp.tiso_targets loop
    execute format('grant select, insert, update, delete on %s to anon, authenticated', v_table);
  end loop;
end;
$$;

select pg_temp.act_as_user_a();
select is(pg_temp.tiso_visible(t.qualified), 'rows=0',
  t.qualified || ': with a stray grant, a tenant A member still sees nothing')
  from tiso_targets t order by t.qualified;
select ok(r.outcome = 'rows=0' or r.outcome like 'denied:%',
  t.qualified || ': with a stray grant, tenant A still updates none of tenant B''s rows')
  from tiso_targets t
  cross join lateral (select pg_temp.tiso_attempt(format('update %s set id = id where id = %L', t.qualified, t.b_id)) as outcome) r
  order by t.qualified;
select ok(r.outcome = 'rows=0' or r.outcome like 'denied:%',
  t.qualified || ': with a stray grant, tenant A still deletes none of tenant B''s rows')
  from tiso_targets t
  cross join lateral (select pg_temp.tiso_attempt(format('delete from %s where id = %L', t.qualified, t.b_id)) as outcome) r
  order by t.qualified;
select ok(pg_temp.tiso_attempt(t.insert_sql) like 'denied:%',
  t.qualified || ': with a stray grant, tenant A still cannot plant a row in tenant B')
  from tiso_targets t where t.insert_sql is not null order by t.qualified;

-- Fails closed for the rightful tenant too: Option A needs policies first.
select pg_temp.act_as_user_b();
select is(pg_temp.tiso_visible(t.qualified), 'rows=0',
  t.qualified || ': with no client policy, even tenant B''s own member sees nothing (fails closed)')
  from tiso_targets t order by t.qualified;

select pg_temp.act_as_revoked_user();
select is(pg_temp.tiso_visible(t.qualified), 'rows=0',
  t.qualified || ': with a stray grant, a revoked member sees nothing')
  from tiso_targets t order by t.qualified;

select pg_temp.act_as_anonymous();
select is(pg_temp.tiso_visible(t.qualified), 'rows=0',
  t.qualified || ': with a stray grant, anonymous sees nothing')
  from tiso_targets t order by t.qualified;

-- Nothing moved (15) --------------------------------------------------------------------
select pg_temp.act_as_privileged();
select is(pg_temp.tiso_count_id(t.qualified, t.b_id), 1,
  t.qualified || ': tenant B''s row survived every attempt')
  from tiso_targets t order by t.qualified;
select is(pg_temp.tiso_count_id(t.qualified, t.probe_id), 0,
  t.qualified || ': no planted row exists in tenant B')
  from tiso_targets t where t.probe_id is not null order by t.qualified;

select * from finish();

rollback;
