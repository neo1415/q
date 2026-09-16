-- Evidence and knowledge about a person and an investor organisation,
-- not only a company.
--
-- Doc 14 §2.2 is explicit that memory belongs to "User, Company, Investor,
-- Relationship, Capital Objective, Meeting, Document, Platform" — but both
-- stores were built COMPANY-only, so Q could read a founder's public
-- presence and had nowhere to put it. Widening the two subject_type checks
-- is the whole change: every other rule (tenant ownership, provenance
-- identity, derived visibility, the Write Gate's order) already works on
-- whatever subject it is given, and each new type still needs a registered
-- resolver over its owning domain's query port before anything resolves.
alter table evidence.sources
  drop constraint if exists sources_subject_type_check;
alter table evidence.sources
  add constraint sources_subject_type_check
    check (subject_type in ('COMPANY', 'PERSON', 'INVESTOR_ORGANISATION'));

alter table evidence.evidence_items
  drop constraint if exists evidence_items_subject_type_check;
alter table evidence.evidence_items
  add constraint evidence_items_subject_type_check
    check (subject_type in ('COMPANY', 'PERSON', 'INVESTOR_ORGANISATION'));

alter table evidence.claims
  drop constraint if exists claims_subject_type_check;
alter table evidence.claims
  add constraint claims_subject_type_check
    check (subject_type in ('COMPANY', 'PERSON', 'INVESTOR_ORGANISATION'));

alter table q_knowledge.objects
  drop constraint if exists objects_subject_type_check;
alter table q_knowledge.objects
  add constraint objects_subject_type_check
    check (subject_type in ('COMPANY', 'PERSON', 'INVESTOR_ORGANISATION'));

-- When a subject's public presence was last read, so it can be refreshed
-- rather than rebuilt on every conversation, and so a person can be told
-- honestly how current it is.
--
-- This table holds no presence content. It is a log of attempts: what was
-- read, when, how it went. The understandings themselves live in
-- q_knowledge.objects behind the Write Gate like everything else, and the
-- sources in evidence.sources.
create table if not exists q_knowledge.presence_builds (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references identity.tenants (id) on delete restrict,
  subject_type        text not null
                        check (subject_type in ('COMPANY', 'PERSON', 'INVESTOR_ORGANISATION')),
  subject_id          uuid not null,
  status              text not null
                        check (status in ('RUNNING', 'COMPLETED', 'FAILED', 'NOTHING_FOUND')),
  -- Counts only. No statement, no excerpt, no query, no model output.
  source_count        integer not null default 0 check (source_count >= 0),
  understanding_count integer not null default 0 check (understanding_count >= 0),
  -- A stable code, never a provider message.
  failure_code        text check (failure_code is null or length(btrim(failure_code)) between 1 and 64),
  correlation_id      text not null,
  started_at          timestamptz not null default now(),
  completed_at        timestamptz
);

comment on table q_knowledge.presence_builds is
  'One attempt to read a subject''s public presence: counts, status and timing only. The understandings live in q_knowledge.objects behind the Write Gate; the sources in evidence.sources. Read to decide whether a refresh is due.';

create index if not exists presence_builds_subject_idx
  on q_knowledge.presence_builds (tenant_id, subject_type, subject_id, started_at desc);

alter table q_knowledge.presence_builds enable row level security;

-- No policy is created: like the rest of q_knowledge, this table is reached
-- only by the service role through the owning context. RLS on with no
-- policy means no anon or authenticated role can read or write it.
