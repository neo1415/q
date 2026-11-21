-- V1 · Business verification foundations (decision 113;
-- docs/research/2026-11-20-business-verification.md §6.2).
--
-- Widening only. The decision vocabulary on evidence.verification_claims and
-- the provider on core.kyb_submissions gain the real providers and the
-- methods they decide by. Checked text columns, reference values, never
-- Postgres enums. Every existing value, pairing and row stays valid; no
-- column, grant, policy or row changes.
--
--   providers  DOJAH            Africa (KYB in NG, KE, ZA; BVN/NIN ID + selfie)
--              COMPANIES_HOUSE  UK registry (company, officers, PSCs)
--              SUMSUB           rest of the world (applicant, KYB, ID)
--              CAPITAL_Q_EMAIL_CODE  Capital Q's own work-email code
--   methods    REGISTRY_LOOKUP  the company is on the register, active
--              ID_SELFIE        a government ID plus a live selfie
--              DIRECTOR_MATCH   the verified name is an officer or owner
--              BANK_NAME_MATCH  the account name is the legal name
--              DOMAIN_EMAIL     a code sent to an address on the domain
--
-- Method and provider still name the same party, and every new method is
-- the system deciding (decided_by_actor_type SYSTEM, no user): a mismatch
-- is never decided by a provider; it goes to a person (core.human_reviews)
-- and, decided there, is an OPERATOR_DECISION as before.

alter table evidence.verification_claims
  drop constraint verification_claims_method_check,
  add constraint verification_claims_method_check
    check (method is null or method in (
      'SYNTHETIC_DEMO_ATTESTATION', 'OPERATOR_DECISION',
      'REGISTRY_LOOKUP', 'ID_SELFIE', 'DIRECTOR_MATCH', 'BANK_NAME_MATCH',
      'DOMAIN_EMAIL')),
  drop constraint verification_claims_provider_check,
  add constraint verification_claims_provider_check
    check (provider is null or provider in (
      'CAPITAL_Q_SYNTHETIC_DEMO', 'CAPITAL_Q_OPERATOR',
      'DOJAH', 'COMPANIES_HOUSE', 'SUMSUB', 'CAPITAL_Q_EMAIL_CODE')),
  drop constraint verification_claims_method_provider_check,
  add constraint verification_claims_method_provider_check
    check (method is null
        or (method = 'SYNTHETIC_DEMO_ATTESTATION' and provider = 'CAPITAL_Q_SYNTHETIC_DEMO')
        or (method = 'OPERATOR_DECISION' and provider = 'CAPITAL_Q_OPERATOR')
        or (method = 'REGISTRY_LOOKUP' and provider in ('DOJAH', 'COMPANIES_HOUSE', 'SUMSUB'))
        or (method = 'ID_SELFIE' and provider in ('DOJAH', 'SUMSUB'))
        or (method = 'DIRECTOR_MATCH' and provider in ('DOJAH', 'COMPANIES_HOUSE', 'SUMSUB'))
        or (method = 'BANK_NAME_MATCH' and provider = 'DOJAH')
        or (method = 'DOMAIN_EMAIL' and provider = 'CAPITAL_Q_EMAIL_CODE')),
  drop constraint verification_claims_decider_check,
  add constraint verification_claims_decider_check
    check (method is null
        or (method = 'SYNTHETIC_DEMO_ATTESTATION' and decided_by_actor_type = 'SYSTEM' and decided_by_user_id is null)
        or (method = 'OPERATOR_DECISION' and decided_by_actor_type = 'HUMAN' and decided_by_user_id is not null)
        or (method in ('REGISTRY_LOOKUP', 'ID_SELFIE', 'DIRECTOR_MATCH', 'BANK_NAME_MATCH', 'DOMAIN_EMAIL')
            and decided_by_actor_type = 'SYSTEM' and decided_by_user_id is null));

alter table core.kyb_submissions
  drop constraint kyb_submissions_provider_check,
  add constraint kyb_submissions_provider_check
    check (provider in ('CAPITAL_Q_OPERATOR', 'DOJAH', 'COMPANIES_HOUSE', 'SUMSUB'));

-- ---------------------------------------------------------------------------
-- Biometric consent (owner-approved addition, 21 Nov 2026). Before any ID
-- document or live selfie is sent to a provider, the person's explicit
-- consent is recorded here, linked to their identity claim (Nigeria Data
-- Protection Act 2023: biometric data is sensitive and needs explicit
-- consent). A row of its own, not a claim column: claims are decisions,
-- consent is the person's act, and the subject alone may read it.
--
-- Append-only. Read only by the person it belongs to (through the API) and
-- by operators (through the privileged console); never by colleagues,
-- investors or another tenant. No client reads or writes it directly.
-- ---------------------------------------------------------------------------

create table evidence.verification_consents (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references identity.tenants (id) on delete restrict,
  organisation_id  uuid not null,
  claim_id         uuid not null,
  subject_user_id  uuid not null references identity.user_profiles (id) on delete restrict,
  consent_scope    text not null check (consent_scope in ('BIOMETRIC_ID_SELFIE')),
  consent_version  text not null check (consent_version ~ '^biometric-consent-v[0-9]{1,4}$'),
  consent_given_at timestamptz not null,
  created_at       timestamptz not null default clock_timestamp(),
  -- Given before it is recorded, and never in the future of the record.
  check (consent_given_at <= created_at + interval '5 minutes'),
  unique (claim_id, consent_scope, consent_version),
  foreign key (organisation_id, tenant_id)
    references identity.tenant_organisations (organisation_id, tenant_id) on delete restrict,
  foreign key (claim_id, tenant_id)
    references evidence.verification_claims (id, tenant_id) on delete restrict
);

create index verification_consents_subject_idx
  on evidence.verification_consents (subject_user_id, created_at desc);

comment on table evidence.verification_consents is
  'A person''s explicit consent to a biometric check (ID document and live selfie), with the version of the words they agreed to, linked to their identity claim. Append-only; read only by that person and the server.';

create function evidence.protect_verification_consents()
returns trigger
language plpgsql
as $$
begin
  raise exception 'evidence.verification_consents is append-only'
    using errcode = 'restrict_violation';
end;
$$;

revoke all on function evidence.protect_verification_consents() from public;

create trigger verification_consents_append_only
  before update or delete on evidence.verification_consents
  for each row execute function evidence.protect_verification_consents();

-- Server-only, like evidence.verification_claims (RLS on, no policy, no
-- browser grant; the schema guard holds server-only tables to that): the
-- API reads a person's own consent under their ActorContext with the
-- subject in the predicate, and operators read it through the privileged
-- console. No browser session, of any tenant or role, reads a row.
alter table evidence.verification_consents enable row level security;
revoke all on evidence.verification_consents from public, anon, authenticated;
grant select, insert on evidence.verification_consents to postgres, service_role;
