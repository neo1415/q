-- CQ-VERIFY-001 · Verification claims: Capital Q's own record of what it has
-- verified about a person, an organisation or a domain (doc 13 §24; ADR-001
-- "verification_claims is a separate workflow"; doc 25 §62/§137 preserve the
-- state contract while the provider is deferred).
--
--   Verification ≠ Endorsement        Evidence ≠ Verification
--   Q inference ≠ Verification        a founder saying so ≠ Verification
--   truth_class / evidence_status / lifecycle_status are NOT touched here
--
-- Claim-specific by design (doc 13 §24: never one `is_verified = true`): a
-- founder's identity, an organisation and a domain are three different
-- claims with three different lifecycles, and marketplace readiness reads
-- two of them as two separate requirements.
--
-- Append-oriented: a row is written once and never updated or deleted. A
-- decision is a NEW row that names the request it answers; an expiry or a
-- revocation is a new row too. The current standing of a subject is the
-- highest revision for (tenant, claim type, subject). Nothing here is a
-- status column somebody flips.
--
-- Capital Q holds integrity authority: the founder can REQUEST, and only a
-- decision method Capital Q itself operates can VERIFY. Two methods exist
-- in this release, both deterministic, both recorded as provenance:
--
--   SYNTHETIC_DEMO_ATTESTATION  a worker job on a deployment that carries the
--                               synthetic-demo attestation (doc 15 §62; the
--                               same allowance the model gateway checks), for
--                               principals whose auth account is marked
--                               synthetic. Refused anywhere else.
--   OPERATOR_DECISION           a named operator, through a privileged route.
--                               No operator principal exists yet, so no row
--                               can carry this method until one does; the
--                               vocabulary is reserved so the row shape does
--                               not change when it arrives.
--
-- No LLM anywhere in this path.

-- ---------------------------------------------------------------------------
-- evidence.verification_claims
-- ---------------------------------------------------------------------------

