-- CQ-SEC-004 · schema-wide protection guard.
--
-- A test-owned inventory classifies every table in the Capital Q
-- application schemas. The guard fails when:
--
--   * a table exists in those schemas but is not classified (the failure
--     message names it);
--   * the inventory names a table that no longer exists (stale inventory);
--   * a classified table does not have RLS enabled;
--   * anon holds any privilege, or authenticated holds privileges beyond
--     what the classification allows;
--   * a server-only table has any policy at all;
--   * a helper in `private` is not SECURITY DEFINER-safe (pinned search_path,
--     no EXECUTE for anon/PUBLIC).
--
-- Classification vocabulary (test architecture only; not the ADR-001
-- disclosure model):
--
--   RLS_REQUIRED          tenant/person-sensitive, reachable by authenticated
--                         through policies; must have negative cross-tenant tests
--   INTERNAL_SERVER_ONLY  written and read by the server only; no client role
--                         may touch it; still RLS-enabled as a second layer
--   PUBLIC_REFERENCE      reference data readable by authenticated; grants
--                         nothing
--
-- Every new migration that adds a table to identity, permissions, events,
-- audit (or a new application schema added to `guarded_schemas`) must add a
-- row here and, for RLS_REQUIRED, a suite under tests/database/rls.

begin;

create extension if not exists pgtap with schema extensions;

create temporary table guarded_schemas (schema_name text primary key) on commit drop;
insert into guarded_schemas values ('identity'), ('permissions'), ('events'), ('audit'), ('core'), ('network'), ('taxonomy'), ('onboarding'), ('evidence'), ('media'), ('q_runtime'), ('ai_ops'), ('q_knowledge'), ('recommendation'), ('billing'), ('integrations');

create temporary table rls_inventory (
  schema_name text not null,
  table_name text not null,
  classification text not null check (classification in ('RLS_REQUIRED', 'INTERNAL_SERVER_ONLY', 'PUBLIC_REFERENCE')),
  -- Privileges authenticated is allowed to hold, as granted (policies decide rows).
  authenticated_privileges text[] not null,
  primary key (schema_name, table_name)
) on commit drop;

