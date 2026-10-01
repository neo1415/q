-- REHEARSE (founder direction 2026-10-01, docs/specs/2026-10/rehearse.md):
-- rehearse any meeting with the person you are meeting, founder or
-- investor, played by Q from a persona profile of that person.
--
-- Additive only.
--
-- 1. q_runtime.persona_profiles: Q's reading of one person or organisation
--    AS ONE VIEWER MAY SEE THEM. Keyed by viewer, because what feeds it is
--    what that viewer is authorised to see (Context Firewall): two founders
--    rehearsing with the same investor get two profiles. It is Q inference
--    about style (truth_class is fixed to Q_INFERENCE), never a fact about
--    the subject: nothing here is written to Knowledge, and every reading
--    keeps the sources it was built from (provenance).
-- 2. q_runtime.rehearsals generalised: the counterpart is an investor
--    organisation or a company, the rehearsal may be for a booked meeting,
--    and it ends in an outcome and a code-computed score.
--
-- Server-written only; a person reads their own rows.

create table q_runtime.persona_profiles (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references identity.tenants (id) on delete restrict,
  viewer_user_id    uuid not null references identity.user_profiles (id) on delete restrict,
  subject_kind      text not null
                      check (subject_kind in ('INVESTOR_ORGANISATION', 'COMPANY')),
  subject_id        uuid not null,
  subject_name      text not null check (length(subject_name) between 1 and 200),
  relationship_id   uuid,
  -- Q's reading (INVESTOR_PERSONA v2), validated by the server.
  profile           jsonb not null check (jsonb_typeof(profile) = 'object'),
  -- [{ "kind": "...", "label": "...", "ref": "...", "at": "..." }]
  sources           jsonb not null default '[]'::jsonb
                      check (jsonb_typeof(sources) = 'array'),
  -- A digest of the material the reading was built from: unchanged
  -- material is never read again; changed material refreshes it.
  signal_digest     text not null check (length(signal_digest) between 8 and 128),
  web_read_at       timestamptz,
  truth_class       text not null default 'Q_INFERENCE'
                      check (truth_class = 'Q_INFERENCE'),
  version           integer not null default 1 check (version >= 1),
  built_at          timestamptz not null default clock_timestamp(),
  refreshed_at      timestamptz not null default clock_timestamp(),
  unique (viewer_user_id, subject_kind, subject_id)
);

comment on table q_runtime.persona_profiles is
  'Q''s reading of a person or organisation as one viewer may see them, for rehearsals. Q inference about style with its sources; never a fact, never shown to the subject.';

create index persona_profiles_viewer_idx
  on q_runtime.persona_profiles (viewer_user_id, refreshed_at desc);

alter table q_runtime.persona_profiles enable row level security;

create policy persona_profiles_select_own
  on q_runtime.persona_profiles for select to authenticated
  using (
    viewer_user_id = (select private.current_app_user_id())
    and (select private.is_tenant_member(tenant_id))
  );

grant select on q_runtime.persona_profiles to authenticated;

-- Rehearsals with either side --------------------------------------------------

alter table q_runtime.rehearsals
  alter column investor_organisation_id drop not null,
  alter column investor_name drop not null,
  add column counterpart_kind text not null default 'INVESTOR_ORGANISATION'
    check (counterpart_kind in ('INVESTOR_ORGANISATION', 'COMPANY')),
  add column counterpart_id uuid,
  add column counterpart_name text
    check (counterpart_name is null or length(counterpart_name) between 1 and 200),
  add column user_role text not null default 'FOUNDER'
    check (user_role in ('FOUNDER', 'INVESTOR')),
  add column relationship_id uuid,
  add column meeting_id uuid,
  add column persona_profile_id uuid references q_runtime.persona_profiles (id) on delete set null,
  add column voice text check (voice is null or voice in ('FEMALE', 'MALE')),
  add column outcome text check (outcome is null or outcome in (
    'INDECISIVE', 'STRONG_LATER', 'ADJOURNED', 'DEAL_AGREED', 'DECLINED', 'LEFT_EARLY')),
  add column score integer check (score is null or score between 0 and 100),
  add column ended_at timestamptz;

update q_runtime.rehearsals
   set counterpart_id = investor_organisation_id,
       counterpart_name = investor_name
 where counterpart_id is null;

alter table q_runtime.rehearsals
  alter column counterpart_id set not null,
  alter column counterpart_name set not null,
  drop constraint rehearsals_asked_check,
  add constraint rehearsals_asked_check check (asked between 0 and 80);

create index rehearsals_user_recent_idx
  on q_runtime.rehearsals (user_id, created_at desc);
create index rehearsals_counterpart_idx
  on q_runtime.rehearsals (user_id, counterpart_kind, counterpart_id, created_at desc);
