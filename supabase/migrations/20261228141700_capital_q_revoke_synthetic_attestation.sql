-- Capital Q's own organisation is a real company, but its organisation
-- verification was decided by SYNTHETIC_DEMO_ATTESTATION (the staging
-- demo's attestation for invented companies), so every reader saw
-- "Demo verified (synthetic)" on its profile. That misstates its evidence
-- status (lead decision, 16 Oct; premiere v5 scene 16).
--
-- Fix forward, append-only: a REVOKED revision naming that VERIFIED row,
-- decided by the same party that granted it. Nothing is updated or
-- deleted, no grant or policy changes, and the row is written only while
-- that attestation is still the organisation's current standing, so the
-- migration is a no-op anywhere else (local, CI) and safe to re-run.
-- A real verification, if Capital Q wants one, is a new request decided by
-- an operator.

do $$
declare
  capital_q_org constant uuid := 'f95c3469-ef29-4574-a508-c1ba1131d842';
  current_row evidence.verification_claims%rowtype;
begin
  select *
    into current_row
    from evidence.verification_claims
   where claim_type = 'ORGANISATION'
     and subject_type = 'ORGANISATION'
     and subject_id = capital_q_org
   order by revision desc
   limit 1;

  if not found
     or current_row.status <> 'VERIFIED'
     or current_row.method <> 'SYNTHETIC_DEMO_ATTESTATION' then
    return;
  end if;

  insert into evidence.verification_claims
    (tenant_id, organisation_id, claim_type, subject_type, subject_id,
     status, revision, decides_claim_id, method, provider, decision_basis,
     decided_by_actor_type, decided_at, revoked_at, revocation_reason,
     requested_by_user_id)
  values
    (current_row.tenant_id, current_row.organisation_id, 'ORGANISATION',
     'ORGANISATION', capital_q_org, 'REVOKED', current_row.revision + 1,
     current_row.id, 'SYNTHETIC_DEMO_ATTESTATION', 'CAPITAL_Q_SYNTHETIC_DEMO',
     'migration 20261228141700: the synthetic-demo attestation applies only to invented companies; Capital Q is a real company',
     'SYSTEM', now(), now(),
     'Not a synthetic company: the demo attestation misstated its evidence status',
     current_row.requested_by_user_id);
end;
$$;
