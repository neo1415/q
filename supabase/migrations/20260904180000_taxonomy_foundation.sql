-- CQ-TAX-001 · Canonical taxonomy schema
--
-- One Capital Q classification language, shared by both sides of capital
-- (doc 11 §11, doc 13 §15): versioned vocabularies, stable multi-label
-- nodes with a primary hierarchy, non-tree semantic edges, normalised
-- aliases, confirmed entity classification with history and raw language,
-- and declared mandate preferences over the same nodes.
--
-- Kept apart, permanently:
--
--   Company classification ≠ Investor preference (same taxonomy.nodes.id)
--   canonical_code / id = identity; display_name ≠ identity
--   raw_source_text = what was said; node = what Capital Q mapped it to
--   Taxonomy = classification, never assessment, never a ranking weight
--
-- Versioning (ADR 0005): taxonomy.vocabularies.version + stable node ids and
-- codes + node status/validity. No separate taxonomy_versions table.
-- Classification runs and candidates belong to CQ-TAX-002 and are not
-- created here. Reference rows are platform data (no tenant); assignments
-- are tenant-owned; mandate preferences follow their canonical mandate.
-- Every table is server-internal: RLS enabled, no policies, no client grants.

create schema if not exists taxonomy;
comment on schema taxonomy is
  'Canonical Capital Q taxonomy: reference vocabularies/nodes/edges/aliases, entity classification, mandate preferences. Server-internal; read through the API.';
revoke all on schema taxonomy from public;

-- ---------------------------------------------------------------------------
-- taxonomy.vocabularies
-- ---------------------------------------------------------------------------

create table taxonomy.vocabularies (
  id           uuid primary key,
  code         text not null unique check (code ~ '^[a-z][a-z0-9_]*$' and length(code) <= 64),
  name         text not null check (length(btrim(name)) between 1 and 120),
  description  text check (description is null or length(description) between 1 and 1000),
  -- Semantic/reference version of this vocabulary. Bumped by a reviewed migration.
  version      integer not null default 1 check (version >= 1),
  status       text not null default 'ACTIVE' check (status in ('ACTIVE', 'RETIRED')),
  created_at   timestamptz not null default now()
);

comment on table taxonomy.vocabularies is
  'A separate classification dimension (industry, product_category, technology ...). Never one mega-tree. Platform reference data; no tenant.';

-- ---------------------------------------------------------------------------
-- taxonomy.nodes
-- ---------------------------------------------------------------------------

create table taxonomy.nodes (
  id              uuid primary key,
  vocabulary_id   uuid not null references taxonomy.vocabularies (id) on delete restrict,
  -- Stable canonical identity within the vocabulary. Never derived from the label.
  canonical_code  text not null check (canonical_code ~ '^[a-z0-9][a-z0-9._-]{0,127}$'),
  display_name    text not null check (length(btrim(display_name)) between 1 and 200),
  description     text check (description is null or length(description) between 1 and 2000),
  -- Primary hierarchy: always within the same vocabulary (composite FK below).
  parent_node_id  uuid,
  depth           integer not null default 0 check (depth between 0 and 16),
  status          text not null default 'ACTIVE' check (status in ('ACTIVE', 'DEPRECATED')),
  valid_from      timestamptz,
  valid_to        timestamptz check (valid_to is null or valid_from is null or valid_to >= valid_from),
  -- Sparse interoperability metadata (ISO country code, future external codes). Never rules or weights.
  metadata        jsonb not null default '{}'::jsonb
                    check (jsonb_typeof(metadata) = 'object' and length(metadata::text) <= 2048),

  unique (vocabulary_id, canonical_code),
  unique (id, vocabulary_id),
  foreign key (parent_node_id, vocabulary_id)
    references taxonomy.nodes (id, vocabulary_id) on delete restrict,
  check ((parent_node_id is null) = (depth = 0))
);

comment on table taxonomy.nodes is
  'A canonical concept. id and canonical_code are stable across renames; display_name may change. Multi-label: many nodes may describe one entity.';
comment on column taxonomy.nodes.parent_node_id is
  'Primary hierarchy parent in the same vocabulary. Non-tree relations live in taxonomy.node_edges.';

-- Hierarchy integrity beyond what constraints can express: depth follows
-- the parent and no node may become its own ancestor. Bounded walk.
create function taxonomy.enforce_node_hierarchy()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  parent_depth integer;
  cursor_id uuid;
  steps integer := 0;
begin
  if new.parent_node_id is null then
    return new;
  end if;
  if new.parent_node_id = new.id then
    raise exception 'taxonomy node % cannot be its own parent', new.id
      using errcode = 'check_violation';
  end if;
  select n.depth into parent_depth from taxonomy.nodes n where n.id = new.parent_node_id;
  if parent_depth is null then
    raise exception 'taxonomy node % names an unknown parent', new.id
      using errcode = 'foreign_key_violation';
  end if;
  if new.depth <> parent_depth + 1 then
    raise exception 'taxonomy node % depth must be %', new.id, parent_depth + 1
      using errcode = 'check_violation';
  end if;
  cursor_id := new.parent_node_id;
  while cursor_id is not null loop
    if cursor_id = new.id then
      raise exception 'taxonomy node % would become its own ancestor', new.id
        using errcode = 'check_violation';
    end if;
    steps := steps + 1;
    if steps > 16 then
      raise exception 'taxonomy hierarchy exceeds the maximum depth'
        using errcode = 'check_violation';
    end if;
    select n.parent_node_id into cursor_id from taxonomy.nodes n where n.id = cursor_id;
  end loop;
  return new;
end;
$$;

revoke all on function taxonomy.enforce_node_hierarchy() from public;

create trigger enforce_node_hierarchy
  before insert or update of parent_node_id, depth on taxonomy.nodes
  for each row execute function taxonomy.enforce_node_hierarchy();

create index nodes_vocabulary_parent_status_idx
  on taxonomy.nodes (vocabulary_id, parent_node_id, status);
create index nodes_parent_idx on taxonomy.nodes (parent_node_id);
create index nodes_status_idx on taxonomy.nodes (status);
create index nodes_vocabulary_display_name_idx
  on taxonomy.nodes (vocabulary_id, display_name, id);

-- ---------------------------------------------------------------------------
-- taxonomy.node_edges  (non-tree relationships; semantics, never weights)
-- ---------------------------------------------------------------------------

create table taxonomy.node_edges (
  from_node_id  uuid not null references taxonomy.nodes (id) on delete restrict,
  to_node_id    uuid not null references taxonomy.nodes (id) on delete restrict,
  edge_type     text not null check (edge_type in (
                  'broader_than', 'related_to', 'overlaps', 'commonly_co_occurs', 'successor_of')),
  created_at    timestamptz not null default now(),
  primary key (from_node_id, to_node_id, edge_type),
  check (from_node_id <> to_node_id)
);

comment on table taxonomy.node_edges is
  'Non-primary semantic relations. successor_of: from = the replacement, to = the deprecated concept. No ranking weight lives here.';

create index node_edges_to_idx on taxonomy.node_edges (to_node_id, edge_type);

-- ---------------------------------------------------------------------------
-- taxonomy.aliases  (retrieval assistance; never identity)
-- ---------------------------------------------------------------------------

create table taxonomy.aliases (
  id                uuid primary key,
  node_id           uuid not null references taxonomy.nodes (id) on delete restrict,
  alias             text not null check (length(btrim(alias)) between 1 and 200),
  locale            text not null default 'en' check (locale ~ '^[a-z]{2,3}(-[a-z0-9]{2,8})*$'),
  alias_type        text not null default 'SYNONYM'
                      check (alias_type in ('SYNONYM', 'ABBREVIATION', 'COLLOQUIAL', 'LEGACY')),
  -- normalizeTaxonomyAlias(alias): NFKC, trim, lowercase, collapsed whitespace, punctuation spacing.
  normalized_alias  text not null check (length(normalized_alias) between 1 and 200),
  -- One alias per node per locale; the same phrase may point at nodes in
  -- different vocabularies (payments: industry vs product). CQ-TAX-002
  -- disambiguates candidates by vocabulary/context.
  unique (node_id, locale, normalized_alias)
);

create index aliases_normalized_idx on taxonomy.aliases (normalized_alias);
create index aliases_locale_normalized_idx on taxonomy.aliases (locale, normalized_alias);
create index aliases_node_idx on taxonomy.aliases (node_id);

-- ---------------------------------------------------------------------------
-- taxonomy.entity_assignments  (tenant-owned classification with history)
-- ---------------------------------------------------------------------------

create table taxonomy.entity_assignments (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references identity.tenants (id) on delete restrict,
  -- Typed subject; resolved by the application's subject resolver, never a table name.
  entity_type            text not null check (entity_type in ('COMPANY')),
  entity_id              uuid not null,
  node_id                uuid not null references taxonomy.nodes (id) on delete restrict,
  -- How the mapping entered Capital Q. Not verification.
  assignment_source      text not null check (assignment_source in (
                           'user_selected', 'q_inferred', 'document_extracted', 'admin_curated', 'integration')),
  -- Classifier confidence where meaningful; never a company quality.
  confidence             numeric(5, 4) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  status                 text not null default 'ACTIVE' check (status in ('ACTIVE', 'SUPERSEDED')),
  -- What the user/source actually said, verbatim and bounded. Never a deck, a document or a conversation.
  raw_source_text        text check (raw_source_text is null or length(raw_source_text) between 1 and 4000),
  -- Future evidence source reference (CQ-EVD). No FK until the target exists.
  source_id              uuid,
  -- Future taxonomy.classification_runs reference (CQ-TAX-002). No FK until the target exists.
  classification_run_id  uuid,
  confirmed_by_user_id   uuid references identity.user_profiles (id) on delete restrict,
  confirmed_at           timestamptz,
  valid_from             timestamptz not null default clock_timestamp(),
  valid_to               timestamptz,
  created_at             timestamptz not null default clock_timestamp(),

  check ((status = 'SUPERSEDED') = (valid_to is not null)),
  check (valid_to is null or valid_to >= valid_from),
  check ((confirmed_by_user_id is null) = (confirmed_at is null))
);

