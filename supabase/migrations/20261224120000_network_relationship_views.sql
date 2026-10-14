-- Presentation preferences only. Canonical parties, state and disclosure remain unchanged.
create table network.relationship_views (
  id uuid primary key,
  tenant_id uuid not null,
  organisation_id uuid not null,
  company_id uuid,
  investor_organisation_id uuid,
  owner_user_id uuid not null,
  owner_membership_id uuid not null,
  name text not null check (length(btrim(name)) between 1 and 64),
  scope text not null check (scope in ('PERSONAL','ORGANISATION')),
  definition jsonb not null check (
    jsonb_typeof(definition)='object'
    and octet_length(definition::text)<=4096
    and definition ?& array['query','layout','columns']
    and definition - array['query','layout','columns']='{}'::jsonb
    and jsonb_typeof(definition->'query')='object'
    and (definition->'query') - array['q','state','sort','pageSize']='{}'::jsonb
    and jsonb_typeof(definition->'layout')='string'
    and definition->>'layout' in ('table','board')
    and jsonb_typeof(definition->'columns')='array'
  ),
  version integer not null default 1 check (version>0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((company_id is null) <> (investor_organisation_id is null)),
  foreign key (organisation_id,tenant_id) references identity.organisations(id,tenant_id) on delete restrict,
  foreign key (owner_membership_id,owner_user_id,organisation_id,tenant_id) references identity.organisation_memberships(id,user_id,organisation_id,tenant_id) on delete restrict,
  foreign key (company_id,tenant_id) references core.companies(id,tenant_id) on delete restrict,
  foreign key (investor_organisation_id,organisation_id,tenant_id) references core.investor_organisations(id,organisation_id,tenant_id) on delete restrict
);
comment on table network.relationship_views is 'Actor/current-party-scoped presentation preferences only. No facts, notes, selected records or disclosure rights. Team writes require organisation.admin; compare-and-swap versions and transaction locks enforce bounded CRUD.';
create index relationship_views_scope_idx on network.relationship_views(tenant_id,organisation_id,company_id,investor_organisation_id,scope,owner_user_id);
alter table network.relationship_views enable row level security;
revoke all on network.relationship_views from public,anon,authenticated;
grant select,insert,update,delete on network.relationship_views to service_role;
-- Server adapter only: no direct client policies or grants.
