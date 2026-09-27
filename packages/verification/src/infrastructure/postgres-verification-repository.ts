import { z } from "zod";

import {
  UtcTimestampSchema,
  VerificationClaimStatusSchema,
  VerificationClaimTypeSchema,
  VerificationMethodSchema,
  VerificationSubjectTypeSchema,
} from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";

import type {
  PendingSyntheticClaimSource,
  SyntheticPrincipalPort,
  VerificationClaimRepository,
} from "../application/ports.js";
import { SUBJECT_TYPE_OF, type VerificationClaim } from "../domain/claims.js";

/**
 * PostgreSQL for `evidence.verification_claims` (server-only: RLS on, no
 * policy, no browser grant). Every read names the tenant. Writes are
 * inserts; the next revision is computed inside the insert under the
 * organisation's advisory lock, and the unique revision index is the
 * final arbiter should anything bypass the lock.
 */

const Timestamp = z
  .union([z.date(), z.string()])
  .transform((value) =>
    UtcTimestampSchema.parse(
      value instanceof Date
        ? value.toISOString()
        : new Date(value).toISOString(),
    ),
  );

const Row = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  organisation_id: z.string().uuid(),
  claim_type: VerificationClaimTypeSchema,
  subject_type: VerificationSubjectTypeSchema,
  subject_id: z.string().uuid().nullable(),
  subject_domain: z.string().nullable(),
  subject_key: z.string(),
  status: VerificationClaimStatusSchema,
  revision: z.number().int().min(1),
  decides_claim_id: z.string().uuid().nullable(),
  method: VerificationMethodSchema.nullable(),
  provider: z
    .enum(["CAPITAL_Q_SYNTHETIC_DEMO", "CAPITAL_Q_OPERATOR"])
    .nullable(),
  decision_basis: z.string().nullable(),
  decided_by_actor_type: z.enum(["HUMAN", "SYSTEM"]).nullable(),
  decided_by_user_id: z.string().uuid().nullable(),
  decided_at: Timestamp.nullable(),
  requested_by_user_id: z.string().uuid(),
  verified_at: Timestamp.nullable(),
  expires_at: Timestamp.nullable(),
  revoked_at: Timestamp.nullable(),
  created_at: Timestamp,
});

function toClaim(row: unknown): VerificationClaim {
  const r = Row.parse(row);
  return {
    id: r.id,
    tenantId: r.tenant_id,
    organisationId: r.organisation_id,
    claimType: r.claim_type,
    subjectType: r.subject_type,
    subjectId: r.subject_id,
    subjectDomain: r.subject_domain,
    subjectKey: r.subject_key,
    status: r.status,
    revision: r.revision,
    decidesClaimId: r.decides_claim_id,
    method: r.method,
    provider: r.provider,
    decisionBasis: r.decision_basis,
    decidedByActorType: r.decided_by_actor_type,
    decidedByUserId: r.decided_by_user_id,
    decidedAt: r.decided_at,
    requestedByUserId: r.requested_by_user_id,
    verifiedAt: r.verified_at,
    expiresAt: r.expires_at,
    revokedAt: r.revoked_at,
    createdAt: r.created_at,
  };
}

const RevisionRow = z.object({ revision: z.coerce.number().int().min(0) });
const SyntheticRow = z.object({ synthetic: z.boolean() });