comment on table taxonomy.entity_assignments is
  'Canonical mapping of an entity to taxonomy nodes. Current = ACTIVE with no valid_to; removal supersedes (valid_to), never deletes. raw_source_text is preserved separately from the mapping and never emitted.';

-- One current assignment per subject + node; history may repeat.
create unique index entity_assignments_current_uniq
  on taxonomy.entity_assignments (tenant_id, entity_type, entity_id, node_id)
  where status = 'ACTIVE' and valid_to is null;
create index entity_assignments_subject_idx
  on taxonomy.entity_assignments (tenant_id, entity_type, entity_id, status);
create index entity_assignments_node_idx
  on taxonomy.entity_assignments (node_id, status);

-- ---------------------------------------------------------------------------
-- taxonomy.mandate_preferences  (declared investor policy over the same nodes)
-- ---------------------------------------------------------------------------

create table taxonomy.mandate_preferences (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references identity.tenants (id) on delete restrict,
  mandate_id           uuid not null,
  node_id              uuid not null references taxonomy.nodes (id) on delete restrict,
  -- The CQ-INV-002 preference scale, reused unchanged.
  preference_strength  text not null check (preference_strength in (
                         'MUST', 'STRONG', 'NICE', 'NEUTRAL', 'AVOID', 'HARD_EXCLUSION')),
  -- Hard eligibility exclusion. AVOID is soft and never becomes one.
  is_exclusion         boolean not null default false,
  source               text not null default 'user_selected' check (source in (
                         'user_selected', 'q_inferred', 'document_extracted', 'admin_curated', 'integration')),
  confidence           numeric(5, 4) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  created_at           timestamptz not null default clock_timestamp(),

  unique (mandate_id, node_id),
  foreign key (mandate_id, tenant_id)
    references core.investor_mandates (id, tenant_id) on delete restrict,
  check ((preference_strength = 'HARD_EXCLUSION') = is_exclusion)
);

comment on table taxonomy.mandate_preferences is
  'Declared mandate preference per canonical node. Investor-private. Written only through the versioned Investor mandate command; never from observed behaviour or Q inference.';

create index mandate_preferences_mandate_idx on taxonomy.mandate_preferences (mandate_id);
create index mandate_preferences_node_idx on taxonomy.mandate_preferences (node_id);

-- ---------------------------------------------------------------------------
-- Exposure: every table is INTERNAL_SERVER_ONLY.
-- ---------------------------------------------------------------------------

alter table taxonomy.vocabularies enable row level security;
alter table taxonomy.nodes enable row level security;
alter table taxonomy.node_edges enable row level security;
alter table taxonomy.aliases enable row level security;
alter table taxonomy.entity_assignments enable row level security;
alter table taxonomy.mandate_preferences enable row level security;
-- No policies, no anon/authenticated/service_role grants. Reference reads
-- are served by the API; platform taxonomy changes by reviewed migration.

-- ---------------------------------------------------------------------------
-- Reference taxonomy (V1). Rendered from packages/taxonomy/src/reference-data;
-- explicit stable ids so every environment shares them. Idempotent.
-- ---------------------------------------------------------------------------

-- Reference taxonomy (rendered from @capital-q/taxonomy reference-data; do not hand-edit).

insert into taxonomy.vocabularies (id, code, name, description, version, status) values
  ('9e323247-8a4b-575b-acdc-6f682f0d6a7b', 'industry', 'Industry', 'The sector a company operates in. Multi-label; primary hierarchy sector → subsector → niche.', 1, 'ACTIVE'),
  ('817328a5-d8a6-561a-aa45-3144d746050b', 'product_category', 'Product Category', 'What the company actually builds and sells. Multi-label; independent of industry.', 1, 'ACTIVE'),
  ('2bb94def-82b9-5d60-a5fc-d94fe1033faf', 'technology', 'Technology', 'The enabling technology. Multi-label; describes how, not what or for whom.', 1, 'ACTIVE'),
  ('38a60b83-77b4-5e95-8d35-3195931834f1', 'business_model', 'Business Model', 'How the company earns. Multi-label.', 1, 'ACTIVE'),
  ('f32c294b-60f0-546a-be01-921cd460803a', 'customer_type', 'Customer Type', 'Who buys. Multi-label; business customers may be further sized.', 1, 'ACTIVE'),
  ('581f6374-71d2-5ea3-bb4b-6365d49ed79f', 'company_stage', 'Company Stage', 'Financing stage. Shared vocabulary for Company.current_stage_code, capital objective target stage and mandate stage codes; it does not replace those columns.', 1, 'ACTIVE'),
  ('512652ee-b4a7-519f-ae12-9db2b1607ee2', 'geography', 'Geography', 'Operating and target markets: regions and countries. Regional containment is a pragmatic MVP grouping, not a political statement.', 1, 'ACTIVE'),
  ('a5a8681e-7d96-5c76-af7c-031dd10c2556', 'impact_theme', 'Impact Theme', 'Minimal V1 shell: the impact themes current product flows name. Extended only when a flow needs it.', 1, 'ACTIVE'),
  ('c12ddce0-fd21-59d0-b2e4-df19852756fc', 'regulatory_profile', 'Regulatory Profile', 'Minimal V1 shell: whether the business operates under a specific regulatory regime.', 1, 'ACTIVE')
on conflict (id) do nothing;

