-- P5 (2026-10-06): what Q saw on a shared screen in a call it attended,
-- kept as Q's PRIVATE notes for the person whose assistant Q was -- never
-- the transcript, never the recap or notes sent to participants, never the
-- other side. Frames themselves are never stored: only Q's short written
-- observation of a screen share, one row per look.

create table communication.meeting_private_observations (
  id              uuid primary key default gen_random_uuid(),
  meeting_id      uuid not null references communication.meetings (id) on delete restrict,
  tenant_id       uuid not null references identity.tenants (id) on delete restrict,
  owner_user_id   uuid not null references identity.user_profiles (id) on delete restrict,
  source          text not null check (source in ('SCREEN_SHARE')),
  -- Who shared the screen, as the call named them (no identity inferred).
  shared_by_name  text check (length(shared_by_name) between 1 and 200),
  body            text not null check (length(body) between 1 and 600),
  observed_at     timestamptz not null,
  created_at      timestamptz not null default clock_timestamp()
);

comment on table communication.meeting_private_observations is
  'Q''s private written observations of screens shared in a call (P5), for the assistant''s owner only. Never shown to other participants or included in recaps. Append-only; no frames stored.';

create index meeting_private_observations_owner_idx
  on communication.meeting_private_observations (owner_user_id, meeting_id, observed_at);

create function private.communication_meeting_private_observations_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'communication.meeting_private_observations is append-only'
    using errcode = '55000';
end
$$;

create trigger meeting_private_observations_append_only
  before update or delete on communication.meeting_private_observations
  for each row execute function private.communication_meeting_private_observations_append_only();

alter table communication.meeting_private_observations enable row level security;

-- The owner alone, in their own tenant. Being a participant is not enough.
create policy meeting_private_observations_select_owner
  on communication.meeting_private_observations for select to authenticated
  using (
    owner_user_id = (select private.current_app_user_id())
    and (select private.is_tenant_member(tenant_id))
  );

revoke all on function private.communication_meeting_private_observations_append_only() from public, anon, authenticated;
revoke all on communication.meeting_private_observations from anon, authenticated;
grant select on communication.meeting_private_observations to authenticated;
