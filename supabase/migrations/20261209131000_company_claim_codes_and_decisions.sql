-- P14 (2026-10-06): claiming a company, finished.
--
--   a claim request ≠ a membership; only a recorded decision makes one
--   a work-email code proves the address, never the claim by itself
--
-- A WORK_EMAIL claim gets a one-time code by email: only its SHA-256 is
-- kept, it expires, and attempts are bounded. A decision names who made it
-- and by which authority: a member (admin or owner) of a company that
-- already has members, or a platform admin for a company nobody has
-- claimed. Still server-only: RLS on, no policy, no browser grant.

alter table core.company_claim_requests
  add column code_hash text
    check (code_hash is null or code_hash ~ '^[0-9a-f]{64}$'),
  add column code_expires_at timestamptz,
  add column code_attempts integer not null default 0
    check (code_attempts between 0 and 10),
  add column email_confirmed_at timestamptz,
  add column decided_by_user_id uuid references identity.user_profiles (id) on delete restrict,
  add column decided_via text
    check (decided_via is null or decided_via in ('COMPANY_MEMBER', 'PLATFORM_ADMIN')),
  add column decision_reason text
    check (decision_reason is null or length(btrim(decision_reason)) between 1 and 500),
  -- A code belongs to a work-email claim, and comes with its expiry.
  add constraint company_claim_requests_code_for_email
    check (code_hash is null or (method = 'WORK_EMAIL' and code_expires_at is not null)),
  add constraint company_claim_requests_confirmed_email
    check (email_confirmed_at is null or method = 'WORK_EMAIL'),
  -- An approval or a refusal names who decided and by which authority;
  -- a withdrawal (the requester's own) names neither.
  add constraint company_claim_requests_decider
    check (
      (status in ('APPROVED', 'DECLINED')) =
      (decided_by_user_id is not null and decided_via is not null)
    );

comment on column core.company_claim_requests.code_hash is
  'P14: SHA-256 (hex) of the one-time code emailed to work_email. The code itself is never stored.';
comment on column core.company_claim_requests.decided_via is
  'P14: COMPANY_MEMBER (an admin or owner of a company with members) or PLATFORM_ADMIN (a company nobody has claimed).';

create index company_claim_requests_pending_idx
  on core.company_claim_requests (company_id, created_at)
  where status = 'PENDING';
