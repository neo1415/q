-- Founder direction 2026-09-30: stop trusting one party to decide whether
-- the record exists.
--
-- 1. Q attends every call booked on Capital Q. A participant may still
--    decline recording (their legal right), but that is now a recorded
--    fact: status DECLINED with who and when, both sides are told, and the
--    relationship's history keeps `meeting_recording_declined`. The meeting
--    itself still counts as held through Capital Q.
-- 2. Money said in a call becomes a DETECTED commitment Q files on the
--    relationship. Either side adopts it (then the other confirms, as
--    before) or disputes it; nobody deletes it. Detected money never counts
--    toward a raise until a person on each side confirms (spec 6.6.14).
--
-- Additive: new statuses, nullable columns, a partial unique index.

alter table communication.meeting_assistants
  drop constraint meeting_assistants_status_check,
  add constraint meeting_assistants_status_check
    check (status in ('REQUESTED', 'SCHEDULED', 'IN_CALL', 'COMPOSING', 'DONE', 'FAILED', 'CANCELLED', 'DECLINED')),
  add column declined_by_user_id uuid references identity.user_profiles (id) on delete restrict,
  add column declined_at timestamptz,
  add constraint meeting_assistants_declined_check
    check ((status = 'DECLINED') = (declined_at is not null and declined_by_user_id is not null));

alter table communication.notifications
  drop constraint notifications_kind_check,
  add constraint notifications_kind_check
    check (kind in ('REMINDER', 'MEETING_SCHEDULED', 'MEETING_CANCELLED', 'MEETING_PREP_READY',
                    'MEETING_NOTES_READY', 'Q_SCOUT', 'Q_ERRAND', 'MEETING_RECORDING_DECLINED',
                    'COMMITMENT_DETECTED'));

-- Q-detected commitments: no person stated them, and the side is known
-- only when the call's record says who spoke.
alter table network.commitments
  alter column stated_by_user_id drop not null,
  alter column stated_by_side drop not null,
  add column source text not null default 'PERSON'
    check (source in ('PERSON', 'Q_MEETING')),
  add column quote text check (quote is null or length(quote) between 1 and 300),
  add column disputed_by_user_id uuid references identity.user_profiles (id) on delete restrict,
  add column disputed_at timestamptz,
  drop constraint commitments_status_check,
  add constraint commitments_status_check
    check (status in ('STATED', 'CONFIRMED', 'SUPERSEDED', 'WITHDRAWN', 'DETECTED', 'ADOPTED', 'DISPUTED')),
  add constraint commitments_person_stated_check
    check (source <> 'PERSON' or (stated_by_user_id is not null and stated_by_side is not null)),
  add constraint commitments_detected_check
    check (status not in ('DETECTED', 'ADOPTED', 'DISPUTED') or source <> 'PERSON'),
  add constraint commitments_disputed_check
    check ((status = 'DISPUTED') = (disputed_at is not null));

-- One detection per signal, however often the record is settled.
create unique index commitments_detected_key_idx
  on network.commitments (relationship_id, idempotency_key)
  where source <> 'PERSON';

comment on column network.commitments.source is
  'PERSON: stated by a party. Q_MEETING: money Q heard in a call it recorded; counts only after a party adopts it and the other side confirms.';