insert into rls_inventory (schema_name, table_name, classification, authenticated_privileges) values
  ('identity', 'user_profiles',            'RLS_REQUIRED',         '{SELECT}'),
  ('identity', 'tenants',                  'RLS_REQUIRED',         '{SELECT}'),
  ('identity', 'organisations',            'RLS_REQUIRED',         '{SELECT}'),
  ('identity', 'tenant_organisations',     'INTERNAL_SERVER_ONLY', '{}'),
  ('identity', 'organisation_memberships', 'RLS_REQUIRED',         '{SELECT}'),
  ('identity', 'user_active_contexts',     'RLS_REQUIRED',         '{SELECT}'),
  -- G (ADR 0057): invitations, join requests, ownership offers; suite 800.
  ('identity', 'organisation_invitations',      'RLS_REQUIRED',    '{SELECT}'),
  ('identity', 'organisation_join_requests',    'RLS_REQUIRED',    '{SELECT}'),
  ('identity', 'organisation_ownership_offers', 'RLS_REQUIRED',    '{SELECT}'),
  ('identity', 'membership_roles',         'RLS_REQUIRED',         '{SELECT}'),
  ('identity', 'organisation_creation_requests', 'INTERNAL_SERVER_ONLY', '{}'),
  ('core', 'companies',                    'RLS_REQUIRED',         '{SELECT}'),
  ('core', 'company_creation_requests',    'INTERNAL_SERVER_ONLY', '{}'),
  -- F3 (Find my startup): server-only, suite 810.
  ('core', 'company_claim_requests',       'INTERNAL_SERVER_ONLY', '{}'),
  ('core', 'company_members',              'RLS_REQUIRED',         '{SELECT}'),
  ('core', 'founder_profiles',             'RLS_REQUIRED',         '{SELECT}'),
  -- Overnight A7: a founder's own facts and background (own-row select).
  ('core', 'founder_person_facts',         'RLS_REQUIRED',         '{SELECT}'),
  ('core', 'founder_background_entries',   'RLS_REQUIRED',         '{SELECT}'),
  ('core', 'company_team_facts',           'RLS_REQUIRED',         '{SELECT}'),
  ('core', 'investor_organisations',       'RLS_REQUIRED',         '{SELECT}'),
  ('core', 'investor_representatives',     'RLS_REQUIRED',         '{SELECT}'),
  ('core', 'investor_creation_requests',   'INTERNAL_SERVER_ONLY', '{}'),
  ('core', 'investor_mandates',            'RLS_REQUIRED',         '{SELECT}'),
  ('core', 'investor_mandate_constraints', 'RLS_REQUIRED',         '{SELECT}'),
  ('core', 'investor_mandate_creation_requests', 'INTERNAL_SERVER_ONLY', '{}'),
  ('core', 'investor_portfolio_references', 'RLS_REQUIRED',         '{SELECT}'),
  ('core', 'capital_objectives',            'RLS_REQUIRED',         '{SELECT}'),
  ('core', 'capital_objective_events',      'RLS_REQUIRED',         '{SELECT}'),
  -- Capital rounds (2026-10-04): the company's organisation reads them (suite 760).
  ('core', 'capital_rounds',                'RLS_REQUIRED',         '{SELECT}'),
  ('core', 'human_reviews',                 'RLS_REQUIRED',         '{SELECT}'),
  ('core', 'kyb_submissions',               'RLS_REQUIRED',         '{SELECT}'),
  ('core', 'identity_submissions',          'RLS_REQUIRED',         '{SELECT}'),
  ('core', 'capital_objective_creation_requests', 'INTERNAL_SERVER_ONLY', '{}'),
  ('network', 'relationships',            'INTERNAL_SERVER_ONLY', '{}'),
  ('network', 'relationship_events',      'INTERNAL_SERVER_ONLY', '{}'),
  ('network', 'interests',                'INTERNAL_SERVER_ONLY', '{}'),
  ('network', 'interest_requests',        'INTERNAL_SERVER_ONLY', '{}'),
  ('core',    'handles',                  'INTERNAL_SERVER_ONLY', '{}'),
  ('core',    'reserved_handles',         'INTERNAL_SERVER_ONLY', '{}'),
  ('core',    'shareable_identities',     'INTERNAL_SERVER_ONLY', '{}'),
  ('core',    'shareable_identity_scans', 'INTERNAL_SERVER_ONLY', '{}'),
  ('core',    'profile_images',           'INTERNAL_SERVER_ONLY', '{}'),
  ('network', 'interest_responses',       'INTERNAL_SERVER_ONLY', '{}'),
  ('network', 'interest_response_requests', 'INTERNAL_SERVER_ONLY', '{}'),
  ('network', 'matches',                  'INTERNAL_SERVER_ONLY', '{}'),
  ('network', 'diligence_document_views',   'INTERNAL_SERVER_ONLY', '{}'),
  ('network', 'diligence_document_summaries', 'INTERNAL_SERVER_ONLY', '{}'),
  ('permissions', 'capabilities',          'PUBLIC_REFERENCE',     '{SELECT}'),
  ('permissions', 'roles',                 'PUBLIC_REFERENCE',     '{SELECT}'),
  ('permissions', 'role_capabilities',     'PUBLIC_REFERENCE',     '{SELECT}'),
  ('permissions', 'grants',                'INTERNAL_SERVER_ONLY', '{}'),
  ('permissions', 'disclosure_policies',   'INTERNAL_SERVER_ONLY', '{}'),
  ('taxonomy', 'vocabularies',             'INTERNAL_SERVER_ONLY', '{}'),
  ('taxonomy', 'nodes',                    'INTERNAL_SERVER_ONLY', '{}'),
  ('taxonomy', 'node_edges',               'INTERNAL_SERVER_ONLY', '{}'),
  ('taxonomy', 'aliases',                  'INTERNAL_SERVER_ONLY', '{}'),
  ('taxonomy', 'entity_assignments',       'INTERNAL_SERVER_ONLY', '{}'),
  ('taxonomy', 'mandate_preferences',      'INTERNAL_SERVER_ONLY', '{}'),
  ('taxonomy', 'classification_runs',      'INTERNAL_SERVER_ONLY', '{}'),
  ('taxonomy', 'classification_candidates', 'INTERNAL_SERVER_ONLY', '{}'),
  ('onboarding', 'definitions',            'INTERNAL_SERVER_ONLY', '{}'),
  ('onboarding', 'definition_versions',    'INTERNAL_SERVER_ONLY', '{}'),
  ('onboarding', 'steps',                  'INTERNAL_SERVER_ONLY', '{}'),
  ('onboarding', 'sessions',               'INTERNAL_SERVER_ONLY', '{}'),
  ('onboarding', 'step_states',            'INTERNAL_SERVER_ONLY', '{}'),
  ('onboarding', 'responses',              'INTERNAL_SERVER_ONLY', '{}'),
  ('onboarding', 'suggestions',            'INTERNAL_SERVER_ONLY', '{}'),
  ('onboarding', 'interview_questions',    'INTERNAL_SERVER_ONLY', '{}'),
  ('onboarding', 'utterances',             'INTERNAL_SERVER_ONLY', '{}'),
  ('onboarding', 'interview_turns',        'INTERNAL_SERVER_ONLY', '{}'),
  ('onboarding', 'nudge_states',           'INTERNAL_SERVER_ONLY', '{}'),
  ('onboarding', 'session_creation_requests', 'INTERNAL_SERVER_ONLY', '{}'),
  ('onboarding', 'session_mutation_requests', 'INTERNAL_SERVER_ONLY', '{}'),
  ('evidence', 'sources',                  'INTERNAL_SERVER_ONLY', '{}'),
  ('evidence', 'documents',                'INTERNAL_SERVER_ONLY', '{}'),
  ('evidence', 'document_versions',        'INTERNAL_SERVER_ONLY', '{}'),
  -- Overnight A3/A5: the data room and Q's reading of the deck.
  ('evidence', 'data_room_folders',              'INTERNAL_SERVER_ONLY', '{}'),
  ('evidence', 'data_room_checklist_items',      'INTERNAL_SERVER_ONLY', '{}'),
  ('evidence', 'data_room_entries',              'INTERNAL_SERVER_ONLY', '{}'),
  ('evidence', 'data_room_access_requests',      'INTERNAL_SERVER_ONLY', '{}'),
  ('evidence', 'data_room_request_decisions',    'INTERNAL_SERVER_ONLY', '{}'),
  ('evidence', 'data_room_views',                'INTERNAL_SERVER_ONLY', '{}'),
  ('evidence', 'deck_extractions',               'INTERNAL_SERVER_ONLY', '{}'),
  ('evidence', 'deck_extraction_confirmations',  'INTERNAL_SERVER_ONLY', '{}'),
  ('evidence', 'document_processing_runs', 'INTERNAL_SERVER_ONLY', '{}'),
  ('evidence', 'claims',                   'INTERNAL_SERVER_ONLY', '{}'),
  ('evidence', 'verification_claims',      'INTERNAL_SERVER_ONLY', '{}'),
  ('evidence', 'verification_claim_reclassifications', 'INTERNAL_SERVER_ONLY', '{}'),
  ('evidence', 'claim_revisions',          'INTERNAL_SERVER_ONLY', '{}'),
  ('evidence', 'evidence_items',           'INTERNAL_SERVER_ONLY', '{}'),
  ('evidence', 'claim_evidence',           'INTERNAL_SERVER_ONLY', '{}'),
  ('evidence', 'document_upload_sessions',  'INTERNAL_SERVER_ONLY', '{}'),
  ('evidence', 'document_upload_requests',  'INTERNAL_SERVER_ONLY', '{}'),
  ('evidence', 'document_extractions',      'INTERNAL_SERVER_ONLY', '{}'),
  ('media',    'media_assets',              'INTERNAL_SERVER_ONLY', '{}'),
  ('media',    'pitch_requests',            'INTERNAL_SERVER_ONLY', '{}'),
  ('media',    'pitch_transcripts',         'INTERNAL_SERVER_ONLY', '{}'),
  ('q_runtime', 'conversations',            'INTERNAL_SERVER_ONLY', '{}'),
  ('q_runtime', 'conversation_messages',    'INTERNAL_SERVER_ONLY', '{}'),
  ('q_runtime', 'runs',                     'INTERNAL_SERVER_ONLY', '{}'),
  ('q_runtime', 'work_suggestion_dismissals', 'INTERNAL_SERVER_ONLY', '{}'),
  ('q_runtime', 'run_events',               'INTERNAL_SERVER_ONLY', '{}'),
  ('q_runtime', 'run_creation_requests',    'INTERNAL_SERVER_ONLY', '{}'),
  ('q_runtime', 'message_creation_requests', 'INTERNAL_SERVER_ONLY', '{}'),
  ('q_runtime', 'checkpoint_migrations',     'INTERNAL_SERVER_ONLY', '{}'),
  -- 2026-10 build (classified by the lead from the live grants + RLS state).
  ('q_runtime', 'errands',                  'RLS_REQUIRED',         '{SELECT}'),
  ('q_runtime', 'person_standing',          'RLS_REQUIRED',         '{SELECT}'),
  ('q_runtime', 'rehearsals',               'RLS_REQUIRED',         '{SELECT}'),
  ('q_runtime', 'persona_profiles',         'RLS_REQUIRED',         '{SELECT}'),
  ('q_runtime', 'delegations',              'RLS_REQUIRED',         '{SELECT}'),
  ('q_runtime', 'delegation_lanes',         'RLS_REQUIRED',         '{SELECT}'),
  ('q_runtime', 'delegation_steps',         'RLS_REQUIRED',         '{SELECT}'),
  ('q_runtime', 'presence',                 'RLS_REQUIRED',         '{SELECT}'),
  ('q_runtime', 'standing_instructions',    'RLS_REQUIRED',         '{SELECT}'),
  ('q_runtime', 'instruction_grants',       'RLS_REQUIRED',         '{SELECT}'),
  ('q_runtime', 'instruction_steps',        'RLS_REQUIRED',         '{SELECT}'),
  ('q_runtime', 'daily_preferences',        'RLS_REQUIRED',         '{SELECT}'),
  ('q_runtime', 'etiquette_guide_versions', 'RLS_REQUIRED',         '{SELECT}'),
  ('q_runtime', 'workforce_jobs', 'RLS_REQUIRED', '{SELECT}'),
  ('q_runtime', 'workforce_agent_runs', 'RLS_REQUIRED', '{SELECT}'),
  ('q_runtime', 'workforce_handoffs', 'RLS_REQUIRED', '{SELECT}'),
  ('q_runtime', 'workforce_drafts', 'RLS_REQUIRED', '{SELECT}'),
  ('q_runtime', 'workforce_grades', 'RLS_REQUIRED', '{SELECT}'),
  ('q_runtime', 'workforce_draft_outcomes', 'RLS_REQUIRED', '{SELECT}'),
  ('q_runtime', 'workforce_feedback', 'RLS_REQUIRED', '{SELECT}'),
  ('q_runtime', 'daily_editions',           'RLS_REQUIRED',         '{SELECT}'),
  ('q_runtime', 'daily_cluster_issues',     'INTERNAL_SERVER_ONLY', '{}'),
  ('q_runtime', 'conversation_message_marks', 'INTERNAL_SERVER_ONLY', '{}'),
  ('network', 'commitments',                'RLS_REQUIRED',         '{SELECT}'),
  -- Post-meeting outcomes (2026-10-02): pass reasons are reference rows
  -- (spec 6.6.10); a pass is read by the investor side, and by the company
  -- side only when shared (suite 640).
  ('network', 'relationship_pass_reasons',  'PUBLIC_REFERENCE',     '{SELECT}'),
  ('network', 'relationship_passes',        'RLS_REQUIRED',         '{SELECT}'),
  -- Diligence (2026-10-02): server-only; both sides read through the API.
  ('network', 'diligence_requests',         'INTERNAL_SERVER_ONLY', '{}'),
  ('network', 'diligence_fulfilments',      'INTERNAL_SERVER_ONLY', '{}'),
  ('identity', 'platform_admins',           'INTERNAL_SERVER_ONLY', '{}'),
  -- BIZ-007 integrations, guarded from the inbound email packet on: a
  -- person reads their own rows (suites 530 and 710); OAuth states are the
  -- server's alone. google_accounts' SELECT is column-scoped.
  ('integrations', 'google_accounts',       'RLS_REQUIRED',         '{SELECT}'),
  ('integrations', 'oauth_states',          'INTERNAL_SERVER_ONLY', '{}'),
  ('integrations', 'email_messages',        'RLS_REQUIRED',         '{SELECT}'),
  ('integrations', 'inbound_addresses',     'RLS_REQUIRED',         '{SELECT}'),
  ('integrations', 'inbound_emails',        'RLS_REQUIRED',         '{SELECT}'),
  -- BILLING block (ADR 0034): server-only; people read their plan through the API.
  ('billing', 'features',                   'INTERNAL_SERVER_ONLY', '{}'),
  ('billing', 'plans',                      'INTERNAL_SERVER_ONLY', '{}'),
  ('billing', 'plan_features',              'INTERNAL_SERVER_ONLY', '{}'),
  ('billing', 'plan_assignments',           'INTERNAL_SERVER_ONLY', '{}'),
  ('billing', 'limit_overrides',            'INTERNAL_SERVER_ONLY', '{}'),
  ('billing', 'usage_events',               'INTERNAL_SERVER_ONLY', '{}'),
  ('billing', 'customers',                  'INTERNAL_SERVER_ONLY', '{}'),
  ('billing', 'subscriptions',              'INTERNAL_SERVER_ONLY', '{}'),
  ('billing', 'provider_events',            'INTERNAL_SERVER_ONLY', '{}'),
  ('billing', 'fee_schedules',              'INTERNAL_SERVER_ONLY', '{}'),
  ('billing', 'fee_entries',                'INTERNAL_SERVER_ONLY', '{}'),
  ('billing', 'credit_entries',             'INTERNAL_SERVER_ONLY', '{}'),
  -- end BILLING block
  ('q_runtime', 'checkpoints',               'INTERNAL_SERVER_ONLY', '{}'),
  ('q_runtime', 'checkpoint_blobs',          'INTERNAL_SERVER_ONLY', '{}'),
  ('q_runtime', 'checkpoint_writes',         'INTERNAL_SERVER_ONLY', '{}'),
  ('q_runtime', 'actions',                   'INTERNAL_SERVER_ONLY', '{}'),
  ('q_runtime', 'approvals',                 'INTERNAL_SERVER_ONLY', '{}'),
  ('ai_ops', 'providers',                   'INTERNAL_SERVER_ONLY', '{}'),
  ('ai_ops', 'models',                      'INTERNAL_SERVER_ONLY', '{}'),
  ('ai_ops', 'model_prices',                'INTERNAL_SERVER_ONLY', '{}'),
  ('ai_ops', 'routing_policies',            'INTERNAL_SERVER_ONLY', '{}'),
  ('ai_ops', 'model_usage',                 'INTERNAL_SERVER_ONLY', '{}'),
  ('q_knowledge', 'chunk_sets',             'INTERNAL_SERVER_ONLY', '{}'),
  ('q_knowledge', 'chunks',                 'INTERNAL_SERVER_ONLY', '{}'),
  ('q_knowledge', 'embeddings',             'INTERNAL_SERVER_ONLY', '{}'),
  ('q_knowledge', 'objects',                'INTERNAL_SERVER_ONLY', '{}'),
  ('q_knowledge', 'revisions',              'INTERNAL_SERVER_ONLY', '{}'),
  ('q_knowledge', 'object_evidence',        'INTERNAL_SERVER_ONLY', '{}'),
  ('q_knowledge', 'object_sources',         'INTERNAL_SERVER_ONLY', '{}'),
  ('q_knowledge', 'lineage',                'INTERNAL_SERVER_ONLY', '{}'),
  ('q_knowledge', 'contradiction_sets',     'INTERNAL_SERVER_ONLY', '{}'),
  ('q_knowledge', 'contradiction_members',  'INTERNAL_SERVER_ONLY', '{}'),
  ('q_knowledge', 'memory_items',           'INTERNAL_SERVER_ONLY', '{}'),
  ('q_knowledge', 'presence_builds',        'INTERNAL_SERVER_ONLY', '{}'),
  ('recommendation', 'company_representations', 'INTERNAL_SERVER_ONLY', '{}'),
  ('recommendation', 'mandate_representations', 'INTERNAL_SERVER_ONLY', '{}'),
  ('recommendation', 'company_embeddings',      'INTERNAL_SERVER_ONLY', '{}'),
  ('recommendation', 'mandate_embeddings',      'INTERNAL_SERVER_ONLY', '{}'),
  ('recommendation', 'feature_snapshots',       'INTERNAL_SERVER_ONLY', '{}'),
  ('recommendation', 'slates',                  'INTERNAL_SERVER_ONLY', '{}'),
  ('recommendation', 'slate_items',             'INTERNAL_SERVER_ONLY', '{}'),
  ('recommendation', 'refresh_requests',        'INTERNAL_SERVER_ONLY', '{}'),
  ('recommendation', 'interaction_events',     'INTERNAL_SERVER_ONLY', '{}'),
  ('recommendation', 'interaction_state',      'INTERNAL_SERVER_ONLY', '{}'),
  ('events', 'outbox',                     'INTERNAL_SERVER_ONLY', '{}'),
  ('audit', 'material_actions',            'INTERNAL_SERVER_ONLY', '{}'),
  ('audit', 'security_events',             'INTERNAL_SERVER_ONLY', '{}');

