-- The meeting record (ADR 0027): Q attends every Capital Q call by default
-- and keeps the full transcript and a structured record, readable by both
-- sides of the call. Additive: new columns, a participant read policy, and
-- the organiser's own-row policy kept as it was.

alter table communication.meeting_assistants
  add column transcript  jsonb not null default '[]'::jsonb check (jsonb_typeof(transcript) = 'array'),
  add column attendees   jsonb not null default '[]'::jsonb check (jsonb_typeof(attendees) = 'array'),
  add column agreements  jsonb not null default '[]'::jsonb check (jsonb_typeof(agreements) = 'array'),
  add column commitments jsonb not null default '[]'::jsonb check (jsonb_typeof(commitments) = 'array');

comment on column communication.meeting_assistants.transcript is
  'The call''s captions as speaker lines (ADR 0027), kept as the record of a meeting Capital Q arranged. Both sides of the call may read it.';
comment on column communication.meeting_assistants.commitments is
  'Money mentioned in the call as commitment signals with a firmness; never committed capital without human confirmation (spec 6.6.14).';

-- Every participant of the call reads its record, not only the organiser.
create policy meeting_assistants_select_participant
  on communication.meeting_assistants for select to authenticated
  using (
    exists (
      select 1 from communication.meeting_participants p
       where p.meeting_id = meeting_assistants.meeting_id
         and p.user_id = (select private.current_app_user_id())
         and (select private.is_tenant_member(p.participant_tenant_id))
    )
  );
