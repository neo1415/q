-- Hub H2: presentation preferences, never a second relationship state store.
create table network.relationship_views (
  id uuid primary key,
  tenant_id uuid not null,
  organisation_id uuid not null,
  owner_user_id uuid not null references identity.user_profiles(id) on delete restrict,
  name text not null check(length(btrim(name)) between 1 and 80),
  scope text not null check(scope in ('PERSONAL','ORGANISATION')),
  definition jsonb not null check(jsonb_typeof(definition)='object'),
  version integer not null default 1 check(version>0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key(organisation_id,tenant_id) references identity.organisations(id,tenant_id) on delete restrict
);
comment on table network.relationship_views is 'Actor-scoped filter/presentation preferences only. No canonical business state, notes, evidence or authorization grants. Team writes require organisation.admin through the API.';
create index relationship_views_scope_idx on network.relationship_views(tenant_id,organisation_id,owner_user_id);
alter table network.relationship_views enable row level security;
revoke all on network.relationship_views from public,anon,authenticated;
grant select,insert,update,delete on network.relationship_views to service_role;
-- Server-internal like canonical Network tables: no client policies/grants.
