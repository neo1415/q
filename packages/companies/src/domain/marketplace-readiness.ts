import {
  MARKETPLACE_READINESS_MARKETPLACE_READY,
  MARKETPLACE_READINESS_REQUIREMENTS,
  MARKETPLACE_READINESS_REQUIREMENTS_OUTSTANDING,
  type CompanyStatus,
  type MarketplaceReadinessOutcome,
  type MarketplaceReadinessRequirement,
  type MarketplaceReadinessRequirementResult,
  type MarketplaceReadinessState,
  type MarketplaceVisibility,
} from "@capital-q/contracts";

/**
 * Marketplace readiness policy v1 (PADL #57/#58; Product Specification,
 * "Marketplace Activation Requirements" and "Marketplace Readiness";
 * doc 10 F10/F11; doc 17 §36–§37).
 *
 *   Marketplace Readiness ≠ Investment Readiness ≠ Business Quality
 *   Marketplace Readiness ≠ Investor Fit ≠ Media READY ≠ network_visible
 *   Verification ≠ Endorsement      Evidence ≠ Verification
 *   Q inference ≠ Verification      Onboarding complete ≠ Marketplace Ready
 *
 * Pure: a canonical snapshot in, an assessment out. Nothing here reads a
 * database, a document, a memory, a model or a pitch asset. The same
 * snapshot under the same policy version gives the same assessment, and
 * the policy — not a caller — decides the state.
 *
 * Decision: every requirement SATISFIED or NOT_APPLICABLE → marketplace_ready;
 * any OUTSTANDING or UNKNOWN → requirements_outstanding. Unknown never
 * counts as met.
 */

/** Bumped when a requirement, its rule, its wording class or the decision changes. */
export const MARKETPLACE_READINESS_POLICY_VERSION =
  "marketplace-readiness.v1" as const;

/**
 * What the policy knows about a verification claim, as the Verification
 * seam reports it. There is deliberately no "self-declared" standing: a
 * founder saying so, a document saying so, Q reading so or a public page
 * saying so are not standings at all.
 */
export const VERIFICATION_CLAIM_STANDINGS = [
  "VERIFIED",
  "NOT_VERIFIED",
  "EXPIRED",
  "REVOKED",
] as const;
export type VerificationClaimStanding =
  (typeof VERIFICATION_CLAIM_STANDINGS)[number];

/** The verification facts readiness reads. Claim-specific, never one boolean. */
export type MarketplaceVerificationFacts = {
  /** False when Capital Q has no verification capability yet; every standing is then NOT_VERIFIED. */
  readonly available: boolean;
  readonly founderIdentity: VerificationClaimStanding;
  readonly organisationIdentity: VerificationClaimStanding;
};

/** The canonical company fields the policy reads. Nothing else is read. */
export type MarketplaceReadinessSnapshot = {
  readonly companyId: string;
  readonly companyStatus: CompanyStatus;
  readonly canonicalName: string;
  readonly shortDescription: string | null;
  readonly primaryDescription: string | null;
  readonly currentStageCode: string | null;
  readonly headquartersCountry: string | null;
  readonly marketplaceVisibility: MarketplaceVisibility;
  readonly verification: MarketplaceVerificationFacts;
};

export type MarketplaceReadinessEvaluation = {
  readonly policyVersion: typeof MARKETPLACE_READINESS_POLICY_VERSION;
  readonly state: MarketplaceReadinessState;
  readonly verificationAvailable: boolean;
  readonly requirements: readonly MarketplaceReadinessRequirementResult[];
};

const present = (value: string | null): boolean =>
  value !== null && value.trim().length > 0;

/**
 * Plain English per requirement and outcome. The one place wording lives,
 * so no screen invents a "Verified" it cannot stand behind. Verification
 * wording depends on whether the capability exists at all.
 */
