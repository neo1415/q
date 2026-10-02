-- ADMIN-4 (founder feedback 2026-10-02): verification is requested
-- automatically once an organisation is on the network; only the
-- operator's acceptance stays manual.
--
-- An automatic request carries only what Capital Q already knows: the
-- organisation's name, legal name, website and country when given, and the
-- requester's email DOMAIN with whether it matches the website. Nothing is
-- invented, so the details a person must otherwise type (legal name,
-- registration number, jurisdiction) may be missing on an AUTO row; a
-- PERSON row still needs all three. When the organisation then sends its own
-- details, the automatic row is SUPERSEDED (decided once, by the system, with
-- the reason) and the new row points at the same pending claim.
-- verification_claims stays its own axis (ADR-001).

alter table core.kyb_submissions
  add column source text not null default 'PERSON' check (source in ('PERSON', 'AUTO')),
  add column organisation_name text check (organisation_name is null or length(btrim(organisation_name)) between 1 and 300),
  add column contact_email_domain text check (contact_email_domain is null or contact_email_domain ~ '^[a-z0-9.-]{1,253}$'),
  add column email_domain_matches_website boolean;

alter table core.kyb_submissions
  alter column legal_name drop not null,
  alter column registration_number drop not null,
  alter column jurisdiction_code drop not null;

alter table core.kyb_submissions
  drop constraint kyb_submissions_status_check,
  add constraint kyb_submissions_status_check
    check (status in ('SUBMITTED', 'APPROVED', 'REJECTED', 'SUPERSEDED')),
  drop constraint kyb_submissions_check1,
  add constraint kyb_submissions_decided_check
    check (status = 'SUBMITTED'
           or (status = 'SUPERSEDED' and decision_reason is not null)
           or (decision_reason is not null and decided_by_user_id is not null)),
  drop constraint kyb_submissions_jurisdiction_code_check,
  add constraint kyb_submissions_jurisdiction_code_check
    check (jurisdiction_code is null or jurisdiction_code ~ '^[A-Z]{2}$'),
  drop constraint kyb_submissions_legal_name_check,
  add constraint kyb_submissions_legal_name_check
    check (legal_name is null or length(btrim(legal_name)) between 1 and 300),
  drop constraint kyb_submissions_registration_number_check,
  add constraint kyb_submissions_registration_number_check
    check (registration_number is null or length(btrim(registration_number)) between 1 and 100),
  add constraint kyb_submissions_person_details_check
    check (source = 'AUTO' or (legal_name is not null and registration_number is not null
                               and jurisdiction_code is not null)),
  add constraint kyb_submissions_superseded_by_system_check
    check (status <> 'SUPERSEDED' or decided_by_user_id is null);

comment on column core.kyb_submissions.source is
  'PERSON: details the organisation sent. AUTO: Capital Q asked on its behalf from what it already knew (founder direction 2026-10-02).';

-- The notice that a request was made for them.
alter table communication.notifications
  drop constraint notifications_kind_check,
  add constraint notifications_kind_check
    check (kind in ('REMINDER', 'MEETING_SCHEDULED', 'MEETING_CANCELLED', 'MEETING_PREP_READY',
                    'MEETING_NOTES_READY', 'Q_SCOUT', 'Q_ERRAND', 'MEETING_RECORDING_DECLINED',
                    'COMMITMENT_DETECTED', 'ACCOUNT_PAUSED', 'Q_WORK', 'Q_STAND_IN',
                    'INTEREST_RECEIVED', 'CONNECTION_REQUESTED', 'Q_MESSAGE', 'TIME_PROPOSED',
                    'HUMAN_REVIEW', 'VERIFICATION_DECIDED', 'VERIFICATION_REQUESTED'));