select plan(12);

-- Completeness ---------------------------------------------------------------

select is(
  (select coalesce(string_agg(t.schemaname || '.' || t.tablename, ', ' order by 1), '')
     from pg_tables t
     join guarded_schemas g on g.schema_name = t.schemaname
     left join rls_inventory i on i.schema_name = t.schemaname and i.table_name = t.tablename
    where i.table_name is null),
  '',
  'every table in a guarded schema is classified (unclassified tables are listed on failure)');

select is(
  (select coalesce(string_agg(i.schema_name || '.' || i.table_name, ', ' order by 1), '')
     from rls_inventory i
     left join pg_tables t on t.schemaname = i.schema_name and t.tablename = i.table_name
    where t.tablename is null),
  '',
  'the inventory names only tables that exist (stale entries are listed on failure)');

-- RLS enabled ------------------------------------------------------------------

select is(
  (select coalesce(string_agg(i.schema_name || '.' || i.table_name, ', ' order by 1), '')
     from rls_inventory i
     join pg_class c on c.relname = i.table_name
     join pg_namespace n on n.oid = c.relnamespace and n.nspname = i.schema_name
    where c.relkind = 'r' and not c.relrowsecurity),
  '',
  'every classified table has RLS enabled (a policy without RLS is still a failure)');

