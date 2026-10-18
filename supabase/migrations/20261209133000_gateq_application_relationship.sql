-- P14 (2026-10-06): a GateQ application sent by a signed-in founder for their
-- own company belongs to the ONE canonical company-investor relationship
-- (network.relationships, UNIQUE (company_id, investor_organisation_id)).
--
--   an application ≠ a relationship;  it points at the canonical pair,
--   never a parallel deal or match record
--
-- The relationship is ensured by Network's own command (source GATEQ,
-- relationship_shared: both sides know of the application); this column
-- only records which pair the application joined. Anonymous applications
-- have no founder row and no relationship. Still server-only.

alter table gateq.application_founders
  add column relationship_id uuid references network.relationships (id) on delete restrict;

comment on column gateq.application_founders.relationship_id is
  'P14: the canonical company-investor relationship this application joined (Network ensures it, source GATEQ). Null for a founder with no company, or before it is linked.';

create index application_founders_by_relationship_idx
  on gateq.application_founders (relationship_id)
  where relationship_id is not null;

-- The pair the application names must be the application's own: its
-- founder's company and the gateway's investor organisation.
create or replace function gateq.application_founder_relationship_matches()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.relationship_id is not null and not exists (
    select 1
      from network.relationships r
      join gateq.applications a on a.id = new.application_id
      join gateq.gateways g on g.id = a.gateway_id
     where r.id = new.relationship_id
       and r.company_id = new.company_id
       and r.investor_organisation_id = g.investor_organisation_id
  ) then
    raise exception 'an application joins only its own company-investor relationship'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function gateq.application_founder_relationship_matches() from public;

create trigger application_founders_relationship
  before insert or update of relationship_id on gateq.application_founders
  for each row execute function gateq.application_founder_relationship_matches();
