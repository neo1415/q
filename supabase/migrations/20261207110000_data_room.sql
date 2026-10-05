-- A company's data room (overnight plan A3, 2026-10-06; research
-- docs/research/2026-10-06/data-room.md). Built on Evidence documents and
-- the existing disclosure machinery; nothing here is a looser rule.
--
--   evidence.data_room_folders            reference data: the folders
--   evidence.data_room_checklist_items    reference data: the default
--                                         checklist by stage and country
--   evidence.data_room_entries            one company document's level
--                                         (PUBLIC / ON_REQUEST / SHARED_ONLY
--                                         / PRIVATE), its ADR-001 scope
--                                         (derived), folder and checklist item
--   evidence.data_room_access_requests    an investor asked for a document
--                                         (or everything on request);
--                                         append-only
--   evidence.data_room_request_decisions  the founder's answer, with the
--                                         grant's expiry; append-only, one
--                                         per request
--   evidence.data_room_views              the first time a person at an
--                                         investor organisation opened a
--                                         document; append-only
--
-- A grant itself is NOT stored here: approving a request writes the
-- existing disclosure policy (permissions.disclosure_policies, resource
-- 'document', relationship_shared, the relationship as recipient, `view`,
-- expires_at), revocable like any other, plus a relationship event and an
-- audit row. The level is its own column and never touches
-- evidence.documents.visibility_scope, so nothing Q derived from the file
-- is widened by it (ADR 0041 §3; Q Knowledge ≠ Data Room disclosure).
--
-- Server-only like the rest of evidence: RLS on, no policies, no client
-- grants. The server decides the reader and the projection; the reference
-- data is readable by signed-in clients because it is not tenant data.

-- 1. Reference data ------------------------------------------------------------

create table evidence.data_room_folders (
  code        text primary key check (code ~ '^[a-z][a-z0-9_]{1,63}$'),
  label       text not null check (length(label) between 1 and 80),
  sort_order  integer not null check (sort_order >= 0)
);

comment on table evidence.data_room_folders is
  'Reference data: data-room folders (research §3). Never an enum; changed by migration with history in git.';

create table evidence.data_room_checklist_items (
  code            text primary key check (code ~ '^[a-z][a-z0-9_]{1,63}$'),
  folder_code     text not null references evidence.data_room_folders (code) on delete restrict,
  label           text not null check (length(label) between 1 and 160),
  -- Country-specific words for the same document ({"NG": "CAC status report"}).
  country_labels  jsonb not null default '{}'::jsonb check (jsonb_typeof(country_labels) = 'object'),
  -- 1 pre-seed, 2 seed, 3 series A, 4 series B: expected from this stage on.
  min_stage_rank  integer not null check (min_stage_rank between 1 and 4),
  -- Null: everywhere. Otherwise ISO 3166-1 alpha-2 codes.
  country_codes   text[] check (country_codes is null or cardinality(country_codes) between 1 and 50),
  default_level   text not null check (default_level in ('PUBLIC', 'ON_REQUEST', 'SHARED_ONLY', 'PRIVATE')),
  sort_order      integer not null check (sort_order >= 0)
);

comment on table evidence.data_room_checklist_items is
  'Reference data: the default data-room checklist by stage and country (research §5.4). A recommendation, never a requirement; absence is never negative evidence.';

create index data_room_checklist_items_folder_idx
  on evidence.data_room_checklist_items (folder_code, sort_order);

insert into evidence.data_room_folders (code, label, sort_order) values
  ('fundraising', 'Fundraising summary', 10),
  ('corporate', 'Company and incorporation', 20),
  ('kyc_kyb', 'Identity and ownership (KYC/KYB)', 30),
  ('cap_table', 'Cap table and equity', 40),
  ('financials', 'Financials', 50),
  ('tax', 'Tax and compliance', 60),
  ('legal_ip', 'Legal and IP', 70),
  ('commercial', 'Customers and contracts', 80),
  ('team', 'Team', 90),
  ('licences', 'Licences and data protection', 100),
  ('other', 'Other documents', 900);

