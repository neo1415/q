import type {
  CompanyRaiseView,
  MarketplaceVisibility,
} from "@capital-q/contracts";
import { NO_RAISE_VIEW } from "@capital-q/contracts";
import type { DisclosureAllowReason } from "@capital-q/permissions";

/**
 * The one presentation policy for a company's raise (R2, 2026-10-09).
 *
 * Founder report: Discover said a company "has not shared its raise" while
 * its profile showed an amount. Hosted, 32 companies had an ACTIVE
 * objective with no disclosure policy (founder_private) and a pitch that
 * says the raise: the profile fell back to the pitch, the Discover card
 * and Q read only the disclosed objective. Every surface now asks this
 * policy, so equivalent readers see one answer.
 *
 * Precedence, for a reader the caller has already allowed to see the
 * company:
 *   1. the canonical objective, if this reader may view it (the owner
 *      always; anyone else only through the disclosure evaluator) --
 *      DISCLOSED_OBJECTIVE, even where a pitch says another figure
 *      (contradictions coexist on the profile's claims list; the declared
 *      raise is never silently replaced by the favourable number);
 *   2. a founder reading another company sees no pitch-derived raise (the
 *      profile gives them no overview at all);
 *   3. a raise the founder hid (a share they revoked) stays hidden: the
 *      pitch is not used to leak it on their behalf;
 *   4. the raise as said in a pitch this reader may play -- PITCH_CLAIM,
 *      labelled as the company's pitch claim, never as the disclosed one;
 *   5. NONE: unknown, never zero, never "not raising".
 *
 * The founder-private figure itself never reaches a non-owner unless
 * disclosure allows it: step 1 is the only path that reads it.
 */

export type RaiseViewerKind = "OWNER" | "INVESTOR" | "FOUNDER";

/** How the founder has set the current raise's sharing. */
export type RaiseSharing = "NETWORK" | "PRIVATE" | "HIDDEN";

export type RaiseObjectiveFact = {
  readonly id: string;
  readonly amount: string;
  readonly currency: string;
  readonly startedAt: string;
};

export type PitchRaiseClaimFact = {
  readonly pitchId: string;
  readonly atSeconds: number;
  readonly amount: string;
  readonly currency: string;
  /** The scope under which this reader may play the pitch. */
  readonly visibility: MarketplaceVisibility;
};

export type CompanyRaisePolicyInput = {
  readonly viewer: RaiseViewerKind;
  /** The company's current objective, whatever its disclosure. */
  readonly objective: RaiseObjectiveFact | null;
  /** The evaluator's ALLOW reason for this reader on the objective; null: denied. */
  readonly disclosedBecause: DisclosureAllowReason | null;
  readonly sharing: RaiseSharing;
  /** The first raise said in a pitch this reader may play, newest first. */
  readonly pitchClaim: PitchRaiseClaimFact | null;
};

const SCOPE_OF_REASON: Readonly<
  Record<DisclosureAllowReason, MarketplaceVisibility>
> = {
  OWNER: "organisation_private",
  SAME_ORGANISATION: "organisation_private",
  EXPLICIT_RECIPIENT: "specifically_shared",
  RELATIONSHIP_PARTY: "relationship_shared",
  NETWORK_VISIBLE: "network_visible",
  PUBLIC_EXTERNAL: "public_external",
};

export function presentCompanyRaise(
  input: CompanyRaisePolicyInput,
): CompanyRaiseView {
  const { objective } = input;
  if (objective !== null) {
    if (input.viewer === "OWNER") {
      return disclosed(
        objective,
        input.sharing === "NETWORK" ? "network_visible" : "founder_private",
      );
    }
    if (input.disclosedBecause !== null) {
      return disclosed(objective, SCOPE_OF_REASON[input.disclosedBecause]);
    }
  }
  if (input.viewer === "FOUNDER") return NO_RAISE_VIEW;
  if (input.sharing === "HIDDEN") return NO_RAISE_VIEW;
  const claim = input.pitchClaim;
  if (claim === null) return NO_RAISE_VIEW;
  return {
    source: "PITCH_CLAIM",
    money: { amount: claim.amount, currency: claim.currency },
    truthClass: "USER_CLAIM",
    evidenceStatus: "SELF_REPORTED",
    visibility: claim.visibility,
    asOf: null,
    pitch: { pitchId: claim.pitchId, atSeconds: claim.atSeconds },
  };
}

function disclosed(
  objective: RaiseObjectiveFact,
  visibility: MarketplaceVisibility,
): CompanyRaiseView {
  return {
    source: "DISCLOSED_OBJECTIVE",
    money: { amount: objective.amount, currency: objective.currency },
    // Founder-declared, never verified by being disclosed.
    truthClass: "USER_CLAIM",
    evidenceStatus: "SELF_REPORTED",
    visibility,
    asOf: objective.startedAt,
    pitch: null,
  };
}
