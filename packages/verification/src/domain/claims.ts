import type {
  UtcTimestamp,
  VerificationClaimStatus,
  VerificationClaimType,
  VerificationMethod,
  VerificationStandingStatus,
  VerificationSubjectType,
} from "@capital-q/contracts";

/**
 * Verification claims (doc 13 §24; ADR-001: a workflow of its own).
 *
 *   Verification ≠ Evidence ≠ Endorsement ≠ Q inference
 *   a founder saying so ≠ Verification
 *
 * A claim row is written once. A request is a PENDING row; a decision is a
 * new row naming the request it answers; the highest revision per
 * (tenant, claim type, subject) is the current standing. Nothing in this
 * file reads truth_class, evidence_status or lifecycle_status, and nothing
 * here writes them.
 */

/**
 * The deciding party, mirroring verification_claims_provider_check
 * (20261231599900). Reference values, never a Postgres enum.
 */
export const VERIFICATION_PROVIDER_CODES = [
  "CAPITAL_Q_SYNTHETIC_DEMO",
  "CAPITAL_Q_OPERATOR",
  "DOJAH",
  "COMPANIES_HOUSE",
  "SUMSUB",
  "CAPITAL_Q_EMAIL_CODE",
] as const;
export type VerificationProviderCode =
  (typeof VERIFICATION_PROVIDER_CODES)[number];

/**
 * Which party may decide by which method (verification_claims_method_
 * provider_check). Every provider method is the system deciding.
 */
export const METHOD_PROVIDERS: Readonly<
  Record<VerificationMethod, readonly VerificationProviderCode[]>
> = {
  SYNTHETIC_DEMO_ATTESTATION: ["CAPITAL_Q_SYNTHETIC_DEMO"],
  OPERATOR_DECISION: ["CAPITAL_Q_OPERATOR"],
  REGISTRY_LOOKUP: ["DOJAH", "COMPANIES_HOUSE", "SUMSUB"],
  ID_SELFIE: ["DOJAH", "SUMSUB"],
  DIRECTOR_MATCH: ["DOJAH", "COMPANIES_HOUSE", "SUMSUB"],
  BANK_NAME_MATCH: ["DOJAH"],
  DOMAIN_EMAIL: ["CAPITAL_Q_EMAIL_CODE"],
};

export type VerificationClaim = {
  readonly id: string;
  readonly tenantId: string;
  readonly organisationId: string;
  readonly claimType: VerificationClaimType;
  readonly subjectType: VerificationSubjectType;
  /** The person or organisation id; null only for a domain. */
  readonly subjectId: string | null;
  readonly subjectDomain: string | null;
  readonly subjectKey: string;
  readonly status: VerificationClaimStatus;
  readonly revision: number;
  readonly decidesClaimId: string | null;
  readonly method: VerificationMethod | null;
  readonly provider: VerificationProviderCode | null;
  readonly decisionBasis: string | null;
  readonly decidedByActorType: "HUMAN" | "SYSTEM" | null;
  readonly decidedByUserId: string | null;
  readonly decidedAt: UtcTimestamp | null;
  readonly requestedByUserId: string;
  readonly verifiedAt: UtcTimestamp | null;
  readonly expiresAt: UtcTimestamp | null;
  readonly revokedAt: UtcTimestamp | null;
  /** Why an operator declined or withdrew it (REVOKED only); shown to the organisation. */
  readonly revocationReason?: string | null | undefined;
  readonly createdAt: UtcTimestamp;
};

/** The subject form each claim type takes (mirrors the table's check). */
export const SUBJECT_TYPE_OF: Readonly<
  Record<VerificationClaimType, VerificationSubjectType>
> = {
  FOUNDER_IDENTITY: "PERSON",
  INVESTOR_IDENTITY: "PERSON",
  ORGANISATION: "ORGANISATION",
  DOMAIN_CONTROL: "DOMAIN",
};

/**
 * The person's identity claim for each side (ADR 0038): founders and
 * investors are verified under different claim types, never one shared one.
 */
export function personClaimTypeFor(
  kind: "COMPANY" | "INVESTOR",
): "FOUNDER_IDENTITY" | "INVESTOR_IDENTITY" {
  return kind === "INVESTOR" ? "INVESTOR_IDENTITY" : "FOUNDER_IDENTITY";
}