insert into evidence.data_room_checklist_items
  (code, folder_code, label, country_labels, min_stage_rank, country_codes, default_level, sort_order) values
  -- Pre-seed (8)
  ('pitch_deck', 'fundraising', 'Pitch deck', '{}', 1, null, 'PUBLIC', 10),
  ('one_pager', 'fundraising', 'One-page summary', '{}', 1, null, 'PUBLIC', 20),
  ('certificate_of_incorporation', 'corporate', 'Certificate of incorporation',
    '{"NG": "Certificate of incorporation (CAC)", "KE": "Certificate of incorporation", "ZA": "Registration certificate (CoR14.3)", "GB": "Certificate of incorporation (Companies House)", "US": "Delaware certificate of incorporation"}', 1, null, 'ON_REQUEST', 30),
  ('registry_extract', 'kyc_kyb', 'Shareholders and directors register',
    '{"NG": "Shareholders and directors (CAC 1.1)", "KE": "Shareholders and directors (CR12)", "ZA": "Directors (CoR39) and share register", "GB": "Confirmation statement and PSC register", "US": "Stockholder and director list"}', 1, null, 'SHARED_ONLY', 40),
  ('founder_agreement', 'cap_table', 'Founder agreement and vesting', '{}', 1, null, 'SHARED_ONLY', 50),
  ('ip_assignment_founders', 'legal_ip', 'IP assignment from the founders', '{}', 1, null, 'SHARED_ONLY', 60),
  ('cap_table_summary', 'cap_table', 'Cap table summary', '{}', 1, null, 'ON_REQUEST', 70),
  ('safes_notes', 'cap_table', 'Signed SAFEs and notes', '{}', 1, null, 'SHARED_ONLY', 80),
  -- Seed (+10)
  ('financial_model', 'financials', 'Financial model', '{}', 2, null, 'ON_REQUEST', 110),
  ('key_metrics', 'fundraising', 'Key numbers dashboard', '{}', 2, null, 'ON_REQUEST', 120),
  ('use_of_funds', 'fundraising', 'Use of funds', '{}', 2, null, 'PUBLIC', 130),
  ('management_accounts', 'financials', 'Management accounts (last 6-12 months)', '{}', 2, null, 'SHARED_ONLY', 140),
  ('constitution', 'corporate', 'Memorandum and articles',
    '{"NG": "Memorandum and articles (MemArt)", "ZA": "Memorandum of Incorporation (MOI)", "US": "Bylaws"}', 2, null, 'ON_REQUEST', 150),
  ('good_standing', 'corporate', 'Good-standing letter',
    '{"NG": "Company status report (CAC)", "US": "Delaware good standing", "GB": "Companies House status"}', 2, null, 'ON_REQUEST', 160),
  ('tax_clearance', 'tax', 'Tax ID and tax clearance',
    '{"NG": "TIN and tax clearance certificate (TCC)", "KE": "KRA PIN and tax compliance certificate", "ZA": "SARS tax number and compliance pin", "US": "EIN letter", "GB": "UTR and VAT registration"}', 2, null, 'ON_REQUEST', 170),
  ('data_protection', 'licences', 'Data protection registration',
    '{"NG": "NDPC registration", "KE": "ODPC registration", "ZA": "Information Regulator registration (POPIA)", "GB": "ICO registration"}', 2, null, 'ON_REQUEST', 180),
  ('sector_licences', 'licences', 'Sector licences (or not needed)', '{}', 2, null, 'ON_REQUEST', 190),
  ('team_bios', 'team', 'Team bios and org chart', '{}', 2, null, 'PUBLIC', 200),
  -- Series A (+12)
  ('monthly_financials_24m', 'financials', 'Monthly financials (24 months)', '{}', 3, null, 'SHARED_ONLY', 310),
  ('unit_economics', 'financials', 'Cohorts and unit economics', '{}', 3, null, 'SHARED_ONLY', 320),
  ('revenue_by_customer', 'financials', 'Revenue by customer', '{}', 3, null, 'SHARED_ONLY', 330),
  ('customer_contracts', 'commercial', 'Top customer contracts', '{}', 3, null, 'SHARED_ONLY', 340),
  ('employment_contracts', 'team', 'Key employment contracts', '{}', 3, null, 'SHARED_ONLY', 350),
  ('esop', 'cap_table', 'Option plan and grants', '{}', 3, null, 'SHARED_ONLY', 360),
  ('cap_table_full', 'cap_table', 'Fully diluted and pro forma cap table', '{}', 3, null, 'SHARED_ONLY', 370),
  ('board_minutes', 'corporate', 'Board minutes and resolutions', '{}', 3, null, 'SHARED_ONLY', 380),
  ('tax_returns', 'tax', 'Tax returns and statutory remittances', '{"NG": "Tax returns, PAYE and pension (PenCom)", "KE": "Tax returns, NSSF and SHIF"}', 3, null, 'SHARED_ONLY', 390),
  ('litigation', 'legal_ip', 'Litigation summary', '{}', 3, null, 'SHARED_ONLY', 400),
  ('trademarks', 'legal_ip', 'Trademarks and domains', '{}', 3, null, 'ON_REQUEST', 410),
  ('security_overview', 'legal_ip', 'Security overview', '{}', 3, null, 'SHARED_ONLY', 420),
  -- Series B (+8)
  ('audited_accounts', 'financials', 'Audited accounts', '{}', 4, null, 'SHARED_ONLY', 510),
  ('debt_schedule', 'financials', 'Debt schedule', '{}', 4, null, 'SHARED_ONLY', 520),
  ('group_structure', 'corporate', 'Group structure and transfer pricing', '{}', 4, null, 'SHARED_ONLY', 530),
  ('insurance', 'legal_ip', 'Insurance policies', '{}', 4, null, 'SHARED_ONLY', 540),
  ('open_source_audit', 'legal_ip', 'Open-source licence audit', '{}', 4, null, 'SHARED_ONLY', 550),
  ('regulatory_correspondence', 'licences', 'Regulatory correspondence', '{}', 4, null, 'SHARED_ONLY', 560),
  ('esg', 'commercial', 'ESG and impact (ESMS)', '{}', 4, null, 'ON_REQUEST', 570),
  ('customer_references', 'commercial', 'Customer references', '{}', 4, null, 'SHARED_ONLY', 580),
  -- Country-specific additions
  ('scuml_certificate', 'kyc_kyb', 'SCUML certificate (where it applies)', '{}', 2, '{NG}', 'ON_REQUEST', 590);

