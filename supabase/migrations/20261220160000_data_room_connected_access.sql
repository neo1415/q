-- Data-room access goes through the relationship (founder decision,
-- 2026-10-08).
--
-- An investor reaches a company's data room only once the founder has
-- accepted their interest: the canonical relationship's history holds a
-- connection_accepted event (the only way to CONNECTED; connection is
-- never ended in v1). The server refuses an unconnected investor's request
-- and the investor sees the room locked; this migration adds the same rule
-- as a second layer in the database, so a request row can never exist for
-- a relationship that is not connected, whichever code path wrote it.
--
-- The rule reads the history, never network.relationships.current_state:
-- the cached state is the projector's and may lag the event that connected
-- the pair.
--
--   private.relationship_is_connected(uuid)  the history holds an accepted connection
--   evidence.data_room_access_requests       insert refused unless connected (42501)
--   evidence.data_room_settings              the founder's choice to show folder
--                                            names and counts (never titles) to
--                                            investors not yet connected; default off
--
-- Server-only like the rest of evidence: RLS on, no policies, no client
-- grants.

-- 1. The rule -------------------------------------------------------------------

create function private.relationship_is_connected(target_relationship_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from network.relationship_events e
     where e.relationship_id = target_relationship_id
       and e.event_type = 'connection_accepted')
$$;

revoke all on function private.relationship_is_connected(uuid) from public, anon, authenticated;

comment on function private.relationship_is_connected(uuid) is
  'The founder accepted this relationship''s interest (a connection_accepted event in its history). Data-room requests and shares go only through a connected relationship.';

create function private.data_room_request_requires_connection()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not private.relationship_is_connected(new.relationship_id) then
    raise exception 'a data-room request goes only through a connected relationship'
      using errcode = '42501';
  end if;
  return new;
end
$$;

revoke all on function private.data_room_request_requires_connection() from public, anon, authenticated;

create trigger data_room_access_requests_require_connection
  before insert on evidence.data_room_access_requests
  for each row execute function private.data_room_request_requires_connection();

-- 2. The founder's outline choice ---------------------------------------------------

create table evidence.data_room_settings (
  company_id                 uuid primary key,
  tenant_id                  uuid not null references identity.tenants (id) on delete restrict,
  -- Investors not yet connected may see folder names and how many listed
  -- documents each holds. Never titles, never contents, never requests.
  outline_before_connection  boolean not null default false,
  updated_by_user_id         uuid not null references identity.user_profiles (id) on delete restrict,
  updated_at                 timestamptz not null default clock_timestamp(),
  foreign key (company_id, tenant_id)
    references core.companies (id, tenant_id) on delete restrict
);

comment on table evidence.data_room_settings is
  'A company''s data-room settings. outline_before_connection: investors not yet connected see folder names and counts only (default off). Changes are audited (data_room.outline_changed).';

alter table evidence.data_room_settings enable row level security;
revoke all on evidence.data_room_settings from anon, authenticated;
