import { z } from "zod";

import type {
  ProviderDecisionWriter,
  VerificationConsentStore,
  VerificationReviewQueue,
} from "../application/founder-link.js";
import { BIOMETRIC_CONSENT_TEXT_VERSION } from "../domain/founder-link.js";
import { toVerificationClaim } from "./postgres-verification-repository.js";

/**
 * V1: a provider-method decision on evidence.verification_claims (append
 * only: a new revision naming the request), decided by the SYSTEM with no
 * user, as verification_claims_decider_check requires.
 */
export function createPostgresProviderDecisionWriter(): ProviderDecisionWriter {
  return {
    insertProviderDecision: async (tx, decision) => {
      const request = decision.decides;
      const [row] = await tx.sql`
        insert into evidence.verification_claims
          (tenant_id, organisation_id, claim_type, subject_type, subject_id,
           subject_domain, status, revision, decides_claim_id, method, provider,
           provider_reference, decision_basis, decided_by_actor_type, decided_at,
           verified_at, expires_at, requested_by_user_id)
        select ${request.tenantId}, ${request.organisationId}, ${request.claimType},
               ${request.subjectType}, ${request.subjectId}::uuid, ${request.subjectDomain},
               'VERIFIED', coalesce(max(v.revision), 0) + 1, ${request.id},
               ${decision.method}, ${decision.provider}, ${decision.providerReference},
               ${decision.decisionBasis}, 'SYSTEM', now(), now(),
               ${decision.expiresAt}::timestamptz, ${request.requestedByUserId}
          from evidence.verification_claims v
         where v.tenant_id = ${request.tenantId}
           and v.claim_type = ${request.claimType}
           and v.subject_key = ${request.subjectKey}
        returning *`;
      return toVerificationClaim(row);
    },
  };
}

const ReviewRow = z.object({ id: z.string().uuid() });

/** Research §6.3: a mismatch is a case for a person, due in 3 days. */
export const VERIFICATION_REVIEW_DUE_HOURS = 72;

/**
 * The existing operator queue (core.human_reviews, subject
 * VERIFICATION_DECISION). Idempotent per key: a retry returns the case it
 * opened. The reason is the provider extract's words, never a model's.
 */
export function createPostgresVerificationReviewQueue(): VerificationReviewQueue {
  return {
    open: async (tx, review) => {
      const [created] = await tx.sql`
        insert into core.human_reviews
          (tenant_id, organisation_id, requester_user_id, subject_type, subject_ref,
           reason, source, due_at, idempotency_key)
        values (${review.tenantId}, ${review.organisationId}, ${review.requesterUserId},
                'VERIFICATION_DECISION', ${`claim:${review.claimId}`},
                ${review.reason}, 'APP',
                clock_timestamp() + make_interval(hours => ${VERIFICATION_REVIEW_DUE_HOURS}),
                ${review.idempotencyKey})
        on conflict (requester_user_id, idempotency_key) do nothing
        returning id`;
      if (created !== undefined)
        return { reviewId: ReviewRow.parse(created).id };
      const [existing] = await tx.sql`
        select id from core.human_reviews
         where requester_user_id = ${review.requesterUserId}
           and idempotency_key = ${review.idempotencyKey}`;
      return { reviewId: ReviewRow.parse(existing).id };
    },
  };
}

const ConsentRow = z.object({
  consent_version: z.string().regex(/^biometric-consent-v\d+$/u),
  consent_given_at: z.union([z.string(), z.date()]),
});

/**
 * Biometric consent (migration 20261231599900): append-only, one per claim
 * and version, only ever on the person's own identity claim, and read back
 * only by that person (the subject is in every predicate).
 */
export function createPostgresVerificationConsents(): VerificationConsentStore {
  return {
    record: async (tx, input) => {
      if (
        input.claim.claimType !== "FOUNDER_IDENTITY" &&
        input.claim.claimType !== "INVESTOR_IDENTITY"
      ) {
        throw new Error(
          "biometric consent belongs to a person's identity claim",
        );
      }
      await tx.sql`
        insert into evidence.verification_consents
          (tenant_id, organisation_id, claim_id, subject_user_id,
           consent_scope, consent_version, consent_given_at)
        values (${input.claim.tenantId}, ${input.claim.organisationId},
                ${input.claim.id}, ${input.subjectUserId},
                'BIOMETRIC_ID_SELFIE', ${input.consent.textVersion},
                ${input.consent.givenAt}::timestamptz)
        on conflict (claim_id, consent_scope, consent_version) do nothing`;
    },
    read: async (executor, scope) => {
      const [row] = await executor`
        select consent_version, consent_given_at
          from evidence.verification_consents
         where tenant_id = ${scope.tenantId}
           and claim_id = ${scope.claimId}
           and subject_user_id = ${scope.subjectUserId}
           and consent_scope = 'BIOMETRIC_ID_SELFIE'
         order by created_at desc
         limit 1`;
      if (row === undefined) return null;
      const parsed = ConsentRow.parse(row);
      const givenAt =
        parsed.consent_given_at instanceof Date
          ? parsed.consent_given_at.toISOString()
          : new Date(parsed.consent_given_at).toISOString();
      return {
        givenAt,
        textVersion: parsed.consent_version,
        explicit: true,
      };
    },
  };
}

/** The consent text version in force (the screen shows its words). */
export const CURRENT_CONSENT_VERSION = BIOMETRIC_CONSENT_TEXT_VERSION;