insert into taxonomy.nodes (id, vocabulary_id, canonical_code, display_name, description, parent_node_id, depth, status, metadata) values
  ('31a21318-4936-5c6e-9e60-ed6b35c565b6', '9e323247-8a4b-575b-acdc-6f682f0d6a7b', 'financial_services', 'Financial Services', 'Banking, payments, lending, insurance, capital markets and the technology serving them.', null, 0, 'ACTIVE', '{}'::jsonb),
  ('ae108427-4c83-57f3-9bc3-64d193be7e10', '9e323247-8a4b-575b-acdc-6f682f0d6a7b', 'enterprise_software', 'Enterprise Software', 'Software sold to organisations.', null, 0, 'ACTIVE', '{}'::jsonb),
  ('d9c96d92-b1ac-5ce5-8e0b-4ee98f17a66d', '9e323247-8a4b-575b-acdc-6f682f0d6a7b', 'cybersecurity', 'Cybersecurity', null, null, 0, 'ACTIVE', '{}'::jsonb),
  ('e79290bb-1839-5433-b458-669edfd33f1e', '9e323247-8a4b-575b-acdc-6f682f0d6a7b', 'healthcare', 'Healthcare', null, null, 0, 'ACTIVE', '{}'::jsonb),
  ('b168eca8-1a7d-578b-9ef7-3347c764109f', '9e323247-8a4b-575b-acdc-6f682f0d6a7b', 'energy', 'Energy', null, null, 0, 'ACTIVE', '{}'::jsonb),
  ('3a695c5d-dd89-51ba-b7c3-85cb8c8a9b1e', '9e323247-8a4b-575b-acdc-6f682f0d6a7b', 'commerce', 'Commerce & Retail', null, null, 0, 'ACTIVE', '{}'::jsonb),
  ('80801813-93cf-5095-a125-22c4722bb4d2', '9e323247-8a4b-575b-acdc-6f682f0d6a7b', 'logistics', 'Logistics & Mobility', null, null, 0, 'ACTIVE', '{}'::jsonb),
  ('ef538a8a-a7f1-5ffc-bb44-7470166a2178', '9e323247-8a4b-575b-acdc-6f682f0d6a7b', 'agriculture', 'Agriculture', null, null, 0, 'ACTIVE', '{}'::jsonb),
  ('c05dcb83-1647-55c2-9c59-4f3cc40d2afb', '9e323247-8a4b-575b-acdc-6f682f0d6a7b', 'education', 'Education', null, null, 0, 'ACTIVE', '{}'::jsonb),
  ('9e1f884d-701d-55ae-89fe-da85f04d769d', '9e323247-8a4b-575b-acdc-6f682f0d6a7b', 'real_estate', 'Real Estate', null, null, 0, 'ACTIVE', '{}'::jsonb),
  ('e4ee905f-e3c1-5b91-bf48-6fa76d9ddc7e', '9e323247-8a4b-575b-acdc-6f682f0d6a7b', 'media_entertainment', 'Media & Entertainment', null, null, 0, 'ACTIVE', '{}'::jsonb),
  ('78a1b8fe-b224-509f-9991-ddc0fc0fe2d2', '9e323247-8a4b-575b-acdc-6f682f0d6a7b', 'telecommunications', 'Telecommunications', null, null, 0, 'ACTIVE', '{}'::jsonb),
  ('5c8905f5-2c42-5a67-a113-80880309f9ac', '9e323247-8a4b-575b-acdc-6f682f0d6a7b', 'manufacturing', 'Manufacturing & Industrial', null, null, 0, 'ACTIVE', '{}'::jsonb),
  ('c19e285b-2f10-53b6-a1b8-949e5a6bff24', '817328a5-d8a6-561a-aa45-3144d746050b', 'payment_infrastructure', 'Payment Infrastructure', 'Rails, processing and APIs that let others move money.', null, 0, 'ACTIVE', '{}'::jsonb),
  ('610ee7ac-6443-5854-b5cd-3cce4c82ec75', '817328a5-d8a6-561a-aa45-3144d746050b', 'cross_border_payments', 'Cross-Border Payments', null, null, 0, 'ACTIVE', '{}'::jsonb),
  ('4d7d0536-94a3-564f-a672-99694815e9ac', '817328a5-d8a6-561a-aa45-3144d746050b', 'digital_wallet', 'Digital Wallet', null, null, 0, 'ACTIVE', '{}'::jsonb),
  ('c8eb9703-3547-57f7-b908-63fc8ab35868', '817328a5-d8a6-561a-aa45-3144d746050b', 'core_banking_platform', 'Core Banking Platform', null, null, 0, 'ACTIVE', '{}'::jsonb),
  ('243625ca-15bb-5889-8552-c0881d1abf80', '817328a5-d8a6-561a-aa45-3144d746050b', 'lending_platform', 'Lending Platform', null, null, 0, 'ACTIVE', '{}'::jsonb),
  ('c7d5cb81-9017-5e07-970d-841fd94f30c3', '817328a5-d8a6-561a-aa45-3144d746050b', 'embedded_finance', 'Embedded Finance', null, null, 0, 'ACTIVE', '{}'::jsonb),
  ('74b0ce65-9425-5c90-9bf8-b986101f4b9c', '817328a5-d8a6-561a-aa45-3144d746050b', 'claims_automation', 'Claims Automation', null, null, 0, 'ACTIVE', '{}'::jsonb),
  ('79772fa4-2ac9-5503-8a86-02322ed78f3d', '817328a5-d8a6-561a-aa45-3144d746050b', 'insurance_distribution', 'Insurance Distribution', null, null, 0, 'ACTIVE', '{}'::jsonb),
  ('1565078a-f861-5ac1-bf72-1707d3641f70', '817328a5-d8a6-561a-aa45-3144d746050b', 'developer_api', 'Developer API', 'An API sold to developers and businesses as the product.', null, 0, 'ACTIVE', '{}'::jsonb),
  ('65f8bb2b-9ce2-5f31-9391-7841534c8d12', '817328a5-d8a6-561a-aa45-3144d746050b', 'identity_verification', 'Identity Verification', null, null, 0, 'ACTIVE', '{}'::jsonb),
  ('7b700e39-c915-5e2f-9822-95a12fb90fb9', '817328a5-d8a6-561a-aa45-3144d746050b', 'fraud_detection', 'Fraud Detection', null, null, 0, 'ACTIVE', '{}'::jsonb),
  ('47830cf5-83d0-5c9c-a202-46aa49820745', '817328a5-d8a6-561a-aa45-3144d746050b', 'data_analytics_platform', 'Data & Analytics Platform', null, null, 0, 'ACTIVE', '{}'::jsonb),
  ('380cc839-7e70-507b-877e-9f5a55f9c350', '817328a5-d8a6-561a-aa45-3144d746050b', 'marketplace', 'Marketplace', null, null, 0, 'ACTIVE', '{}'::jsonb),
  ('ad266215-3a3e-51a6-9cc1-5515e9794fe9', '817328a5-d8a6-561a-aa45-3144d746050b', 'workflow_automation', 'Workflow Automation', null, null, 0, 'ACTIVE', '{}'::jsonb),
  ('d37a9bb0-6345-5f2d-83c7-fd12517c8a65', '817328a5-d8a6-561a-aa45-3144d746050b', 'security_platform', 'Security Platform', null, null, 0, 'ACTIVE', '{}'::jsonb),
  ('b74391cc-44f2-5513-b3fa-96f7bbeb8139', '817328a5-d8a6-561a-aa45-3144d746050b', 'telehealth', 'Telehealth', null, null, 0, 'ACTIVE', '{}'::jsonb),
  ('880a225e-e193-58c6-b925-0ea363967a10', '817328a5-d8a6-561a-aa45-3144d746050b', 'health_records', 'Health Records', null, null, 0, 'ACTIVE', '{}'::jsonb),
  ('151fec19-dfa9-5994-b624-5a3e156e4ed2', '817328a5-d8a6-561a-aa45-3144d746050b', 'energy_management', 'Energy Management', null, null, 0, 'ACTIVE', '{}'::jsonb),
  ('439d3f0d-55aa-5330-8f1b-7db3eafcdef4', '817328a5-d8a6-561a-aa45-3144d746050b', 'fleet_management', 'Fleet Management', null, null, 0, 'ACTIVE', '{}'::jsonb),
  ('1e8237f6-09a7-5cac-921f-3a4536145054', '817328a5-d8a6-561a-aa45-3144d746050b', 'learning_platform', 'Learning Platform', null, null, 0, 'ACTIVE', '{}'::jsonb),
  ('e19fb92a-3551-530e-9dd7-3ba19c0e7118', '2bb94def-82b9-5d60-a5fc-d94fe1033faf', 'artificial_intelligence', 'Artificial Intelligence', null, null, 0, 'ACTIVE', '{}'::jsonb),
  ('a8001aec-4070-59a3-b95d-932357457e18', '2bb94def-82b9-5d60-a5fc-d94fe1033faf', 'api_platform', 'API Platform', 'API-first architecture as the core technical approach.', null, 0, 'ACTIVE', '{}'::jsonb),
  ('6bafb4a0-f0bd-530b-a928-9d98ddc86f17', '2bb94def-82b9-5d60-a5fc-d94fe1033faf', 'blockchain', 'Blockchain', null, null, 0, 'ACTIVE', '{}'::jsonb),
  ('b2ec3ad9-c252-5144-907a-e52679bb55b3', '2bb94def-82b9-5d60-a5fc-d94fe1033faf', 'cloud_infrastructure', 'Cloud Infrastructure', null, null, 0, 'ACTIVE', '{}'::jsonb),
  ('bc6b81d4-7f43-5500-a55c-a469225d6e24', '2bb94def-82b9-5d60-a5fc-d94fe1033faf', 'data_infrastructure', 'Data Infrastructure', null, null, 0, 'ACTIVE', '{}'::jsonb),
  ('30ca41d9-e02d-5953-a1d3-4a63ff050d54', '2bb94def-82b9-5d60-a5fc-d94fe1033faf', 'mobile_technology', 'Mobile', null, null, 0, 'ACTIVE', '{}'::jsonb),
  ('4f6583e7-8032-5091-b151-344882b6842e', '2bb94def-82b9-5d60-a5fc-d94fe1033faf', 'internet_of_things', 'Internet of Things', null, null, 0, 'ACTIVE', '{}'::jsonb),
  ('75b839e6-e3ec-5929-90f6-c43e7fa2cd04', '2bb94def-82b9-5d60-a5fc-d94fe1033faf', 'robotics', 'Robotics & Automation', null, null, 0, 'ACTIVE', '{}'::jsonb),
  ('bd076325-84a7-5cd3-be96-a612c21d2030', '2bb94def-82b9-5d60-a5fc-d94fe1033faf', 'hardware', 'Hardware', null, null, 0, 'ACTIVE', '{}'::jsonb),
  ('82aa1770-1df4-592e-9eed-4759c0cf273f', '38a60b83-77b4-5e95-8d35-3195931834f1', 'b2b_saas', 'B2B SaaS', null, null, 0, 'ACTIVE', '{}'::jsonb),
  ('51e98af7-e87e-5324-a38a-d3e990d60605', '38a60b83-77b4-5e95-8d35-3195931834f1', 'b2c_subscription', 'Consumer Subscription', null, null, 0, 'ACTIVE', '{}'::jsonb),
  ('8dfc3dc4-500c-577e-8247-57df0109126c', '38a60b83-77b4-5e95-8d35-3195931834f1', 'transaction_fee', 'Transaction Fee', null, null, 0, 'ACTIVE', '{}'::jsonb),
  ('5b5fd296-e73d-579d-aa32-4059ad8e609f', '38a60b83-77b4-5e95-8d35-3195931834f1', 'marketplace', 'Marketplace', null, null, 0, 'ACTIVE', '{}'::jsonb),
  ('6cc24a99-5036-526b-a5ab-43bd2d54b765', '38a60b83-77b4-5e95-8d35-3195931834f1', 'usage_based', 'Usage-Based Pricing', null, null, 0, 'ACTIVE', '{}'::jsonb),
  ('25120674-4995-5f81-b877-b24bd31db1a5', '38a60b83-77b4-5e95-8d35-3195931834f1', 'licensing', 'Licensing', null, null, 0, 'ACTIVE', '{}'::jsonb),
  ('5ee21858-0ea5-5ef4-87a3-6b17f0f981b5', '38a60b83-77b4-5e95-8d35-3195931834f1', 'hardware_sales', 'Hardware Sales', null, null, 0, 'ACTIVE', '{}'::jsonb),
  ('0650a5d8-543d-5c39-a630-a35262b6cbbd', '38a60b83-77b4-5e95-8d35-3195931834f1', 'advertising', 'Advertising', null, null, 0, 'ACTIVE', '{}'::jsonb),
  ('18e8424e-c1e7-5982-87d3-1613ca544a09', '38a60b83-77b4-5e95-8d35-3195931834f1', 'freemium', 'Freemium', null, null, 0, 'ACTIVE', '{}'::jsonb),
  ('ec381d01-f4f2-51f3-a40e-6784d99c2105', '38a60b83-77b4-5e95-8d35-3195931834f1', 'services', 'Services', null, null, 0, 'ACTIVE', '{}'::jsonb),
  ('0e14ef5a-cc3b-53ac-b7bb-d04858cccbd6', 'f32c294b-60f0-546a-be01-921cd460803a', 'financial_institution', 'Financial Institution', null, null, 0, 'ACTIVE', '{}'::jsonb),
  ('ca22d072-a91a-5ce6-800f-12641b654523', 'f32c294b-60f0-546a-be01-921cd460803a', 'insurance_company', 'Insurance Company', null, null, 0, 'ACTIVE', '{}'::jsonb),
  ('5b5bb026-f5f4-5e56-bed5-0910f014960a', 'f32c294b-60f0-546a-be01-921cd460803a', 'business_customer', 'Business Customer', null, null, 0, 'ACTIVE', '{}'::jsonb),
  ('54875ba5-7877-5276-befc-30e6cfe1996c', 'f32c294b-60f0-546a-be01-921cd460803a', 'consumer', 'Consumer', null, null, 0, 'ACTIVE', '{}'::jsonb),
  ('dae401c9-6c0a-5ecd-91cd-20d6f0c95e30', 'f32c294b-60f0-546a-be01-921cd460803a', 'developer', 'Developer', null, null, 0, 'ACTIVE', '{}'::jsonb),
  ('6411f1f3-0208-5720-a5d7-52cd903be265', 'f32c294b-60f0-546a-be01-921cd460803a', 'government', 'Government & Public Sector', null, null, 0, 'ACTIVE', '{}'::jsonb),
  ('74fccd90-f61f-5770-ab80-2906aef2136c', 'f32c294b-60f0-546a-be01-921cd460803a', 'nonprofit', 'Nonprofit & NGO', null, null, 0, 'ACTIVE', '{}'::jsonb),
  ('df8023ce-2f0e-54fb-b14b-13c400702b34', '581f6374-71d2-5ea3-bb4b-6365d49ed79f', 'pre_seed', 'Pre-seed', null, null, 0, 'ACTIVE', '{}'::jsonb),
  ('46ba7390-b0a0-5da1-97fd-5eddfcbd2fbd', '581f6374-71d2-5ea3-bb4b-6365d49ed79f', 'seed', 'Seed', null, null, 0, 'ACTIVE', '{}'::jsonb),
  ('7a781bf3-c238-57fa-9b67-60b88059b7ae', '581f6374-71d2-5ea3-bb4b-6365d49ed79f', 'series_a', 'Series A', null, null, 0, 'ACTIVE', '{}'::jsonb),
  ('66bbda33-e9f3-5ae4-a811-a4e7e6c7188b', '581f6374-71d2-5ea3-bb4b-6365d49ed79f', 'series_b', 'Series B', null, null, 0, 'ACTIVE', '{}'::jsonb),
  ('9269cbda-b18f-549f-a515-475045f70e3d', '581f6374-71d2-5ea3-bb4b-6365d49ed79f', 'series_c_plus', 'Series C or later', null, null, 0, 'ACTIVE', '{}'::jsonb),
  ('6dc7d6fa-ecf9-5c7e-84a8-fe18b594ae60', '512652ee-b4a7-519f-ae12-9db2b1607ee2', 'global', 'Global', 'No geographic restriction.', null, 0, 'ACTIVE', '{}'::jsonb),
  ('6d6366e0-bbb2-5a32-bad8-c747ca550c70', '512652ee-b4a7-519f-ae12-9db2b1607ee2', 'africa', 'Africa', null, null, 0, 'ACTIVE', '{}'::jsonb),
  ('b6869c9c-b25c-5a8b-a1f1-38c2d3a5a994', '512652ee-b4a7-519f-ae12-9db2b1607ee2', 'europe', 'Europe', null, null, 0, 'ACTIVE', '{}'::jsonb),
  ('0881afcc-9c3b-58f1-a3d7-ef36a69122d0', '512652ee-b4a7-519f-ae12-9db2b1607ee2', 'north_america', 'North America', null, null, 0, 'ACTIVE', '{}'::jsonb),
  ('844584db-20ed-5274-973c-4c23e55e61d1', '512652ee-b4a7-519f-ae12-9db2b1607ee2', 'middle_east', 'Middle East', null, null, 0, 'ACTIVE', '{}'::jsonb),
  ('15494414-7ef7-5a7f-9374-c1e5f13c40d1', '512652ee-b4a7-519f-ae12-9db2b1607ee2', 'asia', 'Asia', null, null, 0, 'ACTIVE', '{}'::jsonb),
  ('30c50ebe-7a16-5bf1-95af-13f9049b0fd4', '512652ee-b4a7-519f-ae12-9db2b1607ee2', 'latin_america', 'Latin America', null, null, 0, 'ACTIVE', '{}'::jsonb),
  ('f231ebf4-b549-5c87-87d1-8a1a99c648b4', 'a5a8681e-7d96-5c76-af7c-031dd10c2556', 'financial_inclusion', 'Financial Inclusion', null, null, 0, 'ACTIVE', '{}'::jsonb),
  ('92f962fb-7189-5917-9cd7-cc584ffa4931', 'a5a8681e-7d96-5c76-af7c-031dd10c2556', 'climate', 'Climate & Sustainability', null, null, 0, 'ACTIVE', '{}'::jsonb),
  ('caf102db-3bf3-518c-a6e3-b3b28c6c6a22', 'a5a8681e-7d96-5c76-af7c-031dd10c2556', 'health_access', 'Health Access', null, null, 0, 'ACTIVE', '{}'::jsonb),
  ('1de6dee7-bfa4-56f9-95b3-69c84020c35e', 'a5a8681e-7d96-5c76-af7c-031dd10c2556', 'economic_opportunity', 'Jobs & Economic Opportunity', null, null, 0, 'ACTIVE', '{}'::jsonb),
  ('34ac5dc7-5ab0-5797-823a-f4f20575865f', 'c12ddce0-fd21-59d0-b2e4-df19852756fc', 'regulated_financial_services', 'Regulated Financial Services', null, null, 0, 'ACTIVE', '{}'::jsonb),
  ('ca53276e-2a14-5e62-bf0f-121e65dc9c09', 'c12ddce0-fd21-59d0-b2e4-df19852756fc', 'regulated_healthcare', 'Regulated Healthcare', null, null, 0, 'ACTIVE', '{}'::jsonb),
  ('7a2ca566-7458-5ca7-bb6a-d52c7108bcb3', 'c12ddce0-fd21-59d0-b2e4-df19852756fc', 'data_protection_sensitive', 'Data-Protection Sensitive', null, null, 0, 'ACTIVE', '{}'::jsonb),
  ('b2c9a445-e45c-5375-8bd9-75c032e2e1ed', 'c12ddce0-fd21-59d0-b2e4-df19852756fc', 'not_specifically_regulated', 'Not Specifically Regulated', null, null, 0, 'ACTIVE', '{}'::jsonb),
  ('eacf7107-9af3-5b76-91a2-3c169e396347', '9e323247-8a4b-575b-acdc-6f682f0d6a7b', 'fintech', 'Fintech', null, '31a21318-4936-5c6e-9e60-ed6b35c565b6', 1, 'ACTIVE', '{}'::jsonb),
  ('dfcf9a70-f561-5411-bc2e-3cd3b2606425', '9e323247-8a4b-575b-acdc-6f682f0d6a7b', 'banking', 'Banking', null, '31a21318-4936-5c6e-9e60-ed6b35c565b6', 1, 'ACTIVE', '{}'::jsonb),
  ('69692abb-4469-5707-96c0-f64e0df58363', '9e323247-8a4b-575b-acdc-6f682f0d6a7b', 'insurance', 'Insurance', null, '31a21318-4936-5c6e-9e60-ed6b35c565b6', 1, 'ACTIVE', '{}'::jsonb),
  ('e99726b4-6d0d-547c-b69e-6d16270f1d85', '9e323247-8a4b-575b-acdc-6f682f0d6a7b', 'capital_markets', 'Capital Markets', null, '31a21318-4936-5c6e-9e60-ed6b35c565b6', 1, 'ACTIVE', '{}'::jsonb),
  ('62ff431a-5488-537e-a6dc-9bfe272a0ce7', '9e323247-8a4b-575b-acdc-6f682f0d6a7b', 'developer_tools', 'Developer Tools', null, 'ae108427-4c83-57f3-9bc3-64d193be7e10', 1, 'ACTIVE', '{}'::jsonb),
  ('70c50024-cb99-5ac2-a238-ac3f5e9c0a41', '9e323247-8a4b-575b-acdc-6f682f0d6a7b', 'data_infrastructure', 'Data Infrastructure', null, 'ae108427-4c83-57f3-9bc3-64d193be7e10', 1, 'ACTIVE', '{}'::jsonb),
  ('01617432-aa2b-5c0b-9b1e-c6cafeb7447a', '9e323247-8a4b-575b-acdc-6f682f0d6a7b', 'hr_technology', 'HR Technology', null, 'ae108427-4c83-57f3-9bc3-64d193be7e10', 1, 'ACTIVE', '{}'::jsonb),
  ('a45b63ab-2d5e-5b0b-9c7a-fcc5d43efa1f', '9e323247-8a4b-575b-acdc-6f682f0d6a7b', 'identity_security', 'Identity & Access', null, 'd9c96d92-b1ac-5ce5-8e0b-4ee98f17a66d', 1, 'ACTIVE', '{}'::jsonb),
  ('7c953fc5-a6bc-5014-afef-068150e5209a', '9e323247-8a4b-575b-acdc-6f682f0d6a7b', 'digital_health', 'Digital Health', null, 'e79290bb-1839-5433-b458-669edfd33f1e', 1, 'ACTIVE', '{}'::jsonb),
  ('85814359-8154-5e8e-9042-23d4a4bd4129', '9e323247-8a4b-575b-acdc-6f682f0d6a7b', 'medical_devices', 'Medical Devices', null, 'e79290bb-1839-5433-b458-669edfd33f1e', 1, 'ACTIVE', '{}'::jsonb),
  ('ca840647-6683-5868-a394-f9cae40d48cf', '9e323247-8a4b-575b-acdc-6f682f0d6a7b', 'clean_energy', 'Clean Energy', null, 'b168eca8-1a7d-578b-9ef7-3347c764109f', 1, 'ACTIVE', '{}'::jsonb),
  ('2c53ab2e-cbb4-59b7-ad91-905019a51a51', '9e323247-8a4b-575b-acdc-6f682f0d6a7b', 'energy_access', 'Energy Access', null, 'b168eca8-1a7d-578b-9ef7-3347c764109f', 1, 'ACTIVE', '{}'::jsonb),
  ('a9df2ad4-26b8-5ae9-ac92-058daa41825d', '9e323247-8a4b-575b-acdc-6f682f0d6a7b', 'ecommerce', 'E-commerce', null, '3a695c5d-dd89-51ba-b7c3-85cb8c8a9b1e', 1, 'ACTIVE', '{}'::jsonb),
  ('9e49a9a7-bcf5-588e-a234-c52464dffc28', '9e323247-8a4b-575b-acdc-6f682f0d6a7b', 'retail_technology', 'Retail Technology', null, '3a695c5d-dd89-51ba-b7c3-85cb8c8a9b1e', 1, 'ACTIVE', '{}'::jsonb),
  ('6044921c-fab6-5677-b7ad-525fb8586191', '9e323247-8a4b-575b-acdc-6f682f0d6a7b', 'supply_chain', 'Supply Chain', null, '80801813-93cf-5095-a125-22c4722bb4d2', 1, 'ACTIVE', '{}'::jsonb),
  ('dc23ce53-c0f3-580d-8a8a-963eb9ce226e', '9e323247-8a4b-575b-acdc-6f682f0d6a7b', 'mobility', 'Mobility & Transport', null, '80801813-93cf-5095-a125-22c4722bb4d2', 1, 'ACTIVE', '{}'::jsonb),
  ('f55aa977-7ef2-5f72-8c7d-5ae631350758', '9e323247-8a4b-575b-acdc-6f682f0d6a7b', 'agritech', 'Agritech', null, 'ef538a8a-a7f1-5ffc-bb44-7470166a2178', 1, 'ACTIVE', '{}'::jsonb),
  ('9310be8b-6445-5982-bcde-5e5dd64295b1', '9e323247-8a4b-575b-acdc-6f682f0d6a7b', 'edtech', 'Edtech', null, 'c05dcb83-1647-55c2-9c59-4f3cc40d2afb', 1, 'ACTIVE', '{}'::jsonb),
  ('75d7788e-8224-529f-a36d-d130cec387e9', '9e323247-8a4b-575b-acdc-6f682f0d6a7b', 'proptech', 'Proptech', null, '9e1f884d-701d-55ae-89fe-da85f04d769d', 1, 'ACTIVE', '{}'::jsonb),
  ('a290cd5c-d128-5768-9823-67f3595d9763', '2bb94def-82b9-5d60-a5fc-d94fe1033faf', 'machine_learning', 'Machine Learning', null, 'e19fb92a-3551-530e-9dd7-3ba19c0e7118', 1, 'ACTIVE', '{}'::jsonb),
  ('780b2683-c34d-521e-a1a1-4f3fa0e5879b', '2bb94def-82b9-5d60-a5fc-d94fe1033faf', 'natural_language_processing', 'Natural Language Processing', null, 'e19fb92a-3551-530e-9dd7-3ba19c0e7118', 1, 'ACTIVE', '{}'::jsonb),
  ('37690be0-e0ea-51b0-acbb-4e409f1a8113', '2bb94def-82b9-5d60-a5fc-d94fe1033faf', 'computer_vision', 'Computer Vision', null, 'e19fb92a-3551-530e-9dd7-3ba19c0e7118', 1, 'ACTIVE', '{}'::jsonb),
  ('a5ed8311-208b-5bf4-bd93-eb1bf6b228ec', 'f32c294b-60f0-546a-be01-921cd460803a', 'small_business', 'Small & Medium Business', null, '5b5bb026-f5f4-5e56-bed5-0910f014960a', 1, 'ACTIVE', '{}'::jsonb),
  ('d5efd8f6-7f2a-55f5-865e-758a44e051a0', 'f32c294b-60f0-546a-be01-921cd460803a', 'mid_market', 'Mid-Market', null, '5b5bb026-f5f4-5e56-bed5-0910f014960a', 1, 'ACTIVE', '{}'::jsonb),
  ('d458f353-52bf-5884-b43e-c3a9a1dd2202', 'f32c294b-60f0-546a-be01-921cd460803a', 'enterprise', 'Enterprise', null, '5b5bb026-f5f4-5e56-bed5-0910f014960a', 1, 'ACTIVE', '{}'::jsonb),
  ('62454c41-a4a2-547c-b7a1-d1d10460ce4f', '512652ee-b4a7-519f-ae12-9db2b1607ee2', 'west_africa', 'West Africa', null, '6d6366e0-bbb2-5a32-bad8-c747ca550c70', 1, 'ACTIVE', '{}'::jsonb),
  ('0fae2aa7-cceb-5cb1-b1fa-9a5fa5788164', '512652ee-b4a7-519f-ae12-9db2b1607ee2', 'east_africa', 'East Africa', null, '6d6366e0-bbb2-5a32-bad8-c747ca550c70', 1, 'ACTIVE', '{}'::jsonb),
  ('8c932bde-ecea-5b7c-88b1-058e09a45fb5', '512652ee-b4a7-519f-ae12-9db2b1607ee2', 'southern_africa', 'Southern Africa', null, '6d6366e0-bbb2-5a32-bad8-c747ca550c70', 1, 'ACTIVE', '{}'::jsonb),
  ('7e13b907-f267-5903-ac16-27910d44a0fb', '512652ee-b4a7-519f-ae12-9db2b1607ee2', 'north_africa', 'North Africa', null, '6d6366e0-bbb2-5a32-bad8-c747ca550c70', 1, 'ACTIVE', '{}'::jsonb),
  ('ccace354-1437-5fb0-a46f-2c6f11ff21cf', '512652ee-b4a7-519f-ae12-9db2b1607ee2', 'united_kingdom', 'United Kingdom', null, 'b6869c9c-b25c-5a8b-a1f1-38c2d3a5a994', 1, 'ACTIVE', '{"iso3166Alpha2":"GB"}'::jsonb),
  ('2e3343e1-911c-5806-a020-b0be335cc55b', '512652ee-b4a7-519f-ae12-9db2b1607ee2', 'germany', 'Germany', null, 'b6869c9c-b25c-5a8b-a1f1-38c2d3a5a994', 1, 'ACTIVE', '{"iso3166Alpha2":"DE"}'::jsonb),
  ('a9349fc5-5ebc-56c4-8bbd-36f3415a7209', '512652ee-b4a7-519f-ae12-9db2b1607ee2', 'france', 'France', null, 'b6869c9c-b25c-5a8b-a1f1-38c2d3a5a994', 1, 'ACTIVE', '{"iso3166Alpha2":"FR"}'::jsonb),
  ('20dc8cd8-bb51-517f-8fe0-1f6264e51a3b', '512652ee-b4a7-519f-ae12-9db2b1607ee2', 'netherlands', 'Netherlands', null, 'b6869c9c-b25c-5a8b-a1f1-38c2d3a5a994', 1, 'ACTIVE', '{"iso3166Alpha2":"NL"}'::jsonb),
  ('6511206c-6b77-5172-9e1b-ac0eca583611', '512652ee-b4a7-519f-ae12-9db2b1607ee2', 'united_states', 'United States', null, '0881afcc-9c3b-58f1-a3d7-ef36a69122d0', 1, 'ACTIVE', '{"iso3166Alpha2":"US"}'::jsonb),
  ('fbad1397-3452-5040-8149-0a6655282160', '512652ee-b4a7-519f-ae12-9db2b1607ee2', 'canada', 'Canada', null, '0881afcc-9c3b-58f1-a3d7-ef36a69122d0', 1, 'ACTIVE', '{"iso3166Alpha2":"CA"}'::jsonb),
  ('2593e271-7b16-575d-8650-5e35054df867', '512652ee-b4a7-519f-ae12-9db2b1607ee2', 'united_arab_emirates', 'United Arab Emirates', null, '844584db-20ed-5274-973c-4c23e55e61d1', 1, 'ACTIVE', '{"iso3166Alpha2":"AE"}'::jsonb),
  ('57b96b49-499c-5192-be13-0ed9a66a60a3', '512652ee-b4a7-519f-ae12-9db2b1607ee2', 'india', 'India', null, '15494414-7ef7-5a7f-9374-c1e5f13c40d1', 1, 'ACTIVE', '{"iso3166Alpha2":"IN"}'::jsonb),
  ('6180c1da-6483-57d0-be9c-e0520955c003', '512652ee-b4a7-519f-ae12-9db2b1607ee2', 'singapore', 'Singapore', null, '15494414-7ef7-5a7f-9374-c1e5f13c40d1', 1, 'ACTIVE', '{"iso3166Alpha2":"SG"}'::jsonb),
  ('e238cbcc-0cca-5af1-9a31-ee85f05cfcab', '512652ee-b4a7-519f-ae12-9db2b1607ee2', 'brazil', 'Brazil', null, '30c50ebe-7a16-5bf1-95af-13f9049b0fd4', 1, 'ACTIVE', '{"iso3166Alpha2":"BR"}'::jsonb),
  ('be80ab01-de8e-524e-86ed-d41ddb88ca7f', '9e323247-8a4b-575b-acdc-6f682f0d6a7b', 'payments', 'Payments', null, 'eacf7107-9af3-5b76-91a2-3c169e396347', 2, 'ACTIVE', '{}'::jsonb),
  ('42b2adae-e35f-5287-be9e-63aef0ffe836', '9e323247-8a4b-575b-acdc-6f682f0d6a7b', 'digital_lending', 'Digital Lending', null, 'eacf7107-9af3-5b76-91a2-3c169e396347', 2, 'ACTIVE', '{}'::jsonb),
  ('e4a41095-e6a9-5a95-8f67-31a0bf97ec68', '9e323247-8a4b-575b-acdc-6f682f0d6a7b', 'digital_banking', 'Digital Banking', null, 'eacf7107-9af3-5b76-91a2-3c169e396347', 2, 'ACTIVE', '{}'::jsonb),
  ('52c78303-e5c9-5b6a-90ac-aa500aff09fd', '9e323247-8a4b-575b-acdc-6f682f0d6a7b', 'wealthtech', 'Wealthtech', null, 'eacf7107-9af3-5b76-91a2-3c169e396347', 2, 'ACTIVE', '{}'::jsonb),
  ('24130b91-09d3-5282-82ee-5117e41eed50', '9e323247-8a4b-575b-acdc-6f682f0d6a7b', 'insurtech', 'Insurtech', null, 'eacf7107-9af3-5b76-91a2-3c169e396347', 2, 'ACTIVE', '{}'::jsonb),
  ('726b635e-ae4a-563a-a0bb-d1a1621e8dd3', '512652ee-b4a7-519f-ae12-9db2b1607ee2', 'nigeria', 'Nigeria', null, '62454c41-a4a2-547c-b7a1-d1d10460ce4f', 2, 'ACTIVE', '{"iso3166Alpha2":"NG"}'::jsonb),
  ('e602c303-729f-5df2-8a11-0bed1f8668ea', '512652ee-b4a7-519f-ae12-9db2b1607ee2', 'ghana', 'Ghana', null, '62454c41-a4a2-547c-b7a1-d1d10460ce4f', 2, 'ACTIVE', '{"iso3166Alpha2":"GH"}'::jsonb),
  ('4abdaf9a-237f-5aa0-955c-f00717931597', '512652ee-b4a7-519f-ae12-9db2b1607ee2', 'kenya', 'Kenya', null, '0fae2aa7-cceb-5cb1-b1fa-9a5fa5788164', 2, 'ACTIVE', '{"iso3166Alpha2":"KE"}'::jsonb),
  ('35deea15-3a55-58ec-9ef9-1a991c392611', '512652ee-b4a7-519f-ae12-9db2b1607ee2', 'south_africa', 'South Africa', null, '8c932bde-ecea-5b7c-88b1-058e09a45fb5', 2, 'ACTIVE', '{"iso3166Alpha2":"ZA"}'::jsonb),
  ('5f8eb635-f79f-5deb-9896-6409c9fd4fb6', '512652ee-b4a7-519f-ae12-9db2b1607ee2', 'egypt', 'Egypt', null, '7e13b907-f267-5903-ac16-27910d44a0fb', 2, 'ACTIVE', '{"iso3166Alpha2":"EG"}'::jsonb),
  ('2bb85b49-88d6-5a95-8327-55d2dadb46f2', '9e323247-8a4b-575b-acdc-6f682f0d6a7b', 'payment_infrastructure', 'Payment Infrastructure', 'Rails, processing and APIs other businesses build payments on.', 'be80ab01-de8e-524e-86ed-d41ddb88ca7f', 3, 'ACTIVE', '{}'::jsonb),
  ('68674e37-1801-533d-97e3-0bb0ae01f311', '9e323247-8a4b-575b-acdc-6f682f0d6a7b', 'merchant_payments', 'Merchant Payments', null, 'be80ab01-de8e-524e-86ed-d41ddb88ca7f', 3, 'ACTIVE', '{}'::jsonb),
  ('ce7fe6a0-21de-50ff-80ee-946ac6c0dc27', '9e323247-8a4b-575b-acdc-6f682f0d6a7b', 'cross_border_payments', 'Cross-Border Payments', null, 'be80ab01-de8e-524e-86ed-d41ddb88ca7f', 3, 'ACTIVE', '{}'::jsonb),
  ('6f9743fd-b2ad-5e4a-9151-8c8eabfe0fd3', '9e323247-8a4b-575b-acdc-6f682f0d6a7b', 'embedded_payments', 'Embedded Payments', null, 'be80ab01-de8e-524e-86ed-d41ddb88ca7f', 3, 'ACTIVE', '{}'::jsonb)
