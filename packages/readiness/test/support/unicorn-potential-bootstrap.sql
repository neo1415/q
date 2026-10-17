-- FOCUSED TEST FIXTURE ONLY. Minimal canonical parent shapes, not the full
-- Supabase schema. Run only in a fresh disposable local proof database.
do $$ begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls; end if;
end $$;
create schema identity;
create schema core;
create schema knowledge;
create schema evidence;
create schema media;
create schema billing;
create schema private;
create schema extensions;
create table identity.tenants(id uuid primary key);
create table identity.organisations(id uuid primary key);
create table core.companies(id uuid primary key, tenant_id uuid not null references identity.tenants(id), organisation_id uuid not null references identity.organisations(id), company_status text default 'active', unique(id,tenant_id));
create table knowledge.company_profiles(company_id uuid primary key references core.companies(id), listed boolean not null);
create table billing.features(key text primary key,name text,description text,kind text,unit_singular text,unit_plural text);
create table billing.plans(id uuid primary key,key text);
create table billing.plan_features(plan_id uuid,feature_key text,included boolean,limit_value integer,primary key(plan_id,feature_key));
create table evidence.claims(id uuid primary key, tenant_id uuid, subject_id uuid, subject_type text, visibility_scope text, lifecycle_status text, asserted_at timestamptz);
create table core.founder_background_entries(id uuid primary key,user_id uuid,tenant_id uuid, visibility_scope text);
create table core.company_members(user_id uuid,tenant_id uuid,company_id uuid,is_founder boolean,is_current boolean);
create table evidence.documents(id uuid primary key,company_id uuid,tenant_id uuid,current_version_id uuid,owner_kind text,document_type text,status text,download_audience text);
create table evidence.document_versions(id uuid primary key,tenant_id uuid,malware_scan_status text);
create table evidence.data_room_entries(document_id uuid,level text);
create table evidence.deck_extractions(id uuid primary key,document_id uuid,company_id uuid,document_version_id uuid,created_at timestamptz);
create table evidence.deck_section_reviews(extraction_id uuid,section text,action text,created_at timestamptz);
create table media.media_assets(id uuid,owner_type text,owner_id uuid,tenant_id uuid,purpose text,status text,moderation_status text,playback_policy text,deleted_at timestamptz,superseded_at timestamptz);
insert into identity.tenants values('10000000-0000-4000-8000-000000000001');
insert into identity.organisations values('10000000-0000-4000-8000-000000000002'),('10000000-0000-4000-8000-000000000003');
insert into core.companies(id,tenant_id,organisation_id) values('10000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002');
insert into knowledge.company_profiles values('10000000-0000-4000-8000-000000000004',true);
insert into billing.plans values('10000000-0000-4000-8000-000000000005','investor_pro'),('10000000-0000-4000-8000-000000000006','fund'),('10000000-0000-4000-8000-000000000007','free');
