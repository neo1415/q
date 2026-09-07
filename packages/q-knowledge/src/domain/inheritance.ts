import type {
  MarketplaceVisibility,
  MessageSensitivity,
} from "@capital-q/contracts";
import { isAtLeastAsSensitive } from "@capital-q/evidence";

/**
 * Derived data inherits its source's governance (doc 15 §20-§21; CQ-RAG-001
 * §34-§35).
 *
 * A chunk may be exactly as visible as its source or narrower, and exactly
 * as sensitive or stronger. It can never become network-visible because a
 * parser produced it, and never INTERNAL because it is only one paragraph.
 * These checks are the reason the chunker refuses rather than "fixes" a
 * mismatch: the fix would be a silent disclosure decision.
 */

/**
 * ADR-001 disclosure scopes ordered from narrowest to widest audience. The
 * two owner-private scopes are peers; neither narrows the other.
 */
const VISIBILITY_RANK: Readonly<Record<MarketplaceVisibility, number>> = {
  personal_private: 0,
  organisation_private: 1,
  founder_private: 2,
  investor_private: 2,
  relationship_shared: 3,
  specifically_shared: 4,
  network_visible: 5,
  public_external: 6,
};

export function visibilityRank(scope: MarketplaceVisibility): number {
  return VISIBILITY_RANK[scope];
}

/** True when `derived` reaches no wider an audience than `source`. */
export function isNoWiderThan(
  derived: MarketplaceVisibility,
  source: MarketplaceVisibility,
): boolean {
  if (derived === source) return true;
  const peers =
    (derived === "founder_private" && source === "investor_private") ||
    (derived === "investor_private" && source === "founder_private");
  if (peers) return false;
  return VISIBILITY_RANK[derived] < VISIBILITY_RANK[source];
}

export class DerivedGovernanceError extends Error {
  readonly code: "VISIBILITY_WIDENED" | "SENSITIVITY_LOWERED";

  constructor(code: "VISIBILITY_WIDENED" | "SENSITIVITY_LOWERED") {
    super(
      code === "VISIBILITY_WIDENED"
        ? "a derived chunk cannot be more visible than its source"
        : "a derived chunk cannot be less sensitive than its source",
    );
    this.name = "DerivedGovernanceError";
    this.code = code;
  }
}

/**
 * Refuses a derived (visibility, sensitivity) pair that widens or weakens
 * the source's. Returns the pair unchanged when it is acceptable.
 */
export function assertInherits(
  derived: {
    readonly visibilityScope: MarketplaceVisibility;
    readonly sensitivityClass: MessageSensitivity;
  },
  source: {
    readonly visibilityScope: MarketplaceVisibility;
    readonly sensitivityClass: MessageSensitivity;
  },
): typeof derived {
  if (!isNoWiderThan(derived.visibilityScope, source.visibilityScope)) {
    throw new DerivedGovernanceError("VISIBILITY_WIDENED");
  }
  if (
    !isAtLeastAsSensitive(derived.sensitivityClass, source.sensitivityClass)
  ) {
    throw new DerivedGovernanceError("SENSITIVITY_LOWERED");
  }
  return derived;
}
