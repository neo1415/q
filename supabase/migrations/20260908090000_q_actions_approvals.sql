-- CQ-Q-008 · Approval Engine + Consequential Action Authority: the durable
-- Q action proposal and the human approval bound to it (doc 12 §29-§32;
-- doc 13 §48; doc 15 §50, §53; doc 22 §79-§82; SEC-021, QTA-012, DDA-027).
--
--   Q proposal        ≠ approval
--   approval          ≠ permission
--   permission        ≠ execution
--   execution request ≠ successful outcome
--   model statement   ≠ execution status
--
-- An action row is the exact consequence Q proposed: type, version, class,
-- targets and the material payload, fingerprinted with a canonical SHA-256
-- (proposed_payload_hash). An approval row is a person's decision about
-- exactly that fingerprint (approval_payload_hash). Execution re-verifies
-- both before anything happens and is claimed atomically so a retry, a
-- graph replay or a second worker cannot produce a second side effect.
-- Nothing here is Q memory, nothing here is chain-of-thought, and no
-- credential of any kind has a column.

-- ---------------------------------------------------------------------------
-- q_runtime.actions  (doc 13 §48.1)
-- ---------------------------------------------------------------------------

create table q_runtime.actions (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references identity.tenants (id) on delete restrict,
  run_id                 uuid not null,
  -- The organisation context the action is taken FOR, captured at proposal
  -- and never re-derived. Context, not authority.
  organisation_id        uuid,
  -- The person whose run proposed it. Resolved server-side; never a request field.
  proposed_by_user_id    uuid not null references identity.user_profiles (id) on delete restrict,

  -- QActionType and the registered definition's version. The version is part
  -- of the approval binding: send-email/v2 is not approved by a v1 approval.
  action_type            text not null check (action_type ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'
                                              and length(action_type) <= 128),
  action_version         integer not null check (action_version >= 1),
  -- QActionClass, minus PROHIBITED: a prohibited action is never proposed,
  -- so it never has a row an approval could attach to.
  risk_class             text not null check (risk_class in (
                           'SAFE_READ', 'LOW_RISK_INTERNAL', 'PREPARE_ONLY', 'CONFIRM_REQUIRED', 'RESTRICTED')),
  -- Typed canonical subject references (QSubjectRef[]), validated by the
  -- application. Part of the binding: another recipient is another action.
  target_refs            jsonb not null
                           check (jsonb_typeof(target_refs) = 'array'
                              and jsonb_array_length(target_refs) between 1 and 20
                              and length(target_refs::text) <= 4096),
  -- The exact material payload, as the registered definition's schema
  -- accepted it. Sensitive business content: server-only, bounded, never
  -- logged, never copied into audit metadata.
  proposed_payload       jsonb not null
                           check (jsonb_typeof(proposed_payload) = 'object'
                              and length(proposed_payload::text) <= 65536),
  -- sha256 over the canonical binding envelope (QActionBindingEnvelope).
  proposed_payload_hash  text not null check (proposed_payload_hash ~ '^sha256:[0-9a-f]{64}$'),
  -- Plain language for the approver. Presentation only; never the binding.
  summary                text not null check (length(summary) between 1 and 1000),
  preview                text check (preview is null or length(preview) <= 4000),

  -- QActionStatus, exactly. Set only through the q-actions lifecycle policy.
  status                 text not null default 'PROPOSED' check (status in (
                           'PROPOSED', 'AWAITING_APPROVAL', 'APPROVED', 'EXECUTING', 'EXECUTED',
                           'FAILED', 'RECONCILIATION_REQUIRED', 'REJECTED', 'EXPIRED', 'WITHDRAWN')),
  -- Capital Q's own execution identity (doc 12 §32): q_action:<run_id>:<action_id>.
  -- Server-generated; a provider's idempotency key may supplement it later.
  idempotency_key        text not null check (idempotency_key ~ '^q_action:[0-9a-f-]{36}:[0-9a-f-]{36}$'),

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  -- Set exactly when the executor reported success, and only then.
  executed_at            timestamptz,
  -- The executor's bounded, normalised result. Never a provider response,
  -- a token or a header.
  execution_result       jsonb check (execution_result is null
                                     or (jsonb_typeof(execution_result) = 'object'
                                         and length(execution_result::text) <= 16384)),
  -- Stable UPPER_SNAKE_CASE code when execution ended without success.
  failure_code           text check (failure_code is null
                                     or (failure_code ~ '^[A-Z][A-Z0-9_]*$' and length(failure_code) <= 64)),
  -- Whether a definite failure may be retried under the same approval.
  retry_permitted        boolean not null default false,
  -- How many times execution was claimed. Bounded by policy, counted here.
  execution_attempts     integer not null default 0 check (execution_attempts >= 0),
  -- Optimistic concurrency for lifecycle moves.
  version                integer not null default 1 check (version >= 1),

  constraint actions_executed_state_check
    check ((executed_at is not null) = (status = 'EXECUTED')),
  constraint actions_failure_state_check
    check ((status in ('FAILED', 'RECONCILIATION_REQUIRED')) = (failure_code is not null)),
  constraint actions_result_state_check
    check (execution_result is null or status in ('EXECUTED', 'FAILED', 'RECONCILIATION_REQUIRED')),
  constraint actions_time_order_check
    check (executed_at is null or executed_at >= created_at),
  constraint actions_idempotency_key_unique unique (idempotency_key),
  foreign key (run_id, tenant_id)
    references q_runtime.runs (id, tenant_id) on delete restrict,
  foreign key (organisation_id, tenant_id)
    references identity.tenant_organisations (organisation_id, tenant_id) on delete restrict,
  unique (id, tenant_id)
);

