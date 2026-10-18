-- ADMIN-3 (docs/specs/2026-10/admin-escalation-kyb.md): appeals Stage 4
-- human review (PADL #050/#051) and manual KYB (PADL progressive
-- verification, Spec 8.1, doc 15 §81).
--
-- Both tables are written by the server only and read by their owners
-- through RLS: a person reads their own review cases while an active member
-- of the tenant; an organisation's active members read its KYB submissions.
-- Each row is decided exactly once and never deleted (corrections are new
-- rows). A case holds a REFERENCE to what is under review, never a copy of
-- private data; a KYB submission points at the verification claim it
-- requested (verification_claims stays its own axis, ADR-001) and at an
-- evidence document, never at file bytes.

-- ---------------------------------------------------------------------------
-- Human review cases.
-- ---------------------------------------------------------------------------

create table core.human_reviews (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references identity.tenants (id) on delete restrict,
  organisation_id     uuid,
  requester_user_id   uuid not null references identity.user_profiles (id) on delete restrict,
  subject_type        text not null check (subject_type in (
                        'READINESS_ASSESSMENT', 'VERIFICATION_DECISION', 'ACCOUNT_ACTION',
                        'Q_ASSESSMENT', 'OTHER')),
  subject_ref         text check (subject_ref is null or subject_ref ~ '^[A-Za-z0-9_:.-]{1,200}$'),
  reason              text not null check (length(btrim(reason)) between 10 and 2000),
  source              text not null default 'APP' check (source in ('APP', 'Q')),
  q_action_id         uuid,
  status              text not null default 'OPEN' check (status in ('OPEN', 'DECIDED')),
  outcome             text check (outcome is null or outcome in ('UPHELD', 'CHANGED', 'NEEDS_EVIDENCE')),
  decision_reason     text check (decision_reason is null or length(btrim(decision_reason)) between 3 and 2000),
  decided_by_user_id  uuid references identity.user_profiles (id) on delete restrict,
  decided_at          timestamptz,
  due_at              timestamptz not null,
  idempotency_key     text not null check (length(idempotency_key) between 8 and 200 and idempotency_key !~ '[[:cntrl:]]'),
  created_at          timestamptz not null default clock_timestamp(),
  unique (requester_user_id, idempotency_key),
  check ((status = 'DECIDED') = (outcome is not null and decision_reason is not null
                                 and decided_by_user_id is not null and decided_at is not null)),
  check (decided_by_user_id is null or decided_by_user_id <> requester_user_id),
  check (due_at > created_at),
  check ((source = 'Q') = (q_action_id is not null)),
  foreign key (organisation_id, tenant_id)
    references identity.tenant_organisations (organisation_id, tenant_id) on delete restrict
);

create index human_reviews_requester_idx on core.human_reviews (requester_user_id, created_at desc);
create index human_reviews_open_idx on core.human_reviews (due_at) where status = 'OPEN';

comment on table core.human_reviews is
  'Appeals Stage 4 (PADL #050): a person asks for a human review of a Capital Q or Q decision. Reference only, never a copy of private data. Decided once by a Capital Q operator; console audit in platform_ops.admin_actions.';

-- ---------------------------------------------------------------------------
-- KYB submissions (manual review for V1).
-- ---------------------------------------------------------------------------

create table core.kyb_submissions (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references identity.tenants (id) on delete restrict,
  organisation_id       uuid not null,
  submitted_by_user_id  uuid not null references identity.user_profiles (id) on delete restrict,
  legal_name            text not null check (length(btrim(legal_name)) between 1 and 300),
  registration_number   text not null check (length(btrim(registration_number)) between 1 and 100),
  jurisdiction_code     text not null check (jurisdiction_code ~ '^[A-Z]{2}$'),
  registered_address    text check (registered_address is null or length(btrim(registered_address)) between 1 and 500),
  website_url           text check (website_url is null or (website_url ~ '^https?://' and length(website_url) <= 500)),
  document_id           uuid,
  claim_id              uuid not null,
  provider              text not null default 'CAPITAL_Q_OPERATOR' check (provider in ('CAPITAL_Q_OPERATOR')),
  status                text not null default 'SUBMITTED' check (status in ('SUBMITTED', 'APPROVED', 'REJECTED')),
  decision_reason       text check (decision_reason is null or length(btrim(decision_reason)) between 3 and 1000),
  decided_by_user_id    uuid references identity.user_profiles (id) on delete restrict,
  decided_at            timestamptz,
  idempotency_key       text not null check (length(idempotency_key) between 8 and 200 and idempotency_key !~ '[[:cntrl:]]'),
  created_at            timestamptz not null default clock_timestamp(),
  unique (organisation_id, idempotency_key),
  check ((status = 'SUBMITTED') = (decided_at is null)),
  check (status = 'SUBMITTED' or (decision_reason is not null and decided_by_user_id is not null)),
  check (decided_by_user_id is null or decided_by_user_id <> submitted_by_user_id),
  foreign key (organisation_id, tenant_id)
    references identity.tenant_organisations (organisation_id, tenant_id) on delete restrict,
  foreign key (document_id, tenant_id)
    references evidence.documents (id, tenant_id) on delete restrict,
  foreign key (claim_id, tenant_id)
    references evidence.verification_claims (id, tenant_id) on delete restrict
);

