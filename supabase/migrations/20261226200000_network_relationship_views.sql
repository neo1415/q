-- CRM saved views (owner directive 2026-10-15 §D; lane C).
--
-- A named pipeline filter, layout and column set, kept for one person
-- (PERSONAL) or shared with their workspace (ORGANISATION), for exactly one
-- canonical party: the actor organisation's company or its investor
-- organisation.
--
--   a saved view ≠ a relationship, a list of records, or an access grant
--
-- Presentation preferences only. The definition holds no record id,
-- selection, cursor, note or evidence: opening a view re-runs the reader's
-- own authorised pipeline query. Supersedes the unapplied WIP proposal
-- 20261224120000_network_relationship_views.sql (never applied anywhere).
-- Server-only: RLS on as a second layer, no policies, no client grants.

-- A view's company must belong to the view's own organisation. Companies
-- had only (id, tenant_id) as a referencable pair; this adds the triple
-- (a superset of the primary key, so it changes no existing row's meaning).
alter table core.companies
  add constraint companies_id_organisation_tenant_key
  unique (id, organisation_id, tenant_id);

create table network.relationship_views (
  id                        uuid primary key,
  tenant_id                 uuid not null,
  organisation_id           uuid not null,
  company_id                uuid,
  investor_organisation_id  uuid,
  owner_user_id             uuid not null,
  owner_membership_id       uuid not null,
  name                      text not null check (length(btrim(name)) between 1 and 64),
  scope                     text not null check (scope in ('PERSONAL', 'ORGANISATION')),
  definition                jsonb not null check (
    jsonb_typeof(definition) = 'object'
    and octet_length(definition::text) <= 4096
    and definition ?& array['query', 'layout', 'columns']
    and definition - array['query', 'layout', 'columns'] = '{}'::jsonb
    and jsonb_typeof(definition -> 'query') = 'object'
    -- Filters only: never a cursor or a selection.
    and (definition -> 'query') - array['q', 'state', 'sort', 'pageSize'] = '{}'::jsonb
    and jsonb_typeof(definition -> 'layout') = 'string'
    and definition ->> 'layout' in ('table', 'board')
    and jsonb_typeof(definition -> 'columns') = 'array'
    and jsonb_array_length(definition -> 'columns') <= 8
  ),
  version                   integer not null default 1 check (version > 0),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  -- Exactly one canonical party.
  check ((company_id is null) <> (investor_organisation_id is null)),
  foreign key (organisation_id, tenant_id)
    references identity.organisations (id, tenant_id) on delete restrict,
  -- The owner is a member of this very organisation, under this tenant. A
  -- removed membership takes its personal views with it.
  foreign key (owner_membership_id, owner_user_id, organisation_id, tenant_id)
    references identity.organisation_memberships (id, user_id, organisation_id, tenant_id)
    on delete cascade,
  foreign key (company_id, organisation_id, tenant_id)
    references core.companies (id, organisation_id, tenant_id) on delete cascade,
  foreign key (investor_organisation_id, organisation_id, tenant_id)
    references core.investor_organisations (id, organisation_id, tenant_id) on delete cascade
);

comment on table network.relationship_views is
  'CRM saved views (2026-10-15): one party''s presentation preferences only. No records, selections, cursors, notes or access rights. PERSONAL rows are their owner''s; ORGANISATION rows are shared with the workspace and written by organisation admins. Server-only.';

-- The list read: one party's views, the owner's personal ones beside shared.
create index relationship_views_party_idx
  on network.relationship_views (tenant_id, organisation_id, company_id, investor_organisation_id, scope, owner_user_id);

create index relationship_views_owner_membership_idx
  on network.relationship_views (owner_membership_id);

alter table network.relationship_views enable row level security;
revoke all on network.relationship_views from public, anon, authenticated;
