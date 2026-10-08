# Live hosted database aggregates (read-only, 2026-10-08 ~13:10 UTC)

- Tool: `node scripts/handoff/live/hosted-read.mjs "<select>"` (Supabase Management API, `read_only: true`).
- Why included: distinguishes schema-only from live tables, and supports the outbox, RLS-role and persistence findings.
- Only aggregate counts, catalog metadata and fixed error-code prefixes were read. No row contents. Project ref and provider UUIDs left out.

## Migrations applied vs repository

Query: `select count(*), min(version), max(version) from supabase_migrations.schema_migrations` and a membership check against the 178 file prefixes in `supabase/migrations/`.

```
applied=178  first=20260902144606  last=20261220170000
matching repo files=178  total=178
```

## RLS posture per schema (pg_class.relrowsecurity / relforcerowsecurity, pg_policies)

```
schema          tables rls_on forced policies
ai_ops             5      5     0      0
artifacts          5      5     0      0
audit              2      2     0      0
billing           12     12     0      0
communication     20     20     0     19
core              30     30     0     20
events             1      1     0      0
evidence          26     26     0      0
gateq             20     20     0      0
identity          12     12     0      9
integrations       5      5     0      4
media              3      3     0      0
network           21     21     0      9
onboarding        13     13     0      0
permissions        5      5     0      3
platform_ops      14     14     0      0
q_knowledge       12     12     1      0
q_runtime         38     38     8     22
recommendation    10     10     0      0
taxonomy           8      8     0      0
```

## Roles and live connections

```
pg_roles: postgres rolbypassrls=true rolsuper=false; service_role bypassrls=true;
          authenticated/anon bypassrls=false
pg_stat_activity (client backends) by usename/application_name:
  postgres        Supavisor               8
  pgbouncer       (none)/auth_query       2
  authenticator   PostgREST 14.5          1
  supabase_admin  (none)/postgres_exporter 2
  supabase_read_only_user mgmt-api        1
```

The only pooled application connections are `postgres` via Supavisor (the services use `DATABASE_CONNECTION_MODE=session_pooler`, .railway/railway.ts:91-94). The application's own `application_name` (`capital-q:request`, packages/database/src/internal/postgres.ts:46) is not passed through Supavisor, so the attribution is an inference.

## Row counts (count(*))

```
identity.user_profiles 164        identity.organisations 94
identity.organisation_memberships 151  identity.tenants 95
core.companies 62                 core.investor_organisations 32
network.relationships 46          network.relationship_events 202
q_runtime.conversations 665 (ORGANISATION 640, PERSONAL 25)
q_runtime.conversation_messages 4584   q_runtime.conversation_message_marks 12
q_runtime.runs 2822 (COMPLETED 1517, CANCELLED 1225, FAILED 54, EXPIRED 24, AWAITING_APPROVAL 2)
q_runtime.run_events 13195
q_runtime.actions 321 (REJECTED 198, EXECUTED 62, AWAITING_APPROVAL 37, WITHDRAWN 17, FAILED 7)
q_runtime.approvals 321 (REJECTED 198, APPROVED 69, PENDING 37, REVOKED 17)
q_runtime.standing_instructions 26 (STOPPED 21, ACTIVE 5)   q_runtime.instruction_steps 174
q_runtime.workforce_jobs 5  workforce_drafts 60  workforce_grades 59  workforce_agent_runs 101
q_runtime.voice_line_turns 21 (4 with conversation_id null)
q_runtime.rehearsals 19   q_runtime.presence 11   q_runtime.errands 6
q_runtime.delegations 0   (ADR 0030 LangGraph delegations: schema only)
q_runtime.checkpoints 16665 (2490 threads; checkpoint_writes 93909; checkpoint_blobs 110183; ~90 MB of a 202 MB database)
q_knowledge.memory_items 62 (active 57, superseded 4, forgotten 1)
q_knowledge.objects 292   q_knowledge.chunks 295   q_knowledge.embeddings 0
evidence.documents 238    evidence.document_versions 235
communication.notifications 304  meetings 8  reminders 16  messages 42
ai_ops.model_usage 13172 (6786 in last 7 days)
billing.usage_events 89   billing.plan_assignments 0   billing.subscriptions 0
events.outbox 6312        audit.material_actions 4315
recommendation.slates 483 media.media_assets 34
storage.buckets 4
```

## Outbox: unpublished rows

```
unpublished=657, all with attempt_count>0
event_type                 n    oldest      newest      max_attempts  last_error code
q.action.prepared        321  2026-09-26  2026-10-08   10            EVENT_SCHEMA_INVALID
q.action.rejected        198  2026-10-01  2026-10-08   10            EVENT_SCHEMA_INVALID
q.action.approved         69  2026-09-26  2026-10-08   10            EVENT_SCHEMA_INVALID
q.action.executed         62  2026-09-26  2026-10-08   10            EVENT_SCHEMA_INVALID
q.action.execution_failed  7  2026-09-28  2026-10-06   10            EVENT_SCHEMA_INVALID
published in last 24h: 296; last published 2026-10-08 11:25:04
```

Every q.action.* row ever written (321 prepared = all 321 actions) is unpublished.
