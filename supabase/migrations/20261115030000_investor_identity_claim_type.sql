-- ADMIN-4 / ADR 0038: an investor's person is verified under INVESTOR_IDENTITY;
-- FOUNDER_IDENTITY stays for founders. Founders and investors are different
-- people with different claims, and a reader must never have to guess which
-- side a "founder identity" on an investor organisation meant.
--
-- claim_type is a checked text column (not a Postgres enum), so this widens
-- the check additively. verification_claims stays its own workflow, separate
-- from the truth / evidence / lifecycle axes (ADR-001).
--
-- Fix forward, keeping history: verification_claims is append-only, so an
-- investor-side FOUNDER_IDENTITY row is never rewritten. Each one -- every
-- revision, pending or decided, with its decision, decider and times -- is
-- re-created under INVESTOR_IDENTITY, and the pair is recorded in
-- evidence.verification_claim_reclassifications. The original rows remain as
-- they were; nothing reads FOUNDER_IDENTITY for an investor organisation.

alter table evidence.verification_claims
  drop constraint verification_claims_claim_type_check,
  add constraint verification_claims_claim_type_check
    check (claim_type in ('FOUNDER_IDENTITY', 'INVESTOR_IDENTITY', 'ORGANISATION', 'DOMAIN_CONTROL')),
  drop constraint verification_claims_subject_follows_claim_check,
  add constraint verification_claims_subject_follows_claim_check
    check ((claim_type in ('FOUNDER_IDENTITY', 'INVESTOR_IDENTITY') and subject_type = 'PERSON')
        or (claim_type = 'ORGANISATION' and subject_type = 'ORGANISATION')
        or (claim_type = 'DOMAIN_CONTROL' and subject_type = 'DOMAIN'));

-- Which claim row a reclassification re-created, why, and when. Append-only.
create table evidence.verification_claim_reclassifications (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references identity.tenants (id) on delete restrict,
  from_claim_id  uuid not null unique references evidence.verification_claims (id) on delete restrict,
  to_claim_id    uuid not null unique references evidence.verification_claims (id) on delete restrict,
  reason         text not null check (length(btrim(reason)) between 3 and 500),
  created_at     timestamptz not null default clock_timestamp(),
  check (from_claim_id <> to_claim_id)
);

comment on table evidence.verification_claim_reclassifications is
  'Provenance for a claim row re-created under another claim type (ADR 0038). The original row is never changed.';

create trigger verification_claim_reclassifications_append_only
  before update or delete on evidence.verification_claim_reclassifications
  for each row execute function evidence.protect_verification_claims();

alter table evidence.verification_claim_reclassifications enable row level security;
revoke all on evidence.verification_claim_reclassifications from public, anon, authenticated;
grant select, insert on evidence.verification_claim_reclassifications to postgres, service_role;

-- The data: investor organisations' person claims. A function, so it is
-- idempotent and testable (pgTAP 612); run once below.
create function private.reclassify_investor_identity_claims()
returns integer
language plpgsql
set search_path = ''
as $$
declare
  moved record;
  new_id uuid;
  n integer := 0;
begin
  -- An identity submission waiting on a claim that moves could never be
  -- closed by the operator's decision. Refuse loudly rather than strand it.
  if exists (
    select 1
      from core.identity_submissions s
      join evidence.verification_claims c on c.id = s.claim_id
     where s.status = 'SUBMITTED' and c.claim_type = 'FOUNDER_IDENTITY'
       and exists (select 1 from core.investor_organisations i where i.organisation_id = c.organisation_id)
       and not exists (select 1 from core.companies co where co.organisation_id = c.organisation_id)
  ) then
    raise exception 'open identity submissions reference investor-side FOUNDER_IDENTITY claims; decide them first';
  end if;

  create temporary table if not exists claim_moves (from_id uuid primary key, to_id uuid not null) on commit drop;
  -- Earlier moves, so a later revision's decides_claim_id still maps.
  insert into claim_moves
    select from_claim_id, to_claim_id from evidence.verification_claim_reclassifications
  on conflict do nothing;

  for moved in
    select c.*
      from evidence.verification_claims c
     where c.claim_type = 'FOUNDER_IDENTITY'
       and exists (select 1 from core.investor_organisations i where i.organisation_id = c.organisation_id)
       and not exists (select 1 from core.companies co where co.organisation_id = c.organisation_id)
       and not exists (select 1 from evidence.verification_claim_reclassifications r where r.from_claim_id = c.id)
     order by c.tenant_id, c.subject_key, c.revision
  loop
    new_id := gen_random_uuid();
    insert into evidence.verification_claims
      (id, tenant_id, organisation_id, claim_type, subject_type, subject_id, subject_domain,
       status, revision, decides_claim_id, method, provider, provider_reference,
       decision_basis, decided_by_actor_type, decided_by_user_id, decided_at,
       evidence_source_id, requested_by_user_id, verified_at, expires_at, revoked_at,
       revocation_reason, created_at)
    values
      (new_id, moved.tenant_id, moved.organisation_id, 'INVESTOR_IDENTITY', moved.subject_type,
       moved.subject_id, moved.subject_domain, moved.status, moved.revision,
       (select m.to_id from claim_moves m where m.from_id = moved.decides_claim_id),
       moved.method, moved.provider, moved.provider_reference, moved.decision_basis,
       moved.decided_by_actor_type, moved.decided_by_user_id, moved.decided_at,
       moved.evidence_source_id, moved.requested_by_user_id, moved.verified_at,
       moved.expires_at, moved.revoked_at, moved.revocation_reason, moved.created_at);
    insert into claim_moves values (moved.id, new_id);
    n := n + 1;
    insert into evidence.verification_claim_reclassifications (tenant_id, from_claim_id, to_claim_id, reason)
    values (moved.tenant_id, moved.id, new_id,
            'An investor''s person is verified as INVESTOR_IDENTITY (ADR 0038).');
  end loop;
  return n;
end;
$$;

revoke all on function private.reclassify_investor_identity_claims() from public, anon, authenticated;

select private.reclassify_investor_identity_claims();
