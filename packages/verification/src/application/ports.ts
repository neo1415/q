import type {
  VerificationClaimType,
  VerificationMethod,
} from "@capital-q/contracts";
import type { DatabaseExecutor, TransactionContext } from "@capital-q/database";

import type {
  VerificationClaim,
  VerificationProvider,
} from "../domain/claims.js";

export type NewPendingClaim = {
  readonly tenantId: string;
  readonly organisationId: string;
  readonly claimType: VerificationClaimType;
  readonly subjectId: string;
  readonly requestedByUserId: string;
};

export type NewSyntheticDecision = {
  readonly decides: VerificationClaim;
  readonly status: "VERIFIED";
  readonly method: Extract<VerificationMethod, "SYNTHETIC_DEMO_ATTESTATION">;
  readonly provider: Extract<VerificationProvider, "CAPITAL_Q_SYNTHETIC_DEMO">;
  readonly decisionBasis: string;
};

/**
 * ADR 0033: a Capital Q operator (platform admin with
 * `verification.decide` and a live step-up) decides a request by hand.
 * REVOKED is the "rejected" decision and carries its reason.
 */
export type NewOperatorDecision = {
  readonly decides: VerificationClaim;
  readonly status: "VERIFIED" | "REVOKED";
  readonly decisionBasis: string;
  readonly revocationReason: string | null;
  readonly operatorUserId: string;
  /**
   * Owner 13 Nov (S4): decided by a synthetic release-test reviewer. The
   * row is then written as SYNTHETIC_DEMO_ATTESTATION by
   * CAPITAL_Q_SYNTHETIC_DEMO, so no reader can take it for real
   * verification. The table's decider check names that method's decider
   * SYSTEM with no user; who reviewed is in the audit row.
   */
  readonly syntheticReviewer?: boolean | undefined;
};

/**
 * `evidence.verification_claims`, append-only. Tenant is always in the
 * predicate; there is no update and no delete here because the table
 * refuses both.
 */
export type VerificationClaimRepository = {
  /**
   * Serialises every write for one organisation's claims for the rest of
   * the transaction, so two requests (or a request and a decision) cannot
   * both compute the same next revision.
   */
  readonly lockOrganisation: (
    tx: TransactionContext,
    tenantId: string,
    organisationId: string,
  ) => Promise<void>;
  /**
   * The current claim (highest revision) of every FOUNDER_IDENTITY subject
   * who is an ACTIVE member of the organisation, and of the organisation
   * itself. A person who left stops counting as the company's founder.
   */
  readonly currentForOrganisation: (
    executor: DatabaseExecutor,
    tenantId: string,
    organisationId: string,
  ) => Promise<readonly VerificationClaim[]>;
  /** One claim by id, inside its tenant, or null. */
  readonly findById: (
    executor: DatabaseExecutor,
    tenantId: string,
    claimId: string,
  ) => Promise<VerificationClaim | null>;
  /** The highest revision for the claim's (tenant, type, subject). */
  readonly currentRevision: (
    executor: DatabaseExecutor,
    claim: Pick<VerificationClaim, "tenantId" | "claimType" | "subjectKey">,
  ) => Promise<number>;
  readonly insertPending: (
    tx: TransactionContext,
    claim: NewPendingClaim,
  ) => Promise<VerificationClaim>;
  readonly insertDecision: (
    tx: TransactionContext,
    decision: NewSyntheticDecision,
  ) => Promise<VerificationClaim>;
  readonly insertOperatorDecision: (
    tx: TransactionContext,
    decision: NewOperatorDecision,
  ) => Promise<VerificationClaim>;
};

/**
 * Whether a Person's auth account was created as synthetic demo data
 * (`app_metadata.synthetic = true`, set only through the Supabase admin
 * API with the service role). Read from the database, never from a
 * message, and never from user_metadata, which the person can edit.
 */
export type SyntheticPrincipalPort = {
  readonly isSynthetic: (
    executor: DatabaseExecutor,
    userId: string,
  ) => Promise<boolean>;
};

/**
 * Owner 13 Nov (S4): the release lane certifies the REAL operator workflow
 * with an authorised synthetic reviewer (a platform admin whose auth
 * account carries the service-role synthetic marker). Such a reviewer may
 * decide only fictional applicants. Both answers are read from the
 * database inside the deciding transaction, never from a message.
 */
export type SyntheticReviewerScopePort = {
  /** The operator's auth account carries `app_metadata.synthetic = true`. */
  readonly isSyntheticReviewer: (
    executor: DatabaseExecutor,
    operatorUserId: string,
  ) => Promise<boolean>;
  /**
   * Nothing real is involved in the request: the requester and a PERSON
   * subject are marked synthetic, the tenant passes the same rule the
   * synthetic decider and model routing use (members, all marked), every
   * current member of the claim's organisation is marked, and no company
   * of the organisation is a real company carrying demonstration data.
   */
  readonly isSyntheticApplicant: (
    executor: DatabaseExecutor,
    request: VerificationClaim,
  ) => Promise<boolean>;
};

/**
 * R43 (temporary until BIZ-006 /ops): current PENDING requests whose
 * requester — and, for a PERSON subject, whose subject — carry the
 * synthetic marker, oldest first, across tenants. A privileged worker
 * read that only narrows what the decider is offered; the decider
 * re-checks every condition. TODO(BIZ-006): delete.
 */
export type PendingSyntheticClaimSource = {
  readonly pendingSyntheticClaims: (
    limit: number,
  ) => Promise<
    readonly { readonly tenantId: string; readonly claimId: string }[]
  >;
};
