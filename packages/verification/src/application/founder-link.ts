import type { TransactionContext } from "@capital-q/database";

import type { VerificationClaim } from "../domain/claims.js";
import {
  linkDecisionBasis,
  linkFounder,
  linkReviewReason,
  type LinkMissing,
} from "../domain/founder-link.js";
import type {
  BiometricConsent,
  IdentityCheck,
  RegistryRecord,
  VerificationAdapterCode,
} from "../providers/contract.js";

/**
 * V1: what the linking rule's outcome does. A clean link is a system
 * decision on the founder's pending identity claim (DIRECTOR_MATCH, by the
 * register's provider, the consent in its basis). Anything else opens a
 * case in the existing operator queue (core.human_reviews) and leaves the
 * claim PENDING. No transaction is held across a provider call: the
 * provider results come in already fetched.
 */

/** A provider-method decision, written by the system (never a human). */
export type NewProviderDecision = {
  readonly decides: VerificationClaim;
  readonly method:
    "REGISTRY_LOOKUP" | "ID_SELFIE" | "DIRECTOR_MATCH" | "BANK_NAME_MATCH";
  readonly provider: VerificationAdapterCode;
  readonly providerReference: string;
  readonly decisionBasis: string;
  /** Research §6.4: founder ID 24 months, registry 6 months. */
  readonly expiresAt: string | null;
};

export type ProviderDecisionWriter = {
  readonly insertProviderDecision: (
    tx: TransactionContext,
    decision: NewProviderDecision,
  ) => Promise<VerificationClaim>;
};

/** The existing operator queue: subject VERIFICATION_DECISION. */
export type VerificationReviewQueue = {
  readonly open: (
    tx: TransactionContext,
    review: {
      readonly tenantId: string;
      readonly organisationId: string;
      /** The founder whose verification it is. */
      readonly requesterUserId: string;
      /** The pending claim the case is about. */
      readonly claimId: string;
      readonly reason: string;
      readonly idempotencyKey: string;
    },
  ) => Promise<{ readonly reviewId: string }>;
};

export const FOUNDER_ID_VALID_MONTHS = 24;

export type FounderLinkSettlement =
  | { readonly kind: "VERIFIED"; readonly claim: VerificationClaim }
  | {
      readonly kind: "REVIEW";
      readonly reviewId: string;
      readonly reason: string;
    }
  | { readonly kind: "NOT_READY"; readonly missing: readonly LinkMissing[] };

export async function settleFounderLink(
  dependencies: {
    readonly decisions: ProviderDecisionWriter;
    readonly reviews: VerificationReviewQueue;
  },
  tx: TransactionContext,
  input: {
    /** The founder's PENDING FOUNDER_IDENTITY request. */
    readonly request: VerificationClaim;
    readonly registry: RegistryRecord | null;
    readonly registryProvider: VerificationAdapterCode;
    readonly identity: IdentityCheck | null;
    readonly identityProvider: VerificationAdapterCode;
    readonly consent: BiometricConsent | null;
    readonly now: Date;
  },
): Promise<FounderLinkSettlement> {
  const { request } = input;
  if (
    request.claimType !== "FOUNDER_IDENTITY" ||
    request.status !== "PENDING"
  ) {
    return { kind: "NOT_READY", missing: ["IDENTITY"] };
  }
  const outcome = linkFounder(input);
  if (outcome.kind === "NOT_READY") return outcome;
  if (outcome.kind === "REVIEW") {
    const reason = linkReviewReason(outcome.reasons);
    const { reviewId } = await dependencies.reviews.open(tx, {
      tenantId: request.tenantId,
      organisationId: request.organisationId,
      requesterUserId: request.subjectId ?? request.requestedByUserId,
      claimId: request.id,
      reason,
      // One case per request: a retry finds the case it opened.
      idempotencyKey: `founder-link:${request.id}`,
    });
    return { kind: "REVIEW", reviewId, reason };
  }
  // Both are present on a link (the rule checked them).
  if (
    input.registry === null ||
    input.consent === null ||
    input.identity === null
  ) {
    return { kind: "NOT_READY", missing: ["REGISTRY", "IDENTITY", "CONSENT"] };
  }
  const expires = new Date(input.now);
  expires.setUTCMonth(expires.getUTCMonth() + FOUNDER_ID_VALID_MONTHS);
  const claim = await dependencies.decisions.insertProviderDecision(tx, {
    decides: request,
    method: "DIRECTOR_MATCH",
    provider: input.registryProvider,
    providerReference: input.registry.providerReference,
    decisionBasis: linkDecisionBasis({
      registry: input.registry,
      officer: outcome.officer,
      consent: input.consent,
      identityProvider: input.identityProvider,
    }),
    expiresAt: expires.toISOString(),
  });
  return { kind: "VERIFIED", claim };
}
