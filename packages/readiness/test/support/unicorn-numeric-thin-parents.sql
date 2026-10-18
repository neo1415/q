-- SYNTHETIC LOCAL PROOF ONLY. Fresh dedicated database required.
create schema core;
create schema knowledge;
create schema evidence;
create schema private;
create schema extensions;
do $$ begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls; end if;
end $$;
create table core.companies(id uuid primary key,tenant_id uuid,organisation_id uuid,canonical_name text,slug text,current_stage_code text,short_description text,marketplace_visibility text,company_status text default 'active');
create table knowledge.company_profiles(company_id uuid primary key,listed boolean,updated_at timestamptz);
create function public.thin_unicorn_test_profile() returns trigger language plpgsql as $$begin insert into knowledge.company_profiles values(new.id,new.marketplace_visibility='network_visible',clock_timestamp());return new;end$$;
create trigger thin_unicorn_test_profile after insert on core.companies for each row execute function public.thin_unicorn_test_profile();
create table evidence.claims(id uuid primary key,tenant_id uuid,subject_type text,subject_id uuid,claim_type text,claim_key text,statement text,structured_value jsonb,asserted_by_type text,asserted_by_id uuid,asserted_at timestamptz,truth_class text,evidence_status text,lifecycle_status text,visibility_scope text,current_revision_id uuid,current_revision_number integer default 1,valid_from timestamptz,valid_to timestamptz);
create table evidence.claim_revisions(id uuid primary key,tenant_id uuid,claim_id uuid,revision_number integer,statement text,structured_value jsonb,truth_class text,evidence_status text,lifecycle_status text,changed_by_type text,changed_by_id uuid,change_reason text,valid_to timestamptz);
create table core.founder_background_entries(id uuid,user_id uuid,tenant_id uuid,title text,detail text,supporting_document_id uuid,visibility_scope text);
create table core.company_members(user_id uuid,tenant_id uuid,company_id uuid,is_founder boolean,is_current boolean);
create table evidence.documents(id uuid,company_id uuid,tenant_id uuid,current_version_id uuid,owner_kind text default 'ORGANISATION',document_type text,status text default 'ACTIVE',download_audience text,updated_at timestamptz default clock_timestamp(),owner_organisation_id uuid,title text,created_by_user_id uuid);
create table evidence.document_versions(id uuid,tenant_id uuid,malware_scan_status text,document_id uuid,version_number integer,storage_bucket text,storage_key text,original_filename text,mime_type text,size_bytes bigint,sha256 text,uploaded_by_user_id uuid);
create table evidence.data_room_entries(document_id uuid,level text);
create table evidence.deck_extractions(id uuid,tenant_id uuid,document_id uuid,company_id uuid,document_version_id uuid,prompt_version integer,reading_number integer default 1,created_at timestamptz default clock_timestamp(),schema_version integer,sections jsonb);
create table evidence.deck_section_reviews(id uuid,tenant_id uuid,extraction_id uuid,created_at timestamptz default clock_timestamp(),section text,action text,correction text,reviewed_by_user_id uuid);
create table evidence.deck_extraction_confirmations(extraction_id uuid,created_at timestamptz);
-- TEST-ONLY thin parents: not the complete Supabase identity/billing/media schema.
create schema identity;
create schema billing;
create schema media;
create table identity.tenants(id uuid primary key);
create table identity.organisations(id uuid primary key);
alter table core.companies add unique(id,tenant_id);
alter table knowledge.company_profiles add column stage_code text default 'pre_seed', add column sector_codes text[] default '{}', add column business_model_codes text[] default '{}', add column primary_description text, add column short_description text, add column website_url text, add column verification_status text;
alter table core.founder_background_entries add column created_at timestamptz default clock_timestamp();
create table billing.features(key text primary key,name text,description text,kind text,unit_singular text,unit_plural text);
create table billing.plans(id uuid primary key,key text);
create table billing.plan_features(plan_id uuid,feature_key text,included boolean,limit_value integer);
create table media.media_assets(id uuid,tenant_id uuid,owner_type text,owner_id uuid,purpose text,status text,moderation_status text,playback_policy text,deleted_at timestamptz,superseded_at timestamptz,created_at timestamptz,ready_at timestamptz);
create table media.pitch_transcripts(media_asset_id uuid,language text,created_at timestamptz,cues jsonb);