on conflict (id) do nothing;

insert into taxonomy.aliases (id, node_id, alias, locale, alias_type, normalized_alias) values
  ('9bee6cf3-89cd-5840-80b1-11d861f2795d', 'eacf7107-9af3-5b76-91a2-3c169e396347', 'financial technology', 'en', 'SYNONYM', 'financial technology'),
  ('1f47e454-5c95-574d-92df-fa36a56692bf', 'be80ab01-de8e-524e-86ed-d41ddb88ca7f', 'payment services', 'en', 'SYNONYM', 'payment services'),
  ('ee8d8bb1-72c1-5b6b-b15b-82e796e75b1a', '2bb85b49-88d6-5a95-8327-55d2dadb46f2', 'payments rails', 'en', 'SYNONYM', 'payments rails'),
  ('0e25e76a-99fd-5f6b-a2e4-9317c4067ff3', '2bb85b49-88d6-5a95-8327-55d2dadb46f2', 'payment rails', 'en', 'SYNONYM', 'payment rails'),
  ('4ddbc397-b252-5ac8-bd35-1b4f3157eced', '2bb85b49-88d6-5a95-8327-55d2dadb46f2', 'fintech infra', 'en', 'SYNONYM', 'fintech infra'),
  ('4b42fbac-33ba-522a-a557-d92a78b8f9b8', '2bb85b49-88d6-5a95-8327-55d2dadb46f2', 'financial infrastructure', 'en', 'SYNONYM', 'financial infrastructure'),
  ('eee9b3aa-2adb-5ddc-82ec-795787c61534', '68674e37-1801-533d-97e3-0bb0ae01f311', 'merchant acquiring', 'en', 'SYNONYM', 'merchant acquiring'),
  ('646e2d07-dcc1-5c72-98ed-887d1d219ae7', '68674e37-1801-533d-97e3-0bb0ae01f311', 'point of sale payments', 'en', 'SYNONYM', 'point of sale payments'),
  ('d6f51976-311d-5984-8d2b-9397f43576db', 'ce7fe6a0-21de-50ff-80ee-946ac6c0dc27', 'remittances', 'en', 'SYNONYM', 'remittances'),
  ('fb661517-8003-5af8-b39c-9e11fd8caef1', 'ce7fe6a0-21de-50ff-80ee-946ac6c0dc27', 'international payments', 'en', 'SYNONYM', 'international payments'),
  ('be8e5d10-f22e-550d-a20a-154a71d129c0', '42b2adae-e35f-5287-be9e-63aef0ffe836', 'lending', 'en', 'SYNONYM', 'lending'),
  ('d9b4990f-2303-5d7b-b5ba-da921c5bd351', '42b2adae-e35f-5287-be9e-63aef0ffe836', 'credit tech', 'en', 'SYNONYM', 'credit tech'),
  ('94c3ae66-b8b1-5089-96dd-39f8eb1dcedf', 'e4a41095-e6a9-5a95-8f67-31a0bf97ec68', 'neobank', 'en', 'SYNONYM', 'neobank'),
  ('98ef9f59-590c-5270-95c3-6f8dc31919bf', 'e4a41095-e6a9-5a95-8f67-31a0bf97ec68', 'challenger bank', 'en', 'SYNONYM', 'challenger bank'),
  ('478b487a-e907-5b35-b882-39a3c8b21860', '52c78303-e5c9-5b6a-90ac-aa500aff09fd', 'wealth management technology', 'en', 'SYNONYM', 'wealth management technology'),
  ('306d4b13-9b7b-539a-8513-2baf64b491fe', '24130b91-09d3-5282-82ee-5117e41eed50', 'insurance technology', 'en', 'SYNONYM', 'insurance technology'),
  ('82842d42-3f74-5a2c-822c-bb5a4d23ade7', '24130b91-09d3-5282-82ee-5117e41eed50', 'insurance tech', 'en', 'SYNONYM', 'insurance tech'),
  ('744fb330-8f19-5307-8ddf-6ba4e18bfac3', 'ae108427-4c83-57f3-9bc3-64d193be7e10', 'b2b software', 'en', 'SYNONYM', 'b2b software'),
  ('1df5e3b5-24a1-53fb-8fef-4d3dd090cc6d', '62ff431a-5488-537e-a6dc-9bfe272a0ce7', 'devtools', 'en', 'SYNONYM', 'devtools'),
  ('43966b8f-7354-55c6-b4bb-ff986fa9c7cc', '70c50024-cb99-5ac2-a238-ac3f5e9c0a41', 'ai & data infrastructure', 'en', 'SYNONYM', 'ai & data infrastructure'),
  ('d1fce8e0-ba8d-51e6-b779-43e3d17f34f3', '70c50024-cb99-5ac2-a238-ac3f5e9c0a41', 'data platforms', 'en', 'SYNONYM', 'data platforms'),
  ('a807af13-653d-5b6f-9cd2-83a0d9e48871', '01617432-aa2b-5c0b-9b1e-c6cafeb7447a', 'hrtech', 'en', 'SYNONYM', 'hrtech'),
  ('f0f21560-03aa-55c4-a802-af5549300ab4', 'd9c96d92-b1ac-5ce5-8e0b-4ee98f17a66d', 'cyber security', 'en', 'SYNONYM', 'cyber security'),
  ('47ea2c88-5274-5a15-bfcc-efe295197311', 'd9c96d92-b1ac-5ce5-8e0b-4ee98f17a66d', 'infosec', 'en', 'SYNONYM', 'infosec'),
  ('ccc62b80-1d1c-5015-a989-8924ae8ca047', 'd9c96d92-b1ac-5ce5-8e0b-4ee98f17a66d', 'information security', 'en', 'SYNONYM', 'information security'),
  ('d4683ee3-0571-54d8-a8d4-206892ecd799', 'a45b63ab-2d5e-5b0b-9c7a-fcc5d43efa1f', 'identity infrastructure', 'en', 'SYNONYM', 'identity infrastructure'),
  ('8cbb4f03-7df2-5728-b527-9b6923df9273', 'a45b63ab-2d5e-5b0b-9c7a-fcc5d43efa1f', 'iam', 'en', 'SYNONYM', 'iam'),
  ('8328f643-2ad0-5741-a2f5-5a4176b83a3c', '7c953fc5-a6bc-5014-afef-068150e5209a', 'healthtech', 'en', 'SYNONYM', 'healthtech'),
  ('3ea3e7b0-104e-53a6-9220-e8be58a32669', '7c953fc5-a6bc-5014-afef-068150e5209a', 'health tech', 'en', 'SYNONYM', 'health tech'),
  ('d422366c-6872-5598-ab90-8312a6bff8be', 'ca840647-6683-5868-a394-f9cae40d48cf', 'renewables', 'en', 'SYNONYM', 'renewables'),
  ('836e1ece-2a55-5cbe-bb9f-049c619c0456', 'ca840647-6683-5868-a394-f9cae40d48cf', 'renewable energy', 'en', 'SYNONYM', 'renewable energy'),
  ('5850edf5-6aa4-5164-b580-d5de72bb4d0a', 'ca840647-6683-5868-a394-f9cae40d48cf', 'cleantech', 'en', 'SYNONYM', 'cleantech'),
  ('08ead887-688e-5543-9fe0-4e2540dbb84f', '2c53ab2e-cbb4-59b7-ad91-905019a51a51', 'off-grid energy', 'en', 'SYNONYM', 'off-grid energy'),
  ('ea91a515-54b2-50ac-9a51-4cfed68021f5', 'a9df2ad4-26b8-5ae9-ac92-058daa41825d', 'e commerce', 'en', 'SYNONYM', 'e commerce'),
  ('7af0d2b7-7d83-54cc-904f-0a7cf5dbed54', 'a9df2ad4-26b8-5ae9-ac92-058daa41825d', 'online retail', 'en', 'SYNONYM', 'online retail'),
  ('ebe1f2fc-ebc3-5375-858a-74cf185cc976', '6044921c-fab6-5677-b7ad-525fb8586191', 'supply chain technology', 'en', 'SYNONYM', 'supply chain technology'),
  ('de7a69f0-ff49-53c6-928d-bdfab861a7fa', 'f55aa977-7ef2-5f72-8c7d-5ae631350758', 'agtech', 'en', 'SYNONYM', 'agtech'),
  ('f06a8ef2-b4c8-5698-9341-1b2f6cdaab7c', '9310be8b-6445-5982-bcde-5e5dd64295b1', 'education technology', 'en', 'SYNONYM', 'education technology'),
  ('0ef39aa4-96b7-5865-a964-1de36f06bcab', '78a1b8fe-b224-509f-9991-ddc0fc0fe2d2', 'telecoms', 'en', 'SYNONYM', 'telecoms'),
  ('337fa77f-2b6f-5280-969e-965f766bf1c9', '78a1b8fe-b224-509f-9991-ddc0fc0fe2d2', 'telco', 'en', 'SYNONYM', 'telco'),
  ('92570450-7eb4-524b-99fb-a32b02da6d9b', 'c19e285b-2f10-53b6-a1b8-949e5a6bff24', 'payments rails', 'en', 'SYNONYM', 'payments rails'),
  ('e525869a-f915-5864-9a3c-3aa0b54df293', 'c19e285b-2f10-53b6-a1b8-949e5a6bff24', 'b2b payment apis', 'en', 'SYNONYM', 'b2b payment apis'),
  ('c5af8047-4d7d-5b1d-86a2-f06967b1411e', 'c19e285b-2f10-53b6-a1b8-949e5a6bff24', 'payment apis', 'en', 'SYNONYM', 'payment apis'),
  ('3d7973a6-0d76-5beb-87fb-60578e77621c', '4d7d0536-94a3-564f-a672-99694815e9ac', 'mobile money', 'en', 'SYNONYM', 'mobile money'),
  ('8b247764-810c-5a85-b1ce-f2ad89abe335', '4d7d0536-94a3-564f-a672-99694815e9ac', 'e-wallet', 'en', 'SYNONYM', 'e-wallet'),
  ('779429af-1ded-58f3-a35c-808d961e5cc1', '4d7d0536-94a3-564f-a672-99694815e9ac', 'mobile wallet', 'en', 'SYNONYM', 'mobile wallet'),
  ('bbc85292-6a82-568a-8f07-17986a4a680b', 'c8eb9703-3547-57f7-b908-63fc8ab35868', 'core banking', 'en', 'SYNONYM', 'core banking'),
  ('a37f2964-7b56-555d-9a62-3ee9f746d649', '243625ca-15bb-5889-8552-c0881d1abf80', 'loan origination', 'en', 'SYNONYM', 'loan origination'),
  ('bace1618-fed1-5bdb-b2fc-34b28660bdee', 'c7d5cb81-9017-5e07-970d-841fd94f30c3', 'banking as a service', 'en', 'SYNONYM', 'banking as a service'),
  ('929b4445-eca2-5eb7-b1fb-5b565d7d7264', 'c7d5cb81-9017-5e07-970d-841fd94f30c3', 'baas', 'en', 'SYNONYM', 'baas'),
  ('f31a709b-8804-5f82-a92d-f2e42d2dc538', '74b0ce65-9425-5c90-9bf8-b986101f4b9c', 'claims processing automation', 'en', 'SYNONYM', 'claims processing automation'),
  ('e4dd763a-f9da-51be-8026-6f858c431b81', '74b0ce65-9425-5c90-9bf8-b986101f4b9c', 'automated claims', 'en', 'SYNONYM', 'automated claims'),
  ('a50ca357-9287-53b2-b81f-43448d41307b', '1565078a-f861-5ac1-bf72-1707d3641f70', 'api product', 'en', 'SYNONYM', 'api product'),
  ('297bbd85-a3b9-50ca-8d02-3c1b87d35be8', '1565078a-f861-5ac1-bf72-1707d3641f70', 'developer platform', 'en', 'SYNONYM', 'developer platform'),
  ('57e47d0a-9a6a-52ba-8ea0-c1bd60f09d4c', '1565078a-f861-5ac1-bf72-1707d3641f70', 'api infrastructure', 'en', 'SYNONYM', 'api infrastructure'),
  ('cebc14ce-e485-5251-8a10-e45735b0d8fc', '65f8bb2b-9ce2-5f31-9391-7841534c8d12', 'kyc', 'en', 'SYNONYM', 'kyc'),
  ('e57f7c23-f8d6-54b7-bb0b-2d378b74372a', '65f8bb2b-9ce2-5f31-9391-7841534c8d12', 'know your customer', 'en', 'SYNONYM', 'know your customer'),
  ('184458e9-532f-536b-ac3c-217c3f111112', '7b700e39-c915-5e2f-9822-95a12fb90fb9', 'fraud prevention', 'en', 'SYNONYM', 'fraud prevention'),
  ('e4840d4b-6a6c-532e-9c4f-c4818ed99bc6', '47830cf5-83d0-5c9c-a202-46aa49820745', 'analytics platform', 'en', 'SYNONYM', 'analytics platform'),
  ('35bf93d5-0229-5b9b-bc5e-5af27b400c87', 'b74391cc-44f2-5513-b3fa-96f7bbeb8139', 'telemedicine', 'en', 'SYNONYM', 'telemedicine'),
  ('84424725-edaf-5786-b981-3981cb29fc5d', '880a225e-e193-58c6-b925-0ea363967a10', 'electronic health records', 'en', 'SYNONYM', 'electronic health records'),
  ('afd9516d-f498-523e-a527-5e395c096b24', '880a225e-e193-58c6-b925-0ea363967a10', 'ehr', 'en', 'SYNONYM', 'ehr'),
  ('c1bf54dd-a717-5c2c-83b0-98bd1c64dbf4', 'e19fb92a-3551-530e-9dd7-3ba19c0e7118', 'ai', 'en', 'SYNONYM', 'ai'),
  ('e6c77cde-970d-583c-bf38-d0103c33173e', 'e19fb92a-3551-530e-9dd7-3ba19c0e7118', 'ai/ml', 'en', 'SYNONYM', 'ai/ml'),
  ('3edd1cd5-140f-57fe-ac1d-b97fbb11b916', 'e19fb92a-3551-530e-9dd7-3ba19c0e7118', 'artificial intelligence / machine learning', 'en', 'SYNONYM', 'artificial intelligence/machine learning'),
  ('e38fe066-fd6a-5904-98ba-a4f95524ecdc', 'e19fb92a-3551-530e-9dd7-3ba19c0e7118', 'ai-enabled', 'en', 'SYNONYM', 'ai-enabled'),
  ('5fc0d28d-ee1d-5d64-9e2a-898f94c1ea15', 'a290cd5c-d128-5768-9823-67f3595d9763', 'ml', 'en', 'SYNONYM', 'ml'),
  ('f2874ad9-b137-5644-9a19-55c4fd1fcbab', '780b2683-c34d-521e-a1a1-4f3fa0e5879b', 'nlp', 'en', 'SYNONYM', 'nlp'),
  ('2c326efd-3816-52b9-bda1-fc990db9055c', '780b2683-c34d-521e-a1a1-4f3fa0e5879b', 'large language models', 'en', 'SYNONYM', 'large language models'),
  ('a043b765-9051-5dc0-8e15-88954e83ee26', '780b2683-c34d-521e-a1a1-4f3fa0e5879b', 'llm', 'en', 'SYNONYM', 'llm'),
  ('3499a311-24ac-5e28-96d5-e665b43fd0c8', 'a8001aec-4070-59a3-b95d-932357457e18', 'api-first', 'en', 'SYNONYM', 'api-first'),
  ('d6a977cb-1e71-5941-903a-30bc7f8add5b', 'a8001aec-4070-59a3-b95d-932357457e18', 'api infrastructure', 'en', 'SYNONYM', 'api infrastructure'),
  ('586bc668-4ed7-592e-b911-ba95fe1c757d', '6bafb4a0-f0bd-530b-a928-9d98ddc86f17', 'web3', 'en', 'SYNONYM', 'web3'),
  ('289fd0a5-f77e-5e69-bb79-902f4a97ea77', '6bafb4a0-f0bd-530b-a928-9d98ddc86f17', 'distributed ledger', 'en', 'SYNONYM', 'distributed ledger'),
  ('5e8024b0-800c-58c5-87d4-286cbd737d95', '30ca41d9-e02d-5953-a1d3-4a63ff050d54', 'mobile-first', 'en', 'SYNONYM', 'mobile-first'),
  ('9ce8c1bd-450d-5cac-b663-f64a4b42c688', '30ca41d9-e02d-5953-a1d3-4a63ff050d54', 'mobile app', 'en', 'SYNONYM', 'mobile app'),
  ('76f42601-4b1d-5096-b581-f1741ec23bd3', '4f6583e7-8032-5091-b151-344882b6842e', 'iot', 'en', 'SYNONYM', 'iot'),
  ('fde269c4-89ab-57bd-8dbe-eed304377900', '4f6583e7-8032-5091-b151-344882b6842e', 'connected devices', 'en', 'SYNONYM', 'connected devices'),
  ('f438fa95-fe0d-5e2b-b9ed-220cf2c73c76', '82aa1770-1df4-592e-9eed-4759c0cf273f', 'saas', 'en', 'SYNONYM', 'saas'),
  ('08938c55-b33b-5f9b-a951-5176cba50dbc', '82aa1770-1df4-592e-9eed-4759c0cf273f', 'software as a service', 'en', 'SYNONYM', 'software as a service'),
  ('6463f741-3eea-5f09-b362-24797b81ab8f', '82aa1770-1df4-592e-9eed-4759c0cf273f', 'b2b software subscription', 'en', 'SYNONYM', 'b2b software subscription'),
  ('53500235-1864-5119-adcf-2b37d9a87548', '8dfc3dc4-500c-577e-8247-57df0109126c', 'take rate', 'en', 'SYNONYM', 'take rate'),
  ('18acad24-3742-5f72-aa49-64972342e30b', '8dfc3dc4-500c-577e-8247-57df0109126c', 'per-transaction fee', 'en', 'SYNONYM', 'per-transaction fee'),
  ('1586f167-c421-5335-83ed-7d1fce57f814', '6cc24a99-5036-526b-a5ab-43bd2d54b765', 'pay as you go', 'en', 'SYNONYM', 'pay as you go'),
  ('2e348d93-71f5-50ae-9078-f73bca3693cb', '6cc24a99-5036-526b-a5ab-43bd2d54b765', 'metered pricing', 'en', 'SYNONYM', 'metered pricing'),
  ('00c09862-5607-5445-8d7f-d0cec91a7196', '0e14ef5a-cc3b-53ac-b7bb-d04858cccbd6', 'banks', 'en', 'SYNONYM', 'banks'),
  ('7a1fb68c-4872-5df1-990c-6cd3515aabab', '0e14ef5a-cc3b-53ac-b7bb-d04858cccbd6', 'cooperative banks', 'en', 'SYNONYM', 'cooperative banks'),
  ('eac48e73-7e0c-5a61-9b8e-0b2ddc31df72', '0e14ef5a-cc3b-53ac-b7bb-d04858cccbd6', 'fis', 'en', 'SYNONYM', 'fis'),
  ('fc173e29-9ea8-5527-9d9d-8ff6931dcd47', 'ca22d072-a91a-5ce6-800f-12641b654523', 'insurers', 'en', 'SYNONYM', 'insurers'),
  ('1faff188-2239-5d0b-a6b0-5fbe09f29f93', '5b5bb026-f5f4-5e56-bed5-0910f014960a', 'b2b', 'en', 'SYNONYM', 'b2b'),
  ('4fab32bb-dcf9-52f3-874f-4ec1dd87a92f', '5b5bb026-f5f4-5e56-bed5-0910f014960a', 'businesses', 'en', 'SYNONYM', 'businesses'),
  ('2989c1ed-9e98-5ae8-8c56-96a25863da9d', 'a5ed8311-208b-5bf4-bd93-eb1bf6b228ec', 'smb', 'en', 'SYNONYM', 'smb'),
  ('b0b2f020-c7c9-5777-9ac0-bebb108db40a', 'a5ed8311-208b-5bf4-bd93-eb1bf6b228ec', 'sme', 'en', 'SYNONYM', 'sme'),
  ('6b0ae828-12a3-51c4-a2fe-a7d892a77b91', 'a5ed8311-208b-5bf4-bd93-eb1bf6b228ec', 'small businesses', 'en', 'SYNONYM', 'small businesses'),
  ('56a499bc-699b-5484-98e4-ae9ac62501e3', 'd458f353-52bf-5884-b43e-c3a9a1dd2202', 'large enterprises', 'en', 'SYNONYM', 'large enterprises'),
  ('34c8f677-9c86-557a-8062-b11f7302c347', '54875ba5-7877-5276-befc-30e6cfe1996c', 'b2c', 'en', 'SYNONYM', 'b2c'),
  ('30824bf1-dc88-55c2-a3ad-c5cada8b0232', '54875ba5-7877-5276-befc-30e6cfe1996c', 'individuals', 'en', 'SYNONYM', 'individuals'),
  ('a651bfb5-6428-5965-bdb0-3713788d089e', 'dae401c9-6c0a-5ecd-91cd-20d6f0c95e30', 'developers', 'en', 'SYNONYM', 'developers'),
  ('256ec788-869b-590f-a5d7-4cc01a23d901', '6411f1f3-0208-5720-a5d7-52cd903be265', 'public sector', 'en', 'SYNONYM', 'public sector'),
  ('531c98e9-0e39-518f-8f61-b83651c8a161', '74fccd90-f61f-5770-ab80-2906aef2136c', 'ngo', 'en', 'SYNONYM', 'ngo'),
  ('ee2e3451-6be6-5cb9-8ca7-738b480bfbfa', 'df8023ce-2f0e-54fb-b14b-13c400702b34', 'preseed', 'en', 'SYNONYM', 'preseed'),
  ('41696c34-76b8-5001-856c-ed6a8f0b930a', 'df8023ce-2f0e-54fb-b14b-13c400702b34', 'pre seed', 'en', 'SYNONYM', 'pre seed'),
  ('cf4ebdee-0ef0-58f1-88e2-226d97fb9cbb', '7a781bf3-c238-57fa-9b67-60b88059b7ae', 'series-a', 'en', 'SYNONYM', 'series-a'),
  ('933bf9ff-23e0-5582-9bdc-f0b3341785c1', '66bbda33-e9f3-5ae4-a811-a4e7e6c7188b', 'series-b', 'en', 'SYNONYM', 'series-b'),
  ('e1a922e0-b253-579d-9a04-a073dad99951', '9269cbda-b18f-549f-a515-475045f70e3d', 'series c+', 'en', 'SYNONYM', 'series c+'),
  ('97481e56-0603-5422-b230-c5c93f6af222', '9269cbda-b18f-549f-a515-475045f70e3d', 'growth stage', 'en', 'SYNONYM', 'growth stage'),
  ('5b66fb1f-1418-54f6-b91a-54d8a5860325', '9269cbda-b18f-549f-a515-475045f70e3d', 'late stage', 'en', 'SYNONYM', 'late stage'),
  ('a64b9272-3b71-58a7-96ac-b81e845496fb', '726b635e-ae4a-563a-a0bb-d1a1621e8dd3', 'NG', 'en', 'ABBREVIATION', 'ng'),
  ('fc9e84f9-04fe-5fda-b517-97ee560285a1', 'e602c303-729f-5df2-8a11-0bed1f8668ea', 'GH', 'en', 'ABBREVIATION', 'gh'),
  ('3d4cb255-0f03-5792-b0ea-64f6ffecc7a0', '4abdaf9a-237f-5aa0-955c-f00717931597', 'KE', 'en', 'ABBREVIATION', 'ke'),
  ('7273976f-9a80-5e9b-8f18-fd0364e72198', '35deea15-3a55-58ec-9ef9-1a991c392611', 'ZA', 'en', 'ABBREVIATION', 'za'),
  ('226574e5-340b-54ab-b47f-8c5e9db2a44b', '5f8eb635-f79f-5deb-9896-6409c9fd4fb6', 'EG', 'en', 'ABBREVIATION', 'eg'),
  ('ca154961-9c18-5225-8821-1bce32a70aef', 'ccace354-1437-5fb0-a46f-2c6f11ff21cf', 'GB', 'en', 'ABBREVIATION', 'gb'),
  ('8995f1f6-a04b-502a-addb-3907fcbe2067', '2e3343e1-911c-5806-a020-b0be335cc55b', 'DE', 'en', 'ABBREVIATION', 'de'),
  ('05559167-b9c6-5017-9e5d-7fab0a30be5c', 'a9349fc5-5ebc-56c4-8bbd-36f3415a7209', 'FR', 'en', 'ABBREVIATION', 'fr'),
  ('a8cbfb72-2b69-5801-b900-157a9e9d8dcd', '20dc8cd8-bb51-517f-8fe0-1f6264e51a3b', 'NL', 'en', 'ABBREVIATION', 'nl'),
  ('f93d9e1a-cb81-5e04-bc5c-e262e74cbd62', '6511206c-6b77-5172-9e1b-ac0eca583611', 'US', 'en', 'ABBREVIATION', 'us'),
  ('2171255f-0681-543b-b718-823f1ac5769a', 'fbad1397-3452-5040-8149-0a6655282160', 'CA', 'en', 'ABBREVIATION', 'ca'),
  ('48471e72-4a68-5007-84d6-08fd699f6efa', '2593e271-7b16-575d-8650-5e35054df867', 'AE', 'en', 'ABBREVIATION', 'ae'),
  ('1f5c8f76-5232-59e2-9450-82ff20c9dfc9', '57b96b49-499c-5192-be13-0ed9a66a60a3', 'IN', 'en', 'ABBREVIATION', 'in'),
  ('5cf83351-9e4e-5509-84e5-f75dc033a110', '6180c1da-6483-57d0-be9c-e0520955c003', 'SG', 'en', 'ABBREVIATION', 'sg'),
  ('4da2f275-082e-51b9-a5f4-00c1b34a0e5f', 'e238cbcc-0cca-5af1-9a31-ee85f05cfcab', 'BR', 'en', 'ABBREVIATION', 'br'),
  ('7246a824-d494-5051-acf4-c42fea8690d2', '92f962fb-7189-5917-9cd7-cc584ffa4931', 'climate tech', 'en', 'SYNONYM', 'climate tech'),
  ('8da29465-a39f-5d2e-872d-8c3a924a8071', '34ac5dc7-5ab0-5797-823a-f4f20575865f', 'licensed financial institution', 'en', 'SYNONYM', 'licensed financial institution')
