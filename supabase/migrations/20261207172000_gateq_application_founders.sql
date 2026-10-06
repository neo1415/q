-- F2 · A signed-in founder's own GateQ applications (2026-10-06).
--
--   an application ≠ a canonical company;  this row only says who sent it
--
-- An anonymous applicant stays anonymous: there is no row for them. When a
-- founder who is signed in presses Send, the application is linked to them
-- (and to their own company, when they have one) so their GateQ page can
-- show where each stands. They see the investor's name, when they sent it,
-- and what the investor sent back (a reply, or a pass with its reason) --
-- never the firm's notes, labels, stars, assignee or who opened it.
-- Server-only: RLS on, no policy, no browser grant.

create table gateq.application_founders (
  application_id   uuid primary key references gateq.applications (id) on delete restrict,
  -- The application's own tenant (the gateway's).
  tenant_id        uuid not null references identity.tenants (id) on delete restrict,
  founder_user_id  uuid not null references identity.user_profiles (id) on delete restrict,
  company_id       uuid references core.companies (id) on delete restrict,
  linked_at        timestamptz not null default now()
);

create index application_founders_by_founder_idx
  on gateq.application_founders (founder_user_id, linked_at desc);

create or replace function gateq.application_founder_tenant_matches()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (
    select 1 from gateq.applications a
     where a.id = new.application_id and a.tenant_id = new.tenant_id
  ) then
    raise exception 'a founder link belongs to its application''s tenant'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function gateq.application_founder_tenant_matches() from public;

create trigger application_founders_tenant before insert or update on gateq.application_founders
  for each row execute function gateq.application_founder_tenant_matches();

alter table gateq.application_founders enable row level security;
revoke all on gateq.application_founders from anon, authenticated;