export function describeRequirement(
  requirement: MarketplaceReadinessRequirement,
  outcome: MarketplaceReadinessOutcome,
  verificationAvailable: boolean,
): string {
  switch (requirement) {
    case "COMPANY_ACTIVE":
      return outcome === "SATISFIED"
        ? "Your company is active on Capital Q."
        : "Your company is closed on Capital Q, so it cannot take part in the marketplace.";
    case "MINIMUM_COMPANY_PROFILE":
      return outcome === "SATISFIED"
        ? "Your company profile has the essentials investors need: a name, a description, a stage and where you are based."
        : "Your company profile is missing something investors need first: a description, a stage or where you are based.";
    case "DISCOVERY_VISIBILITY_CONFIRMED":
      return outcome === "SATISFIED"
        ? "You have chosen to make your company profile visible to investors."
        : "You have not yet chosen to make your company profile visible to investors. Readiness never makes that choice for you.";
    case "FOUNDER_IDENTITY_VERIFIED":
      if (outcome === "SATISFIED") {
        return "A founder's identity has been verified.";
      }
      return verificationAvailable
        ? "A founder's identity has not been verified yet."
        : "Identity verification is not yet available on Capital Q. Until it is, no company can be included in investor recommendations.";
    case "ORGANISATION_VERIFIED":
      if (outcome === "SATISFIED") {
        return "Your organisation has been verified.";
      }
      return verificationAvailable
        ? "Your organisation has not been verified yet."
        : "Organisation verification is not yet available on Capital Q. Until it is, no company can be included in investor recommendations.";
    case "REQUIRED_DOCUMENTATION":
      return "No documents are required for the marketplace in this release. Uploading documents helps Q, but it is not a condition.";
  }
}

function verificationOutcome(
  standing: VerificationClaimStanding,
): MarketplaceReadinessOutcome {
  // EXPIRED and REVOKED are OUTSTANDING, not UNKNOWN: the claim was made
  // and no longer stands, so the requirement is definitely not met.
  return standing === "VERIFIED" ? "SATISFIED" : "OUTSTANDING";
}

export function evaluateMarketplaceReadiness(
  snapshot: MarketplaceReadinessSnapshot,
): MarketplaceReadinessEvaluation {
  const { verification } = snapshot;
  const outcomes: Readonly<
    Record<MarketplaceReadinessRequirement, MarketplaceReadinessOutcome>
  > = {
    COMPANY_ACTIVE:
      snapshot.companyStatus === "active" ? "SATISFIED" : "OUTSTANDING",
    // The fields the network projection shows and hard eligibility reads
    // (doc 17 §36: overview, stage, location). A name always exists.
    MINIMUM_COMPANY_PROFILE:
      present(snapshot.canonicalName) &&
      (present(snapshot.shortDescription) ||
        present(snapshot.primaryDescription)) &&
      present(snapshot.currentStageCode) &&
      present(snapshot.headquartersCountry)
        ? "SATISFIED"
        : "OUTSTANDING",
    // The founder's own F10 choice. Readiness reads it and never sets it:
    // passing this policy must not widen disclosure.
    DISCOVERY_VISIBILITY_CONFIRMED:
      snapshot.marketplaceVisibility === "network_visible"
        ? "SATISFIED"
        : "OUTSTANDING",
    FOUNDER_IDENTITY_VERIFIED: verificationOutcome(
      verification.founderIdentity,
    ),
    ORGANISATION_VERIFIED: verificationOutcome(
      verification.organisationIdentity,
    ),
    // Doc 10 acceptance rule: a founder completes a credible path without
    // uploading a deck. V1 mandates no document, and says so explicitly
    // rather than leaving the requirement out.
    REQUIRED_DOCUMENTATION: "NOT_APPLICABLE",
  };

  const requirements = MARKETPLACE_READINESS_REQUIREMENTS.map(
    (requirement): MarketplaceReadinessRequirementResult => ({
      requirement,
      outcome: outcomes[requirement],
      description: describeRequirement(
        requirement,
        outcomes[requirement],
        verification.available,
      ),
    }),
  );
  const ready = requirements.every(
    (r) => r.outcome === "SATISFIED" || r.outcome === "NOT_APPLICABLE",
  );
  return {
    policyVersion: MARKETPLACE_READINESS_POLICY_VERSION,
    state: ready
      ? MARKETPLACE_READINESS_MARKETPLACE_READY
      : MARKETPLACE_READINESS_REQUIREMENTS_OUTSTANDING,
    verificationAvailable: verification.available,
    requirements,
  };
}

/** The outstanding requirement ids, sorted, for audit metadata. Never descriptions. */
export function outstandingRequirementIds(
  evaluation: MarketplaceReadinessEvaluation,
): readonly MarketplaceReadinessRequirement[] {
  return evaluation.requirements
    .filter((r) => r.outcome === "OUTSTANDING" || r.outcome === "UNKNOWN")
    .map((r) => r.requirement)
    .sort();
}
