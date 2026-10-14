-- Durable server-owned dependency lineage. Historical NULL stays unknown.
-- No guest/browser grants and no automatic backfill inventing text-only proof.
alter table gateq.application_facts add column disclosure_lineage jsonb;
alter table gateq.application_turns add column disclosure_lineage jsonb;

create function gateq.check_disclosure_lineage(l jsonb, app uuid, tenant uuid, turn_seq integer)
returns boolean language plpgsql security invoker set search_path='' as $$
declare d jsonb; t jsonb;
begin
  if l is null then return true; end if;
  if jsonb_typeof(l) <> 'object' or pg_column_size(l)>65536 then return false; end if;
  if l->>'state'='UNKNOWN' then return l='{"state":"UNKNOWN"}'::jsonb; end if;
  if l->>'state' is distinct from 'COMPLETE' or jsonb_typeof(l->'documents') is distinct from 'array'
    or jsonb_typeof(l->'turnSeqs') is distinct from 'array' or
    (select count(*) from jsonb_object_keys(l))<>3 then return false; end if;
  if jsonb_array_length(l->'documents')>20 or jsonb_array_length(l->'turnSeqs')>1000 then return false; end if;
  for d in select value from jsonb_array_elements(l->'documents') loop
    if jsonb_typeof(d)<>'object' or (select count(*) from jsonb_object_keys(d))<>3
      or d->>'sha256' !~ '^[a-f0-9]{64}$' then return false; end if;
    if not exists(select 1 from evidence.documents x join evidence.document_versions v on v.document_id=x.id and v.tenant_id=x.tenant_id
      where x.id=(d->>'documentId')::uuid and v.id=(d->>'versionId')::uuid and v.sha256=d->>'sha256'
      and x.tenant_id=tenant and x.owner_kind='GATEQ_APPLICATION' and x.gateq_application_id=app) then return false; end if;
  end loop;
  for t in select value from jsonb_array_elements(l->'turnSeqs') loop
    if jsonb_typeof(t)<>'number' or t::text !~ '^[1-9][0-9]*$' then return false; end if;
    if turn_seq is not null and (t::text)::integer>=turn_seq then return false; end if;
    if not exists(select 1 from gateq.application_turns x where x.application_id=app and x.tenant_id=tenant and x.seq=(t::text)::integer) then return false; end if;
  end loop;
  return true;
exception when invalid_text_representation or numeric_value_out_of_range then return false;
end; $$;
revoke all on function gateq.check_disclosure_lineage(jsonb,uuid,uuid,integer) from public,anon,authenticated;
alter table gateq.application_facts add constraint application_facts_disclosure_lineage_valid
  check(gateq.check_disclosure_lineage(disclosure_lineage,application_id,tenant_id,null));
alter table gateq.application_turns add constraint application_turns_disclosure_lineage_valid
  check(gateq.check_disclosure_lineage(disclosure_lineage,application_id,tenant_id,seq));

create function gateq.protect_disclosure_lineage() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if old.disclosure_lineage is distinct from new.disclosure_lineage then
    raise exception 'recorded disclosure lineage is immutable' using errcode='check_violation';
  end if;
  return new;
end; $$;
revoke all on function gateq.protect_disclosure_lineage() from public,anon,authenticated;
create trigger application_facts_disclosure_lineage_immutable before update on gateq.application_facts
  for each row execute function gateq.protect_disclosure_lineage();
-- Turns already reject every update/delete; no weaker replacement trigger.
