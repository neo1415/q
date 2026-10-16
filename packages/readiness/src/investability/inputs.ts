import type {
  DeckSection,
  EvidenceStatus,
  LifecycleStatus,
  TruthClass,
} from "@capital-q/contracts";

/**
 * What the investor-facing Investability may read about ONE company: only
 * information every eligible investor may see (Context Firewall, CLAUDE.md
 * release-blocking invariant). Founder-private material never appears here:
 *
 *   profile       the listed (network_visible / public_external) profile
 *   verification  the badges shown to the network (organisation, domain)
 *   founders      background lines the founder made network_visible
 *   claims        evidence claims scoped network_visible / public_external
 *   deck          the confirmed or founder-corrected sections of a deck
 *                 offered to all investors (data room PUBLIC, or download
 *                 open to investors); never a relationship grant
 *
 * Not read, by design: the capital objective (founder_private until
 * shared), team facts (not investor-visible), the founder's readiness
 * diagnosis and coaching, private documents, relationship-shared or
 * specifically-shared material, investor behaviour of any kind.
 */

export const INVESTOR_ELIGIBLE_SCOPES = [
  "network_visible",
  "public_external",
] as const;
export type InvestorEligibleScope = (typeof INVESTOR_ELIGIBLE_SCOPES)[number];

export type InvestabilityClaimInput = {
  readonly id: string;
  readonly claimType: string;
  readonly claimKey: string;
  readonly statement: string;
  readonly truthClass: TruthClass;
  readonly evidenceStatus: EvidenceStatus;
  readonly lifecycleStatus: LifecycleStatus;
  /** Checked again by the producer: anything else is dropped. */
  readonly visibilityScope: string;
  readonly assertedAt: string;
};

export type InvestabilityFounderLine = {
  readonly id: string;
  readonly title: string;
  readonly detail: string | null;
  /** A document of the company supports the line. */
  readonly documentSupported: boolean;
  /** Checked again by the producer: only network_visible counts. */
  readonly visibilityScope: string;
};

export type InvestabilityInputs = {
  readonly companyId: string;
  readonly stageCode: string | null;
  readonly sectorCodes: readonly string[];
  readonly businessModelCodes: readonly string[];
  readonly profile: {
    /** The company is listed to the network now. False: nothing is read. */
    readonly listed: boolean;
    readonly description: boolean;
    readonly website: boolean;
    readonly updatedAt: string | null;
  };
  readonly verification: {
    readonly organisation: boolean;
    readonly domain: boolean;
    readonly decidedAt: string | null;
  };
  readonly founders: readonly InvestabilityFounderLine[];
  readonly claims: readonly InvestabilityClaimInput[];
  /** Null: no deck offered to all investors, or no confirmed reading. */
  readonly deck: {
    readonly extractionId: string;
    readonly readAt: string;
    /** Investor-shown sections only (confirmed or corrected); others UNCLEAR. */
    readonly sections: readonly DeckSection[];
  } | null;
};