alter table evidence.data_room_folders enable row level security;
alter table evidence.data_room_checklist_items enable row level security;
create policy data_room_folders_read on evidence.data_room_folders
  for select to authenticated using (true);
create policy data_room_checklist_items_read on evidence.data_room_checklist_items
  for select to authenticated using (true);
grant select on evidence.data_room_folders, evidence.data_room_checklist_items to authenticated;

-- 2. A document's level ----------------------------------------------------

create table evidence.data_room_entries (
  document_id           uuid primary key,
  tenant_id             uuid not null references identity.tenants (id) on delete restrict,
  company_id            uuid not null,
  folder_code           text not null references evidence.data_room_folders (code) on delete restrict,
  checklist_item_code   text references evidence.data_room_checklist_items (code) on delete restrict,
  level                 text not null default 'PRIVATE'
                          check (level in ('PUBLIC', 'ON_REQUEST', 'SHARED_ONLY', 'PRIVATE')),
  -- ADR-001 scope, derived from the level so the two can never disagree.
  visibility_scope      text not null generated always as (
                          case level
                            when 'PUBLIC' then 'network_visible'
                            when 'ON_REQUEST' then 'specifically_shared'
                            when 'SHARED_ONLY' then 'specifically_shared'
                            else 'organisation_private'
                          end) stored,
  -- Freshness (research §6.7): good-standing, tax clearance and registry
  -- extracts go stale. Shown as a date; never deletes anything.
  valid_until           date,
  page_count            integer check (page_count is null or page_count between 1 and 10000),
  updated_by_user_id    uuid not null references identity.user_profiles (id) on delete restrict,
  created_at            timestamptz not null default clock_timestamp(),
  updated_at            timestamptz not null default clock_timestamp(),
  version               integer not null default 1 check (version >= 1),
  foreign key (document_id, tenant_id)
    references evidence.documents (id, tenant_id) on delete restrict,
  foreign key (company_id, tenant_id)
    references core.companies (id, tenant_id) on delete restrict
);

comment on table evidence.data_room_entries is
  'One company document''s data-room level (A3). visibility_scope is derived (ADR-001). Never widens evidence.documents.visibility_scope or anything derived from the file. A document with no row is PRIVATE.';

create index data_room_entries_company_idx
  on evidence.data_room_entries (tenant_id, company_id, folder_code);
-- The investor read: listed levels of one company.
create index data_room_entries_listed_idx
  on evidence.data_room_entries (company_id)
  where level in ('PUBLIC', 'ON_REQUEST');

create trigger set_updated_at
  before update on evidence.data_room_entries
  for each row execute function private.set_updated_at();

-- The entry's company is the document's own company: a founder cannot file
-- one company's document into another's room.
create function private.data_room_entry_company_matches()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from evidence.documents d
     where d.id = new.document_id
       and d.tenant_id = new.tenant_id
       and d.company_id = new.company_id) then
    raise exception 'a data-room entry belongs to its document''s company'
      using errcode = '23514';
  end if;
  return new;
end
$$;

revoke all on function private.data_room_entry_company_matches() from public, anon, authenticated;

create trigger data_room_entries_company_matches
  before insert or update on evidence.data_room_entries
  for each row execute function private.data_room_entry_company_matches();

-- 3. Requests, decisions, views (append-only) --------------------------------

