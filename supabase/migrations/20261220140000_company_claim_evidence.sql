-- 2026-10-08 · a registry document attached to a company claim.
--
--   a claim request ≠ a membership;  a document is evidence for whoever
--   decides, never a decision by itself
--
-- A REGISTRY_DOCUMENT claim names the file the claimant uploaded straight to
-- private storage (bucket cq-documents-private, a key the server chose under
-- company-claims/<request id>/). Only the object's identity and what the
-- server observed are kept here; the bytes never enter Postgres. The table
-- stays server-only (RLS on, no policy, no client grant).

alter table core.company_claim_requests
  add column evidence_object_key    text
    check (evidence_object_key is null
           or evidence_object_key ~ '^company-claims/[0-9a-f-]{36}/[0-9a-f-]{36}$'),
  add column evidence_file_name     text
    check (evidence_file_name is null or length(evidence_file_name) between 1 and 200),
  add column evidence_content_type  text
    check (evidence_content_type is null
           or evidence_content_type in ('application/pdf', 'image/png', 'image/jpeg')),
  -- What storage reported once the upload finished; null until then.
  add column evidence_size_bytes    integer
    check (evidence_size_bytes is null or evidence_size_bytes between 1 and 10485760),
  add column evidence_uploaded_at   timestamptz;

alter table core.company_claim_requests
  add constraint company_claim_requests_evidence_only_registry
    check (evidence_object_key is null or method = 'REGISTRY_DOCUMENT'),
  add constraint company_claim_requests_evidence_named
    check ((evidence_object_key is null)
           = (evidence_file_name is null and evidence_content_type is null)),
  add constraint company_claim_requests_evidence_observed
    check ((evidence_uploaded_at is null) = (evidence_size_bytes is null)
           and (evidence_uploaded_at is null or evidence_object_key is not null));

comment on column core.company_claim_requests.evidence_object_key is
  'REGISTRY_DOCUMENT only: the private storage key the server issued for the claimant''s registry document. Evidence for the decider; never a decision.';
