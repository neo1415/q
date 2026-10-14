-- Retire-before-insert keeps the nondeferrable current-fact index intact.
-- Only the real successor reference is deferred within the writing transaction.
alter table gateq.application_facts
  alter constraint application_facts_superseded_by_fkey
  deferrable initially immediate;

alter table gateq.application_facts
  add constraint application_facts_no_self_supersession
  check (superseded_by is distinct from id);

create function gateq.validate_fact_successor()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare successor gateq.application_facts;
begin
  select * into successor from gateq.application_facts
    where id = new.superseded_by;
  -- Leave missing successors to the existing foreign key.
  if not found then return new; end if;
  if successor.application_id is distinct from new.application_id
     or successor.tenant_id is distinct from new.tenant_id
     or successor.dimension is distinct from new.dimension then
    raise exception 'Fact successor must share application, tenant and dimension'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create constraint trigger application_facts_successor_scope
after insert or update on gateq.application_facts
deferrable initially deferred
for each row when (new.superseded_by is not null)
execute function gateq.validate_fact_successor();
