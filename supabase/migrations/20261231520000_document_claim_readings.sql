-- A8 D3 (live 2026-11-14): Q reads a founder's deck once for figures and
-- proposes each as a card. The once-only marker (the DOCUMENT evidence
-- source `document-claims:<version>`) was registered BEFORE the model call,
-- so a call that failed (an answer the schema refused) left the version
-- marked read with nothing proposed, and it was never read again.
--
-- This table is the job's own record per document version: whether the
-- reading finished, how many attempts it took, and the last failure code.
-- A version is read again (bounded) until it COMPLETED; a policy refusal
-- (BLOCKED) is final. A marker source without a row here is a reading that
-- never recorded its end (the pre-fix versions): it is retried.
--
-- Additive: one new server-written table, no existing row changed. Apply
-- before deploying the q-api that reads it.

create table evidence.document_claim_readings (
  document_version_id uuid primary key,
  tenant_id           uuid not null references identity.tenants (id) on delete restrict,
  status              text not null check (status in ('READING', 'COMPLETED', 'FAILED', 'BLOCKED')),
  attempts            integer not null default 1 check (attempts between 1 and 100),
  -- A bounded code (SCHEMA_REFUSED, PROVIDER_UNAVAILABLE, ...); never
  -- document text, model text or a provider message.
  error_code          text check (error_code is null or error_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  created_at          timestamptz not null default clock_timestamp(),
  updated_at          timestamptz not null default clock_timestamp(),
  check (error_code is null or status in ('FAILED', 'BLOCKED')),
  foreign key (document_version_id, tenant_id)
    references evidence.document_versions (id, tenant_id) on delete restrict
);

comment on table evidence.document_claim_readings is
  'A8: Q''s reading of one document version for proposed figures. Job state only (status, attempts, failure code); asserts nothing about the company. A version is retried, bounded, until COMPLETED; BLOCKED (policy) is final.';

create index document_claim_readings_retry_idx
  on evidence.document_claim_readings (status, updated_at)
  where status in ('READING', 'FAILED');

alter table evidence.document_claim_readings enable row level security;

-- Server-only: the q-api job writes and reads it; no browser principal
-- holds any privilege here.
revoke all on evidence.document_claim_readings from public, anon, authenticated;