on conflict (id) do nothing;

insert into taxonomy.node_edges (from_node_id, to_node_id, edge_type) values
  ('c19e285b-2f10-53b6-a1b8-949e5a6bff24', '2bb85b49-88d6-5a95-8327-55d2dadb46f2', 'related_to'),
  ('610ee7ac-6443-5854-b5cd-3cce4c82ec75', 'ce7fe6a0-21de-50ff-80ee-946ac6c0dc27', 'related_to'),
  ('74b0ce65-9425-5c90-9bf8-b986101f4b9c', '24130b91-09d3-5282-82ee-5117e41eed50', 'related_to'),
  ('c7d5cb81-9017-5e07-970d-841fd94f30c3', '6f9743fd-b2ad-5e4a-9151-8c8eabfe0fd3', 'related_to'),
  ('65f8bb2b-9ce2-5f31-9391-7841534c8d12', 'a45b63ab-2d5e-5b0b-9c7a-fcc5d43efa1f', 'related_to'),
  ('380cc839-7e70-507b-877e-9f5a55f9c350', '5b5fd296-e73d-579d-aa32-4059ad8e609f', 'related_to'),
  ('1565078a-f861-5ac1-bf72-1707d3641f70', 'a8001aec-4070-59a3-b95d-932357457e18', 'commonly_co_occurs'),
  ('82aa1770-1df4-592e-9eed-4759c0cf273f', '5b5bb026-f5f4-5e56-bed5-0910f014960a', 'commonly_co_occurs'),
  ('bc6b81d4-7f43-5500-a55c-a469225d6e24', '70c50024-cb99-5ac2-a238-ac3f5e9c0a41', 'related_to'),
  ('24130b91-09d3-5282-82ee-5117e41eed50', '69692abb-4469-5707-96c0-f64e0df58363', 'overlaps'),
  ('31a21318-4936-5c6e-9e60-ed6b35c565b6', 'c19e285b-2f10-53b6-a1b8-949e5a6bff24', 'broader_than'),
  ('f231ebf4-b549-5c87-87d1-8a1a99c648b4', 'a5ed8311-208b-5bf4-bd93-eb1bf6b228ec', 'commonly_co_occurs')
on conflict (from_node_id, to_node_id, edge_type) do nothing;
