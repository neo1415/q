-- Rehearse with a researched external person (W4, founder direction
-- 2026-10-10): no Capital Q account, no relationship. Additive only.
--
-- 1. 'EXTERNAL_PERSON' joins the counterpart kinds of persona profiles and
--    rehearsals. The persona stays Q inference about style, per viewer.
-- 2. q_runtime.rehearsal_external_subjects: the sourced public evidence a
--    viewer's rehearsal was built from, frozen per brief version. Stable
--    identity is (external_person_id, brief_version): a rehearsal keeps the
--    exact evidence it was prepared from, and a newer brief makes a new row
--    (corrections create history, nothing is overwritten).
--
-- Server-written only; a person reads their own rows. Evidence here is
-- public-source material only; nothing in it is a Capital Q fact, and no
-- founder-private data is stored in it.

alter table q_runtime.persona_profiles
  drop constraint if exists persona_profiles_subject_kind_check,
  add constraint persona_profiles_subject_kind_check
    check (subject_kind in ('INVESTOR_ORGANISATION', 'COMPANY', 'EXTERNAL_PERSON'));

alter table q_runtime.rehearsals
  drop constraint if exists rehearsals_counterpart_kind_check,
  add constraint rehearsals_counterpart_kind_check
    check (counterpart_kind in ('INVESTOR_ORGANISATION', 'COMPANY', 'EXTERNAL_PERSON'));

create table q_runtime.rehearsal_external_subjects (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references identity.tenants (id) on delete restrict,
  viewer_user_id      uuid not null references identity.user_profiles (id) on delete restrict,
  external_person_id  uuid not null,
  brief_version       integer not null check (brief_version >= 0),
  evidence_bundle_id  uuid,
  -- The identity (ExternalPersonSubject) and its evidence-classed public
  -- brief (PersonBrief), both validated by the server; brief is null while
  -- no brief exists (thin evidence).
  subject             jsonb not null check (jsonb_typeof(subject) = 'object'),
  brief               jsonb check (brief is null or jsonb_typeof(brief) = 'object'),
  created_at          timestamptz not null default clock_timestamp(),
  unique (viewer_user_id, external_person_id, brief_version)
);

comment on table q_runtime.rehearsal_external_subjects is
  'Public-source evidence a rehearsal with an external person was prepared from, frozen per brief version. Server-written; never a Capital Q fact.';

create index rehearsal_external_subjects_viewer_idx
  on q_runtime.rehearsal_external_subjects (viewer_user_id, external_person_id, brief_version desc);

alter table q_runtime.rehearsal_external_subjects enable row level security;

create policy rehearsal_external_subjects_select_own
  on q_runtime.rehearsal_external_subjects for select to authenticated
  using (
    viewer_user_id = (select private.current_app_user_id())
    and (select private.is_tenant_member(tenant_id))
  );

grant select on q_runtime.rehearsal_external_subjects to authenticated;
