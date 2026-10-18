-- Capital Q's own operators (founder direction 2026-09-29/30: an admin
-- console for the attribution and fee ledger, disputes, vetting and usage).
--
-- A platform admin is a person Capital Q itself designates; it is not an
-- organisation role and nothing in a tenant can grant it. Rows are written
-- only by Capital Q's operators with privileged access (never by the app),
-- read only by the server; no authenticated grant exists, so no browser can
-- read or write this table.

create table identity.platform_admins (
  user_id     uuid primary key references identity.user_profiles (id) on delete restrict,
  granted_at  timestamptz not null default clock_timestamp(),
  note        text check (note is null or length(note) <= 200)
);

comment on table identity.platform_admins is
  'Capital Q operators. Server-only: no RLS policy and no grant to authenticated; written by privileged operators only.';

alter table identity.platform_admins enable row level security;
