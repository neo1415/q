-- A person's own Q Card (owner 2026-10-22; Q Story S6). Additive.
--
-- Handles and cards so far named a company or an investor organisation.
-- A person may now hold one too: `/@amina-otieno`, a card of their name,
-- role, organisation and what they are looking for. It is the person's
-- alone -- the same rule core.profile_images already applies to a
-- person's photo:
--
--   * subject_type 'PERSON', subject_id the person's user id;
--   * no organisation (organisation_id null), so no organisation role
--     can claim, change or publish it;
--   * the claimer / creator must be the person themselves.
--
-- Existing rows are untouched: each new check holds for every COMPANY and
-- INVESTOR_ORGANISATION row (they keep a non-null organisation). RLS and
-- grants are unchanged: still server-internal, no policies, no client
-- grants. Nothing is dropped except the two subject-type checks, which
-- are replaced by wider ones in the same statement.

alter table core.handles
  drop constraint handles_subject_type_check,
  add constraint handles_subject_type_check
    check (subject_type in ('PERSON', 'COMPANY', 'INVESTOR_ORGANISATION')),
  alter column organisation_id drop not null,
  add constraint handles_person_has_no_organisation
    check ((subject_type = 'PERSON') = (organisation_id is null)),
  add constraint handles_person_claims_own
    check (subject_type <> 'PERSON'
           or (claimed_by_user_id is not null and subject_id = claimed_by_user_id));

alter table core.shareable_identities
  drop constraint shareable_identities_subject_type_check,
  add constraint shareable_identities_subject_type_check
    check (subject_type in ('PERSON', 'COMPANY', 'INVESTOR_ORGANISATION')),
  alter column organisation_id drop not null,
  add constraint shareable_identities_person_has_no_organisation
    check ((subject_type = 'PERSON') = (organisation_id is null)),
  add constraint shareable_identities_person_creates_own
    check (subject_type <> 'PERSON'
           or (created_by_user_id is not null and subject_id = created_by_user_id));

comment on table core.handles is
  'Global display routes for people, companies and investor organisations. ACTIVE: in use. HELD: renamed away, redirects and is unclaimable until hold_until. RETIRED: a verified organisation''s old handle, redirects and is never recycled. RELEASED: an expired hold, history only. A PERSON handle has no organisation and is claimed only by that person.';
