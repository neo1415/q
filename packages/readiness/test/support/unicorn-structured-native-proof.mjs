/**
 * Focused REAL PostgreSQL 17 + pgTAP proof of the fix-forward source guard.
 * Minimal canonical parent shapes below are TEST FIXTURES, not a replacement
 * Supabase schema. Full protected 130/981/983 tests remain mandatory.
 *
 * Reproduce from repo root with local PG17/pgTAP binaries available:
 *   createdb -h127.0.0.1 -p55439 -Uagent cq_unicorn_source_guard_proof
 *   CQ_UNICORN_PROOF_PSQL=/tmp/cq-pg17/usr/lib/postgresql/17/bin/psql \
 *     node packages/readiness/test/support/unicorn-structured-native-proof.mjs
 * Recreate the dedicated database to repeat; this script never drops data.
 *
 * Tested with official Debian trixie portable packages, extracted via
 * dpkg-deb -x into /tmp (no system install, TLS verification retained):
 * https://deb.debian.org/debian/pool/main/p/postgresql-17/postgresql-17_17.11-0+deb13u1_amd64.deb
 * SHA256 d2ce1ddffafa783f9acda4c92c86fc21e8288bff3782d739294f14fa797d7886
 * https://deb.debian.org/debian/pool/main/p/postgresql-17/postgresql-client-17_17.11-0+deb13u1_amd64.deb
 * SHA256 9d8558f8dd57c8e92e218a20698383575d53742ca3f9e7c2b7fe5f246d5216ae
 * https://deb.debian.org/debian/pool/main/p/pgtap/postgresql-17-pgtap_1.3.3-3_all.deb
 * SHA256 fe008c1748ff590a3c4fe72117f28fb21e48b08c50c0b2b401d8baaeb2709d64
 * Their SHA256s matched main/binary-amd64/Packages.xz, SHA256
 * 7778d3e3f303b7ddb8ce0fe7c8d57473a076c6bf2e8f241f75421d2396352498.
 * That index hash matched https://deb.debian.org/debian/dists/trixie/InRelease.
 * InRelease signatures verified with gpgv and the environment's existing
 * /usr/share/keyrings/debian-archive-keyring.gpg (trixie archive/stable keys).
 * gpgv was extracted from official gpgv_2.4.7-21+deb13u1+b5_amd64.deb:
 * SHA256 104e4c57b98f0b883aa94c68fbe7ec7b48bcdec7c0f9dedf2a51a5054aaeb5ae.
 * No binaries, package archives, account data or credentials belong in Git.
 */
import assert from "node:assert/strict";
import console from "node:console";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";

const target = new URL(
  process.env["CQ_UNICORN_PROOF_DATABASE_URL"] ??
    "postgresql://agent@127.0.0.1:55439/cq_unicorn_source_guard_proof",
);
assert.equal(
  target.hostname,
  "127.0.0.1",
  "Only local proof databases accepted",
);
assert.equal(target.pathname, "/cq_unicorn_source_guard_proof");
assert.equal(
  target.password,
  "",
  "This isolated local test uses no credentials",
);
const executable = process.env["CQ_UNICORN_PROOF_PSQL"] ?? "psql";
const args = [
  "--host",
  target.hostname,
  "--port",
  target.port || "55439",
  "--username",
  target.username || "agent",
  "--dbname",
  "cq_unicorn_source_guard_proof",
  "--no-psqlrc",
  "--set",
  "ON_ERROR_STOP=1",
  "--tuples-only",
  "--no-align",
];
function execute(input) {
  const result = spawnSync(executable, args, { input, encoding: "utf8" });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}
execute(`
create schema core;
create schema knowledge;
create schema evidence;
create schema private;
create schema extensions;
create extension pgtap with schema extensions;
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
`);
const root = new URL("../../../../", import.meta.url);
execute(
  readFileSync(
    new URL(
      "supabase/migrations/20261228201500_unicorn_structured_source_guard.sql",
      root,
    ),
    "utf8",
  ),
);
const original = readFileSync(
  new URL(
    "supabase/tests/database/rls/983_unicorn_structured_source_guard.test.sql",
    root,
  ),
  "utf8",
);
const focused = original.replace(
  "\\ir support/fixture.psql\nselect pg_temp.rls_setup();",
  () =>
    `create function pg_temp.rls_id(label text) returns uuid language sql as $$ select case label when 'tenant_a' then '10000000-0000-4000-8000-000000000001'::uuid when 'org_a' then '10000000-0000-4000-8000-000000000002'::uuid when 'user_a' then '10000000-0000-4000-8000-000000000011'::uuid else '10000000-0000-4000-8000-000000000099'::uuid end $$;`,
);
assert.notEqual(focused, original, "Fixture replacement must be explicit");
const output = execute(`set search_path=extensions,public;\n${focused}`);
const planned = Number(original.match(/select plan\((\d+)\)/)?.[1]);
const passed = output.match(/^ok \d+ -/gm)?.length ?? 0;
assert(Number.isInteger(planned) && planned > 0);
assert.equal(passed, planned, output);
assert(!output.includes("not ok"), output);
console.log(
  JSON.stringify(
    {
      status: "PASS",
      planned,
      passed,
      fixture: "focused thin parents; full Supabase CI still mandatory",
      migration: fileURLToPath(
        new URL(
          "supabase/migrations/20261228201500_unicorn_structured_source_guard.sql",
          root,
        ),
      ),
    },
    null,
    2,
  ),
);
