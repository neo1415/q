-- ADMIN-4 (founder direction 2026-10-02): one verification flow, "Verify you
-- and <organisation>". The organisation's details go to core.kyb_submissions
-- as before; the person's own identity details -- the name as on their ID,
-- their role and, if they choose, an ID document in the organisation's
-- evidence storage -- go here, against the person's identity claim
-- (FOUNDER_IDENTITY, subject PERSON). Both are submitted together and both
-- claims are created in one transaction. A Capital Q operator decides each
-- claim separately, with a reason. Verification is not endorsement and stays
-- its own axis (ADR-001).

create table core.identity_submissions (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references identity.tenants (id) on delete restrict,
  organisation_id       uuid not null,
  user_id               uuid not null references identity.user_profiles (id) on delete restrict,
  name_on_id            text not null check (length(btrim(name_on_id)) between 1 and 200),
  role                  text not null check (length(btrim(role)) between 1 and 120),
  document_id           uuid,
  claim_id              uuid not null,
  status                text not null default 'SUBMITTED' check (status in ('SUBMITTED', 'APPROVED', 'REJECTED')),
  decision_reason       text check (decision_reason is null or length(btrim(decision_reason)) between 3 and 1000),
  decided_by_user_id    uuid references identity.user_profiles (id) on delete restrict,
  decided_at            timestamptz,
  idempotency_key       text not null check (length(idempotency_key) between 8 and 200 and idempotency_key !~ '[[:cntrl:]]'),
  created_at            timestamptz not null default clock_timestamp(),
  unique (user_id, idempotency_key),
  check ((status = 'SUBMITTED') = (decided_at is null)),
  check (status = 'SUBMITTED' or (decision_reason is not null and decided_by_user_id is not null)),
  -- Nobody decides their own identity.
  check (decided_by_user_id is null or decided_by_user_id <> user_id),
  foreign key (organisation_id, tenant_id)
    references identity.tenant_organisations (organisation_id, tenant_id) on delete restrict,
  foreign key (document_id, tenant_id)
    references evidence.documents (id, tenant_id) on delete restrict,
  foreign key (claim_id, tenant_id)
    references evidence.verification_claims (id, tenant_id) on delete restrict
);

create index identity_submissions_claim_idx on core.identity_submissions (claim_id);
create index identity_submissions_user_idx on core.identity_submissions (user_id, created_at desc);
create unique index identity_submissions_one_open_idx
  on core.identity_submissions (organisation_id, user_id) where status = 'SUBMITTED';

comment on table core.identity_submissions is
  'The identity details a person sent for their own verification (name as on ID, role, optional ID document in evidence storage) and the person claim it requested. Read only by that person; decided once by a Capital Q operator.';

create trigger identity_submissions_decide_once
  before update or delete on core.identity_submissions
  for each row execute function private.decide_once_guard();

-- Only the person reads their own identity details -- not their colleagues.
alter table core.identity_submissions enable row level security;

create policy identity_submissions_select_own
  on core.identity_submissions for select to authenticated
  using (
    user_id = (select private.current_app_user_id())
    and (select private.is_organisation_member(organisation_id))
  );

revoke all on core.identity_submissions from public, anon, authenticated;
grant select on core.identity_submissions to authenticated;
grant select, insert, update on core.identity_submissions to postgres, service_role;