comment on table q_runtime.actions is
  'A consequential action Q PROPOSED (doc 13 §48.1). status is QActionStatus, moved only by the q-actions lifecycle policy. proposed_payload_hash fingerprints the canonical binding envelope; an approval binds to it and execution re-verifies it. Never Q memory, never chain-of-thought, never a credential.';
comment on column q_runtime.actions.proposed_payload is
  'The exact material payload as accepted by the registered definition. Sensitive; server-only; never logged or audited in full.';
comment on column q_runtime.actions.proposed_payload_hash is
  'sha256 over the canonical JSON of the QActionBindingEnvelope (type, version, class, targets, payload, tenant, organisation, run, action). Internal integrity fingerprint; not a public field.';
comment on column q_runtime.actions.idempotency_key is
  'Capital Q-owned execution identity q_action:<run_id>:<action_id>. Uniqueness is what makes a retried claim a no-op.';

create index actions_tenant_run_idx
  on q_runtime.actions (tenant_id, run_id, created_at desc);
-- Live actions for approval and execution processing.
create index actions_live_idx
  on q_runtime.actions (status, created_at)
  where status in ('AWAITING_APPROVAL', 'APPROVED', 'EXECUTING', 'FAILED');

create trigger set_updated_at
  before update on q_runtime.actions
  for each row execute function private.set_updated_at();

alter table q_runtime.actions enable row level security;

-- ---------------------------------------------------------------------------
-- q_runtime.approvals  (doc 13 §48.2)
--
-- One row per approval REQUEST. A decision is recorded on the row that was
-- requested, with who decided and when; nothing is overwritten into a
-- different decision. A replaced or cancelled request is REVOKED, a lapsed
-- one EXPIRED. Knowing an approval id grants nothing: the q-actions
-- service resolves the actor and their authority on every read and write.
-- ---------------------------------------------------------------------------