-- Grants -----------------------------------------------------------------------

select is(
  (select coalesce(string_agg(g.table_schema || '.' || g.table_name || ':' || g.privilege_type, ', ' order by 1), '')
     from information_schema.role_table_grants g
     join guarded_schemas s on s.schema_name = g.table_schema
    where g.grantee = 'anon'),
  '',
  'anon holds no table privilege in any guarded schema');

select is(
  (select coalesce(string_agg(g.table_schema || '.' || g.table_name || ':' || g.privilege_type, ', ' order by 1), '')
     from information_schema.role_table_grants g
     join rls_inventory i on i.schema_name = g.table_schema and i.table_name = g.table_name
    where g.grantee = 'authenticated'
      and not (g.privilege_type = any (i.authenticated_privileges))),
  '',
  'authenticated holds only the privileges the inventory allows');

select is(
  (select coalesce(string_agg(g.table_schema || '.' || g.table_name || ':' || g.grantee, ', ' order by 1), '')
     from information_schema.role_table_grants g
     join guarded_schemas s on s.schema_name = g.table_schema
    where g.grantee in ('anon', 'authenticated', 'public')
      and g.privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER')),
  '',
  'no browser principal can write, truncate or reference any guarded table');

select is(
  (select coalesce(string_agg(i.schema_name || '.' || i.table_name || ':' || p.policyname, ', ' order by 1), '')
     from rls_inventory i
     join pg_policies p on p.schemaname = i.schema_name and p.tablename = i.table_name
    where i.classification = 'INTERNAL_SERVER_ONLY'),
  '',
  'server-only tables carry no policies at all');

select ok(not has_schema_privilege('anon', 'private', 'usage') and not has_schema_privilege('anon', 'pgmq', 'usage'),
  'anon has no usage on private or pgmq');
select ok(not has_schema_privilege('authenticated', 'events', 'usage')
      and not has_schema_privilege('authenticated', 'audit', 'usage')
      and not has_schema_privilege('authenticated', 'network', 'usage')
      and not has_schema_privilege('authenticated', 'taxonomy', 'usage')
      and not has_schema_privilege('authenticated', 'onboarding', 'usage')
      and not has_schema_privilege('authenticated', 'evidence', 'usage')
      and not has_schema_privilege('authenticated', 'media', 'usage')
      and not has_schema_privilege('authenticated', 'q_runtime', 'usage')
      and not has_schema_privilege('authenticated', 'pgmq', 'usage'),
  'authenticated has no usage on events, audit, network, taxonomy, onboarding, evidence, media, q_runtime or pgmq');

-- SECURITY DEFINER helpers -----------------------------------------------------

select is(
  (select coalesce(string_agg(p.proname, ', ' order by 1), '')
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and not (coalesce(p.proconfig, '{}'::text[]) @> array['search_path=""'])),
  '',
  'every function in private pins search_path to empty (offenders listed on failure)');

select is(
  (select coalesce(string_agg(p.proname, ', ' order by 1), '')
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('public', p.oid, 'execute'))),
  '',
  'no function in private is executable by anon or PUBLIC');

select is(
  (select coalesce(string_agg(p.proname, ', ' order by 1), '')
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.prosecdef
      and p.proname not in ('handle_new_auth_user', 'current_app_user_id', 'is_tenant_member', 'is_organisation_member',
                            -- R34: party check for chat RLS, reviewed 2026-09-27 (search_path '', boolean only, membership-based).
                            'is_conversation_party',
                            -- 2026-10-02: which side of a relationship the caller is an active member of, for
                            -- network.relationship_passes RLS (search_path '', boolean only, membership-based).
                            'is_relationship_side_member')),
  '',
  'the set of SECURITY DEFINER helpers is exactly the reviewed set (new ones are listed on failure)');

select * from finish();

rollback;