export function createPostgresVerificationClaimRepository(): VerificationClaimRepository {
  return {
    lockOrganisation: async (tx, tenantId, organisationId) => {
      await tx.sql`select pg_advisory_xact_lock(
        hashtextextended(${`verification:${tenantId}:${organisationId}`}, 0))`;
    },

    currentForOrganisation: async (executor, tenantId, organisationId) => {
      // Current = highest revision per (tenant, type, subject), computed
      // over the whole tenant so a row written for another organisation
      // still ends a person's earlier standing. Then only this
      // organisation itself and its ACTIVE members count.
      const rows = await executor`
        with latest as (
          select distinct on (c.claim_type, c.subject_key) c.*
            from evidence.verification_claims c
           where c.tenant_id = ${tenantId}
             and c.claim_type in ('FOUNDER_IDENTITY', 'ORGANISATION')
           order by c.claim_type, c.subject_key, c.revision desc
        )
        select *
          from latest
         where (claim_type = 'ORGANISATION' and subject_id = ${organisationId})
            or (claim_type = 'FOUNDER_IDENTITY' and exists (
                  select 1 from identity.organisation_memberships m
                   where m.tenant_id = ${tenantId}
                     and m.organisation_id = ${organisationId}
                     and m.user_id = latest.subject_id
                     and m.membership_status = 'active'))
         order by claim_type, created_at`;
      return rows.map(toClaim);
    },

    findById: async (executor, tenantId, claimId) => {
      const [row] = await executor`
        select *
          from evidence.verification_claims
         where tenant_id = ${tenantId} and id = ${claimId}`;
      return row === undefined ? null : toClaim(row);
    },

    currentRevision: (executor, claim) => currentRevision(executor, claim),

    insertPending: async (tx, claim) => {
      const [row] = await tx.sql`
        insert into evidence.verification_claims
          (tenant_id, organisation_id, claim_type, subject_type, subject_id,
           status, revision, requested_by_user_id)
        select ${claim.tenantId}, ${claim.organisationId}, ${claim.claimType},
               ${SUBJECT_TYPE_OF[claim.claimType]}, ${claim.subjectId}::uuid,
               'PENDING', coalesce(max(v.revision), 0) + 1, ${claim.requestedByUserId}
          from evidence.verification_claims v
         where v.tenant_id = ${claim.tenantId}
           and v.claim_type = ${claim.claimType}
           and v.subject_key = ${claim.subjectId}
        returning *`;
      return toClaim(row);
    },

    insertDecision: async (tx, decision) => {
      const request = decision.decides;
      const [row] = await tx.sql`
        insert into evidence.verification_claims
          (tenant_id, organisation_id, claim_type, subject_type, subject_id,
           subject_domain, status, revision, decides_claim_id, method, provider,
           decision_basis, decided_by_actor_type, decided_at, verified_at,
           requested_by_user_id)
        select ${request.tenantId}, ${request.organisationId}, ${request.claimType},
               ${request.subjectType}, ${request.subjectId}::uuid, ${request.subjectDomain},
               ${decision.status}, coalesce(max(v.revision), 0) + 1, ${request.id},
               ${decision.method}, ${decision.provider}, ${decision.decisionBasis},
               'SYSTEM', now(), now(), ${request.requestedByUserId}
          from evidence.verification_claims v
         where v.tenant_id = ${request.tenantId}
           and v.claim_type = ${request.claimType}
           and v.subject_key = ${request.subjectKey}
        returning *`;
      return toClaim(row);
    },
  };
}

async function currentRevision(
  executor: DatabaseExecutor,
  claim: { tenantId: string; claimType: string; subjectKey: string },
): Promise<number> {
  const [row] = await executor`
    select coalesce(max(revision), 0) as revision
      from evidence.verification_claims
     where tenant_id = ${claim.tenantId}
       and claim_type = ${claim.claimType}
       and subject_key = ${claim.subjectKey}`;
  return RevisionRow.parse(row).revision;
}

/**
 * `auth.users.raw_app_meta_data -> 'synthetic'`, through the person's
 * profile. app_metadata, never user_metadata: a signed-in person can edit
 * their own user_metadata through Supabase Auth, and on a synthetic-demo
 * deployment that would let anyone mark themselves synthetic and be
 * verified. app_metadata is writable only with the service role. False
 * for anything but an explicit boolean true.
 */
export function createPostgresSyntheticPrincipalPort(): SyntheticPrincipalPort {
  return {
    isSynthetic: async (executor, userId) => {
      const [row] = await executor`
        select coalesce(u.raw_app_meta_data -> 'synthetic' = 'true'::jsonb, false) as synthetic
          from identity.user_profiles p
          join auth.users u on u.id = p.auth_user_id
         where p.id = ${userId}`;
      return row === undefined ? false : SyntheticRow.parse(row).synthetic;
    },
  };
}

const PendingRow = z.object({ tenant_id: z.string(), id: z.string() });

/**
 * R43 sweep candidates (temporary until BIZ-006 /ops; TODO(BIZ-006):
 * delete). The same marker test as `isSynthetic`, applied to the requester
 * and to a PERSON subject, so a real founder's request is never even
 * offered and cannot starve the bounded sweep. Uses the partial PENDING
 * index; "current" is the highest revision for the subject.
 */
export function createPostgresPendingSyntheticClaimSource(
  executor: DatabaseExecutor,
): PendingSyntheticClaimSource {
  return {
    pendingSyntheticClaims: async (limit) => {
      const rows = await executor`
        select c.tenant_id, c.id
          from evidence.verification_claims c
          join identity.user_profiles rp on rp.id = c.requested_by_user_id
          join auth.users ru on ru.id = rp.auth_user_id
         where c.status = 'PENDING'
           and coalesce(ru.raw_app_meta_data -> 'synthetic' = 'true'::jsonb, false)
           and (c.subject_type <> 'PERSON' or exists (
                 select 1
                   from identity.user_profiles sp
                   join auth.users su on su.id = sp.auth_user_id
                  where sp.id = c.subject_id
                    and coalesce(su.raw_app_meta_data -> 'synthetic' = 'true'::jsonb, false)))
           and c.revision = (
                 select max(v.revision)
                   from evidence.verification_claims v
                  where v.tenant_id = c.tenant_id
                    and v.claim_type = c.claim_type
                    and v.subject_key = c.subject_key)
         order by c.created_at, c.id
         limit ${limit}`;
      return rows.map((row) => {
        const parsed = PendingRow.parse(row);
        return { tenantId: parsed.tenant_id, claimId: parsed.id };
      });
    },
  };
}
