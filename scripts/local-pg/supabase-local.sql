-- Minimal Supabase surface for running the repo migrations on plain Postgres 16
-- (scripts/local-pg/setup.sh). Local rehearsal only; never applied anywhere hosted.
do $$
declare r text;
begin
  -- Roles are cluster-wide: created once, kept across rebuilds of the database.
  foreach r in array array['anon','authenticated','service_role','authenticator','supabase_auth_admin','supabase_storage_admin','supabase_admin'] loop
    if not exists (select 1 from pg_roles where rolname = r) then
      execute format('create role %I nologin', r);
    end if;
  end loop;
end $$;
alter role anon noinherit;
alter role authenticated noinherit;
alter role service_role noinherit bypassrls;
alter role authenticator login noinherit;
alter role supabase_auth_admin createrole;
alter role supabase_admin superuser;
grant anon, authenticated, service_role to authenticator;
create schema extensions;
grant usage on schema extensions to public;
create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  instance_id uuid, aud text, role text,
  email text, encrypted_password text, email_confirmed_at timestamptz,
  raw_app_meta_data jsonb default '{}'::jsonb, raw_user_meta_data jsonb default '{}'::jsonb,
  is_anonymous boolean default false,
  created_at timestamptz default now(), updated_at timestamptz default now(),
  phone text, last_sign_in_at timestamptz, banned_until timestamptz, deleted_at timestamptz,
  is_sso_user boolean default false, confirmed_at timestamptz
);
grant all on auth.users to supabase_auth_admin;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(coalesce(current_setting('request.jwt.claim.sub', true),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')), '')::uuid $$;
create function auth.role() returns text language sql stable as $$
  select nullif(coalesce(current_setting('request.jwt.claim.role', true),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')), '')::text $$;
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$;
grant execute on all functions in schema auth to anon, authenticated, service_role;
create schema storage;
grant usage on schema storage to anon, authenticated, service_role;
create table storage.buckets (
  id text primary key, name text not null unique, owner uuid, public boolean default false,
  avif_autodetection boolean default false, file_size_limit bigint, allowed_mime_types text[],
  created_at timestamptz default now(), updated_at timestamptz default now()
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id),
  name text, owner uuid, metadata jsonb, created_at timestamptz default now(), updated_at timestamptz default now()
);
alter table storage.objects enable row level security;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;
create extension if not exists pgtap with schema extensions;