/**
 * The standing a current row asserts at `now`. A VERIFIED row past its
 * expiry is EXPIRED without anyone writing anything; no row at all is
 * NOT_REQUESTED, never "not verified".
 */
export function standingOf(
  current: VerificationClaim | null,
  now: Date,
): VerificationStandingStatus {
  if (current === null) return "NOT_REQUESTED";
  if (
    current.status === "VERIFIED" &&
    current.expiresAt !== null &&
    Date.parse(current.expiresAt) <= now.getTime()
  ) {
    return "EXPIRED";
  }
  return current.status;
}

/** A founder may ask again only when nothing stands and nothing is waiting. */
export function isRequestable(status: VerificationStandingStatus): boolean {
  return (
    status === "NOT_REQUESTED" || status === "EXPIRED" || status === "REVOKED"
  );
}

/**
 * The founder-identity standing of an organisation: one verified member is
 * a verified founder (readiness asks for "a founder's identity"). Absent a
 * verified member, the asking person's own standing is what they can act
 * on; absent that too, nobody has asked.
 */
export function founderIdentityOf(
  claims: readonly VerificationClaim[],
  askingUserId: string | null,
  now: Date,
): VerificationClaim | null {
  const founders = claims.filter((c) => c.claimType === "FOUNDER_IDENTITY");
  const verified = founders.find((c) => standingOf(c, now) === "VERIFIED");
  if (verified !== undefined) return verified;
  if (askingUserId !== null) {
    return founders.find((c) => c.subjectId === askingUserId) ?? null;
  }
  return strongestUnverified(founders, now);
}

export function organisationIdentityOf(
  claims: readonly VerificationClaim[],
  organisationId: string,
): VerificationClaim | null {
  return (
    claims.find(
      (c) => c.claimType === "ORGANISATION" && c.subjectId === organisationId,
    ) ?? null
  );
}

/** Without an asking person: an ended claim says more than a waiting one. */
function strongestUnverified(
  claims: readonly VerificationClaim[],
  now: Date,
): VerificationClaim | null {
  const rank: Record<VerificationStandingStatus, number> = {
    VERIFIED: 5,
    EXPIRED: 4,
    REVOKED: 3,
    PENDING: 2,
    NOT_REQUESTED: 1,
  };
  let best: VerificationClaim | null = null;
  for (const claim of claims) {
    if (
      best === null ||
      rank[standingOf(claim, now)] > rank[standingOf(best, now)]
    ) {
      best = claim;
    }
  }
  return best;
}

/**
 * Plain English for every standing, in one place (the contract's
 * `description`). A method is always named, so a synthetic attestation can
 * never read as an operator's or a provider's verification.
 */
export function describeStanding(
  claimType: VerificationClaimType,
  status: VerificationStandingStatus,
  method: VerificationMethod | null,
): string {
  const subject =
    claimType === "FOUNDER_IDENTITY"
      ? "A founder's identity"
      : claimType === "INVESTOR_IDENTITY"
        ? "Your identity"
        : claimType === "ORGANISATION"
          ? "Your organisation"
          : "Your domain";
  switch (status) {
    case "NOT_REQUESTED":
      return `${subject}: not requested yet. Capital Q has made no verification decision.`;
    case "PENDING":
      return "Requested; Capital Q has not decided yet.";
    case "VERIFIED":
      return verifiedBy(method);
    case "EXPIRED":
      return "The earlier verification has expired. You can ask Capital Q again.";
    case "REVOKED":
      return "Not verified: a Capital Q operator declined this request or withdrew an earlier verification. You can ask again.";
  }
}

/** How a VERIFIED standing was reached, in plain words (always named). */
function verifiedBy(method: VerificationMethod | null): string {
  switch (method) {
    case "SYNTHETIC_DEMO_ATTESTATION":
      return "Verified (synthetic demo attestation). This is demo data on a demo deployment, not a real-world check.";
    case "REGISTRY_LOOKUP":
      return "Verified against the official company register.";
    case "ID_SELFIE":
      return "Verified with a government ID and a live selfie.";
    case "DIRECTOR_MATCH":
      return "Verified as a director or owner on the company register.";
    case "BANK_NAME_MATCH":
      return "Verified: the bank account name matches the legal name.";
    case "DOMAIN_EMAIL":
      return "Verified with a code sent to an address on the company's domain.";
    case "OPERATOR_DECISION":
    case null:
      return "Verified by a Capital Q operator.";
  }
}
