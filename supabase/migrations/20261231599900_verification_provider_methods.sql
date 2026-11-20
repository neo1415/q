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