create table q_runtime.approvals (
  id                       uuid primary key default gen_random_uuid(),
  tenant_id                uuid not null references identity.tenants (id) on delete restrict,
  action_id                uuid not null,
  -- The person the decision is requested from. Only they (or a policy-named
  -- approver, none in V1) may decide; the same-tenant colleague may not.
  requested_from_user_id   uuid not null references identity.user_profiles (id) on delete restrict,
  -- QApprovalStatus, exactly.
  status                   text not null default 'PENDING' check (status in (
                             'PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'REVOKED')),
  requested_at             timestamptz not null default now(),
  -- Every approval expires (doc 12 §31.1). Correctness is the comparison
  -- against this column at read, decision and execution time, not a job.
  expires_at               timestamptz not null,
  approved_at              timestamptz,
  -- Who actually decided. Never inferred from requested_from_user_id.
  approved_by_user_id      uuid references identity.user_profiles (id) on delete restrict,
  rejected_at              timestamptz,
  rejected_by_user_id      uuid references identity.user_profiles (id) on delete restrict,
  rejection_reason         text check (rejection_reason is null or length(rejection_reason) <= 500),
  revoked_at               timestamptz,
  -- NULL when the system revoked it (run cancelled, proposal replaced).
  revoked_by_user_id       uuid references identity.user_profiles (id) on delete restrict,
  -- The fingerprint the approver approved: recomputed from the persisted
  -- action at decision time and stored here so execution can prove
  -- proposed = approved = executed.
  approval_payload_hash    text check (approval_payload_hash is null
                                       or approval_payload_hash ~ '^sha256:[0-9a-f]{64}$'),
  version                  integer not null default 1 check (version >= 1),

  constraint approvals_expiry_after_request_check check (expires_at > requested_at),
  -- Status and its evidence agree by construction: a decision always says
  -- who and when; a pending request carries no decision at all.
  constraint approvals_status_evidence_check check (
       (status = 'PENDING'  and approved_at is null and approved_by_user_id is null
                            and rejected_at is null and rejected_by_user_id is null
                            and revoked_at is null and approval_payload_hash is null)
    or (status = 'APPROVED' and approved_at is not null and approved_by_user_id is not null
                            and approval_payload_hash is not null
                            and rejected_at is null and revoked_at is null)
    or (status = 'REJECTED' and rejected_at is not null and rejected_by_user_id is not null
                            and approved_at is null and revoked_at is null)
    or (status = 'EXPIRED'  and approved_at is null and rejected_at is null and revoked_at is null)
    or (status = 'REVOKED'  and revoked_at is not null and approved_at is null and rejected_at is null)),
  foreign key (action_id, tenant_id)
    references q_runtime.actions (id, tenant_id) on delete restrict,
  unique (id, tenant_id)
);

comment on table q_runtime.approvals is
  'A human decision request bound to one q_runtime.actions row (doc 13 §48.2). status is QApprovalStatus. approval_payload_hash is the fingerprint the approver approved; execution requires it to equal the action''s proposed_payload_hash and the recomputed hash. Server-only; an approval id is never a bearer token.';

-- At most one open request per action: two pending approvals for one
-- consequence would be two chances to approve it.
create unique index approvals_one_pending_per_action_idx
  on q_runtime.approvals (action_id)
  where status = 'PENDING';
create index approvals_action_idx
  on q_runtime.approvals (action_id, requested_at desc);
create index approvals_requested_from_idx
  on q_runtime.approvals (tenant_id, requested_from_user_id, status, expires_at);

alter table q_runtime.approvals enable row level security;

-- No policies and no client grants on either table: the Q API is the
-- application boundary. A browser never reads an action or approval row,
-- and the privileged server connection still passes every read and write
-- through ActorContext and the q-actions authority checks. DB privilege ≠
-- business authorisation.

-- ---------------------------------------------------------------------------
-- q.action.approve: the capability an approver must hold in the action's
-- organisation. Both V1 role templates receive it — a person approves Q's
-- work on their own behalf — while the action's own capability and resource
-- checks (document.share, meeting.schedule, …) stay separate: approval never
-- creates a permission the person does not already hold.
-- ---------------------------------------------------------------------------

insert into permissions.role_capabilities (role_id, capability_id, effect)
select r.id, c.id, 'ALLOW'
  from permissions.roles r
  join permissions.capabilities c
    on (r.code, c.code) in (
      ('organisation_admin',  'q.action.approve'),
      ('organisation_member', 'q.action.approve')
    )
on conflict (role_id, capability_id) do nothing;