create table evidence.verification_claims (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references identity.tenants (id) on delete restrict,
  -- The organisation accountable for the subject: the founder's organisation
  -- for a FOUNDER_IDENTITY claim about one of its members, the organisation
  -- itself for an ORGANISATION claim, the organisation asserting control of
  -- a domain for DOMAIN_CONTROL. Resolved by the server, never supplied.
  organisation_id        uuid not null,

  -- Doc 13 §24 calls this verification_type; the packet vocabulary is the
  -- three claims Capital Q can make in this release.
  claim_type             text not null check (claim_type in (
                           'FOUNDER_IDENTITY', 'ORGANISATION', 'DOMAIN_CONTROL')),

  -- Bounded, typed subject. A person and an organisation are identified by
  -- their canonical ids; a domain by its lower-case hostname. Exactly one
  -- of subject_id / subject_domain is set, and which one follows the type.
  subject_type           text not null check (subject_type in ('PERSON', 'ORGANISATION', 'DOMAIN')),
  subject_id             uuid,
  subject_domain         text check (subject_domain is null or
                           (subject_domain = lower(subject_domain)
                            and length(subject_domain) between 1 and 253
                            and subject_domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$')),
  -- One key for uniqueness and lookup across both subject forms.
  subject_key            text generated always as (coalesce(subject_id::text, subject_domain)) stored,

  -- The standing this row asserts. PENDING is a request; the other three
  -- are Capital Q's decisions. A row never moves between them.
  status                 text not null check (status in ('PENDING', 'VERIFIED', 'EXPIRED', 'REVOKED')),
  -- Monotonic per subject and claim type; the highest revision is current.
  revision               integer not null check (revision >= 1),
  -- The request a decision answers, when it answers one. A revocation or an
  -- expiry names the VERIFIED row it ends.
  decides_claim_id       uuid references evidence.verification_claims (id) on delete restrict,

  -- Provenance: how Capital Q decided, who or what did, and when. Null on a
  -- request; required on every decision. `provider` is the deciding party
  -- in doc 13's terms; there is no external provider in this release.
  method                 text check (method is null or method in (
                           'SYNTHETIC_DEMO_ATTESTATION', 'OPERATOR_DECISION')),
  provider               text check (provider is null or provider in (
                           'CAPITAL_Q_SYNTHETIC_DEMO', 'CAPITAL_Q_OPERATOR')),
  provider_reference     text check (provider_reference is null or
                           length(btrim(provider_reference)) between 1 and 256),
  -- What the deciding party checked, as short attestation lines
  -- ("operator opted in; environment local; database host 127.0.0.1").
  -- Prose for the audit reader, never a rule anything re-evaluates.
  decision_basis         text check (decision_basis is null or
                           length(btrim(decision_basis)) between 1 and 1000),
  decided_by_actor_type  text check (decided_by_actor_type is null or
                           decided_by_actor_type in ('HUMAN', 'SYSTEM')),
  -- Doc 13's reviewed_by_user_id: the operator, when a human decided.
  decided_by_user_id     uuid references identity.user_profiles (id) on delete restrict,
  decided_at             timestamptz,
  -- Optional evidence behind a decision (doc 13 evidence_source_id). Not a
  -- document a founder uploaded: a founder's document is evidence, never
  -- verification.
  evidence_source_id     uuid,

  requested_by_user_id   uuid not null references identity.user_profiles (id) on delete restrict,
  verified_at            timestamptz,
  expires_at             timestamptz,
  revoked_at             timestamptz,
  revocation_reason      text check (revocation_reason is null or
                           length(btrim(revocation_reason)) between 1 and 500),
  created_at             timestamptz not null default now(),

  -- The subject form follows the subject type.
  constraint verification_claims_subject_form_check
    check ((subject_type = 'DOMAIN' and subject_id is null and subject_domain is not null)
        or (subject_type <> 'DOMAIN' and subject_id is not null and subject_domain is null)),
  -- The subject type follows the claim type.
  -- Named explicitly: Postgres gives the inline check on the subject_type
  -- column the name verification_claims_subject_type_check itself.
  constraint verification_claims_subject_follows_claim_check
    check ((claim_type = 'FOUNDER_IDENTITY' and subject_type = 'PERSON')
        or (claim_type = 'ORGANISATION' and subject_type = 'ORGANISATION')
        or (claim_type = 'DOMAIN_CONTROL' and subject_type = 'DOMAIN')),
  -- A request carries no decision; a decision carries all of one.
  constraint verification_claims_provenance_check
    check ((status = 'PENDING'
            and method is null and provider is null and decision_basis is null
            and decided_by_actor_type is null and decided_by_user_id is null
            and decided_at is null and verified_at is null and revoked_at is null
            and revocation_reason is null)
        or (status <> 'PENDING'
            and method is not null and provider is not null and decision_basis is not null
            and decided_by_actor_type is not null and decided_at is not null)),
  -- Method and provider name the same party.
  constraint verification_claims_method_provider_check
    check (method is null
        or (method = 'SYNTHETIC_DEMO_ATTESTATION' and provider = 'CAPITAL_Q_SYNTHETIC_DEMO')
        or (method = 'OPERATOR_DECISION' and provider = 'CAPITAL_Q_OPERATOR')),
  -- A synthetic attestation is the system deciding; an operator decision is
  -- a named human deciding.
  constraint verification_claims_decider_check
    check (method is null
        or (method = 'SYNTHETIC_DEMO_ATTESTATION' and decided_by_actor_type = 'SYSTEM' and decided_by_user_id is null)
        or (method = 'OPERATOR_DECISION' and decided_by_actor_type = 'HUMAN' and decided_by_user_id is not null)),
  -- Timestamps cannot disagree with the status they describe.
  constraint verification_claims_status_times_check
    check ((status = 'VERIFIED') = (verified_at is not null)
       and (status = 'REVOKED') = (revoked_at is not null)
       and (revocation_reason is null or status = 'REVOKED')),
  -- A row never decides itself.
  constraint verification_claims_decides_check
    check (decides_claim_id is null or decides_claim_id <> id),

  foreign key (organisation_id, tenant_id)
    references identity.tenant_organisations (organisation_id, tenant_id) on delete restrict,
  foreign key (evidence_source_id, tenant_id)
    references evidence.sources (id, tenant_id) on delete restrict,
  -- Lets dependants reference (claim, tenant) as a pair.
  unique (id, tenant_id)
);

comment on table evidence.verification_claims is
  'Claim-specific verification standings decided by Capital Q. Append-only: a request, a decision, an expiry and a revocation are each a row; the highest revision per (tenant, claim type, subject) is current. Never a founder''s statement, never a document, never Q inference, never one is_verified flag.';
comment on column evidence.verification_claims.method is
  'How Capital Q decided. SYNTHETIC_DEMO_ATTESTATION is honoured only on a deployment carrying the synthetic-demo attestation and for synthetic principals; it is visible as such in every readiness readout.';
comment on column evidence.verification_claims.decision_basis is
  'The conditions the deciding party checked, for the audit reader. Prose, never re-evaluated.';
comment on column evidence.verification_claims.revision is
  'Monotonic per (tenant_id, claim_type, subject_key). The highest revision is the current standing; two concurrent writers collide on the unique index instead of both winning.';

-- The append order per subject, and the uniqueness that makes "current"
-- well defined under concurrency.
create unique index verification_claims_revision_idx
  on evidence.verification_claims (tenant_id, claim_type, subject_key, revision desc);

-- The standings marketplace readiness reads, per organisation.
create index verification_claims_organisation_idx
  on evidence.verification_claims (tenant_id, organisation_id, claim_type, created_at desc);

-- Requests awaiting a decision, for the deciding job.
create index verification_claims_pending_idx
  on evidence.verification_claims (created_at)
  where status = 'PENDING';

-- ---------------------------------------------------------------------------
-- Immutability: a verification row is history the moment it exists.
-- ---------------------------------------------------------------------------

create function evidence.protect_verification_claims()
returns trigger
language plpgsql
as $$
begin
  raise exception 'evidence.verification_claims is append-only; write a new revision instead'
    using errcode = 'restrict_violation';
end;
$$;

revoke all on function evidence.protect_verification_claims() from public;

create trigger verification_claims_append_only
  before update or delete on evidence.verification_claims
  for each row execute function evidence.protect_verification_claims();

-- ---------------------------------------------------------------------------
-- Server-only: RLS on, no policy, no browser grant (as gateq.*, media.*).
-- The API reads standings and writes requests under an ActorContext; the
-- worker writes decisions under the deployment's attestation. Nothing in a
-- browser ever holds a row.
-- ---------------------------------------------------------------------------

alter table evidence.verification_claims enable row level security;
revoke all on evidence.verification_claims from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Capabilities (production reference data; mirror in supabase/seed.sql).
--
-- Requesting verification is an act on the company's behalf; deciding it is
-- never a member capability. `verification.decide` is deliberately granted
-- to no role: the operator principal that would hold it does not exist yet
-- (see docs/escalations/verify-001/operator-decision.md).
-- ---------------------------------------------------------------------------

insert into permissions.capabilities (code, description) values
  ('verification.request', 'Ask Capital Q to verify a founder''s identity and the organisation, for the active organisation''s company.'),
  ('verification.view',    'Read the verification standings of the active organisation and its members.'),
  ('verification.decide',  'Decide a verification claim on Capital Q''s behalf. Operator only; granted to no organisation role.')
on conflict (code) do update
  set description = excluded.description;

insert into permissions.role_capabilities (role_id, capability_id, effect)
select r.id, c.id, 'ALLOW'
  from permissions.roles r
  join permissions.capabilities c
    on (r.code, c.code) in (
      ('organisation_admin',  'verification.request'),
      ('organisation_admin',  'verification.view'),
      ('organisation_member', 'verification.request'),
      ('organisation_member', 'verification.view')
    )
on conflict (role_id, capability_id) do nothing;