create index kyb_submissions_org_idx on core.kyb_submissions (organisation_id, created_at desc);
create index kyb_submissions_claim_idx on core.kyb_submissions (claim_id);
create unique index kyb_submissions_one_open_idx
  on core.kyb_submissions (organisation_id) where status = 'SUBMITTED';

comment on table core.kyb_submissions is
  'Manual KYB (V1): the business details an organisation submitted for Organisation Verified, the evidence document it pointed at, and the ORGANISATION verification claim it requested. Verification is not endorsement.';

-- ---------------------------------------------------------------------------
-- Decided once, never deleted.
-- ---------------------------------------------------------------------------

create or replace function private.decide_once_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception '%.% rows are never deleted', tg_table_schema, tg_table_name
      using errcode = 'restrict_violation';
  end if;
  if (to_jsonb(old) ->> 'status') not in ('OPEN', 'SUBMITTED')
     or (to_jsonb(new) - array['status', 'outcome', 'decision_reason',
                               'decided_by_user_id', 'decided_at'])
        <> (to_jsonb(old) - array['status', 'outcome', 'decision_reason',
                                  'decided_by_user_id', 'decided_at']) then
    raise exception '%.% is decided once; only the decision may be written', tg_table_schema, tg_table_name
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

revoke all on function private.decide_once_guard() from public, anon, authenticated;

create trigger human_reviews_decide_once
  before update or delete on core.human_reviews
  for each row execute function private.decide_once_guard();
create trigger kyb_submissions_decide_once
  before update or delete on core.kyb_submissions
  for each row execute function private.decide_once_guard();

-- ---------------------------------------------------------------------------
-- Protection: owners read through RLS; only the server writes.
-- ---------------------------------------------------------------------------

alter table core.human_reviews enable row level security;
alter table core.kyb_submissions enable row level security;

create policy human_reviews_select_own
  on core.human_reviews for select to authenticated
  using (
    requester_user_id = (select private.current_app_user_id())
    and (select private.is_tenant_member(tenant_id))
  );

create policy kyb_submissions_select_members
  on core.kyb_submissions for select to authenticated
  using ((select private.is_organisation_member(organisation_id)));

revoke all on core.human_reviews from public, anon, authenticated;
revoke all on core.kyb_submissions from public, anon, authenticated;
grant select on core.human_reviews to authenticated;
grant select on core.kyb_submissions to authenticated;
grant select, insert, update on core.human_reviews to postgres, service_role;
grant select, insert, update on core.kyb_submissions to postgres, service_role;

-- ---------------------------------------------------------------------------
-- Notices for decisions.
-- ---------------------------------------------------------------------------

alter table communication.notifications
  drop constraint notifications_kind_check,
  add constraint notifications_kind_check
    check (kind in ('REMINDER', 'MEETING_SCHEDULED', 'MEETING_CANCELLED', 'MEETING_PREP_READY',
                    'MEETING_NOTES_READY', 'Q_SCOUT', 'Q_ERRAND', 'MEETING_RECORDING_DECLINED',
                    'COMMITMENT_DETECTED', 'ACCOUNT_PAUSED', 'Q_WORK', 'Q_STAND_IN',
                    'INTEREST_RECEIVED', 'CONNECTION_REQUESTED', 'Q_MESSAGE', 'TIME_PROPOSED',
                    'HUMAN_REVIEW', 'VERIFICATION_DECIDED'));