create table evidence.data_room_access_requests (
  id                         uuid primary key default gen_random_uuid(),
  -- The company's tenant (ADR 0003), like the relationship's history.
  tenant_id                  uuid not null references identity.tenants (id) on delete restrict,
  company_id                 uuid not null,
  -- Null: every on-request document.
  document_id                uuid,
  relationship_id            uuid not null,
  investor_organisation_id   uuid not null references core.investor_organisations (id) on delete restrict,
  requested_by_user_id       uuid not null references identity.user_profiles (id) on delete restrict,
  note                       text check (note is null or (length(note) between 1 and 1000 and note !~ '[[:cntrl:]]')),
  idempotency_key            text not null check (length(idempotency_key) between 8 and 200 and idempotency_key !~ '[[:cntrl:]]'),
  created_at                 timestamptz not null default clock_timestamp(),
  unique (requested_by_user_id, idempotency_key),
  foreign key (company_id, tenant_id)
    references core.companies (id, tenant_id) on delete restrict,
  foreign key (document_id, tenant_id)
    references evidence.documents (id, tenant_id) on delete restrict,
  foreign key (relationship_id, tenant_id)
    references network.relationships (id, tenant_id) on delete restrict
);

comment on table evidence.data_room_access_requests is
  'An investor asked for an on-request data-room document (or all of them). Append-only; answered by evidence.data_room_request_decisions.';

create index data_room_access_requests_company_idx
  on evidence.data_room_access_requests (company_id, created_at desc);
create index data_room_access_requests_relationship_idx
  on evidence.data_room_access_requests (relationship_id, created_at desc);

create table evidence.data_room_request_decisions (
  request_id              uuid primary key references evidence.data_room_access_requests (id) on delete restrict,
  tenant_id               uuid not null references identity.tenants (id) on delete restrict,
  decision                text not null check (decision in ('APPROVED', 'DECLINED')),
  -- APPROVED: when access ends (the disclosure policy carries the same).
  expires_at              timestamptz,
  decided_by_user_id      uuid not null references identity.user_profiles (id) on delete restrict,
  created_at              timestamptz not null default clock_timestamp(),
  check ((decision = 'APPROVED') = (expires_at is not null)),
  check (expires_at is null or expires_at > created_at)
);

comment on table evidence.data_room_request_decisions is
  'The founder''s answer to a data-room request. Append-only, one per request. An approval always has an expiry.';

create table evidence.data_room_views (
  document_id                uuid not null,
  tenant_id                  uuid not null references identity.tenants (id) on delete restrict,
  investor_organisation_id   uuid not null references core.investor_organisations (id) on delete restrict,
  viewed_by_user_id          uuid not null references identity.user_profiles (id) on delete restrict,
  created_at                 timestamptz not null default clock_timestamp(),
  primary key (document_id, investor_organisation_id, viewed_by_user_id),
  foreign key (document_id, tenant_id)
    references evidence.documents (id, tenant_id) on delete restrict
);

comment on table evidence.data_room_views is
  'The first time a person at an investor organisation opened a data-room document. Append-only. Viewing is not interest: never a ranking, match or interest signal.';

create function private.evidence_data_room_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% is append-only', tg_table_name
    using errcode = '55000';
end
$$;

revoke all on function private.evidence_data_room_append_only() from public, anon, authenticated;

create trigger data_room_access_requests_append_only
  before update or delete on evidence.data_room_access_requests
  for each row execute function private.evidence_data_room_append_only();
create trigger data_room_request_decisions_append_only
  before update or delete on evidence.data_room_request_decisions
  for each row execute function private.evidence_data_room_append_only();
create trigger data_room_views_append_only
  before update or delete on evidence.data_room_views
  for each row execute function private.evidence_data_room_append_only();

-- A decision belongs to its request's tenant.
create function private.data_room_decision_tenant_matches()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from evidence.data_room_access_requests r
     where r.id = new.request_id and r.tenant_id = new.tenant_id) then
    raise exception 'a decision belongs to its request''s tenant'
      using errcode = '23514';
  end if;
  return new;
end
$$;

revoke all on function private.data_room_decision_tenant_matches() from public, anon, authenticated;

create trigger data_room_request_decisions_tenant_matches
  before insert on evidence.data_room_request_decisions
  for each row execute function private.data_room_decision_tenant_matches();

-- Server-only: RLS on as a second layer, no policies, no client grants.
alter table evidence.data_room_entries enable row level security;
alter table evidence.data_room_access_requests enable row level security;
alter table evidence.data_room_request_decisions enable row level security;
alter table evidence.data_room_views enable row level security;
revoke all on evidence.data_room_entries, evidence.data_room_access_requests,
  evidence.data_room_request_decisions, evidence.data_room_views
  from anon, authenticated;

-- Notices about requests and answers reuse the existing DILIGENCE kind, and
-- the two relationship events (data_room_access_requested,
-- data_room_access_granted) are registry values, not schema: nothing else
-- changes here.
