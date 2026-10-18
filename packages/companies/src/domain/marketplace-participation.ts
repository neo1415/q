import {
  MARKETPLACE_READINESS_MARKETPLACE_READY,
  MARKETPLACE_READINESS_NOT_ASSESSED,
  MARKETPLACE_READINESS_REQUIREMENTS_OUTSTANDING,
} from "@capital-q/contracts";

/**
 * Marketplace participation (PADL #57/#58; Product Specification,
 * "Marketplace Activation Requirements").
 *
 *   Platform Access ≠ Marketplace Participation
 *   Marketplace Readiness ≠ Investment Readiness ≠ Business Quality
 *   network_visible ≠ marketplace_ready
 *
 * The Companies context owns `marketplace_readiness_state`; this is the one
 * place its values are read as a participation answer, so the Recommendation
 * context never has to interpret readiness vocabulary itself. A company
 * takes part in investor discovery only when the readiness engine has
 * written `marketplace_ready`. `not_assessed` is not eligible by definition,
 * and any state this function does not know is treated the same way: a
 * company never becomes discoverable because a later packet added a word.
 */

export const MARKETPLACE_PARTICIPATION = ["ELIGIBLE", "NOT_ELIGIBLE"] as const;
export type MarketplaceParticipation =
  (typeof MARKETPLACE_PARTICIPATION)[number];

/** Readiness states this domain currently recognises. Bounded, never an enum. */
export const KNOWN_MARKETPLACE_READINESS_STATES = [
  MARKETPLACE_READINESS_NOT_ASSESSED,
  MARKETPLACE_READINESS_REQUIREMENTS_OUTSTANDING,
  MARKETPLACE_READINESS_MARKETPLACE_READY,
] as const;

export function marketplaceParticipationOf(
  readinessState: string,
): MarketplaceParticipation {
  return readinessState === MARKETPLACE_READINESS_MARKETPLACE_READY
    ? "ELIGIBLE"
    : "NOT_ELIGIBLE";
}
