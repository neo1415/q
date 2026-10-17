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
 *   deck          a deck offered to all investors (data room PUBLIC, or
 *                 download open to investors): its confirmed or corrected
 *                 sections, and (ADR 0075) Q's unconfirmed reading of the
 *                 sections not yet reviewed; never a dismissed section,
 *                 never a deck shared only through a relationship grant
 *   pitch         (ADR 0075) the pitch investors may play and its transcript
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
  readonly structuredValue?: Readonly<Record<string, unknown>> | null;
  readonly validFrom?: string | null;
  readonly validTo?: string | null;
  readonly revisionId?: string | null;
  readonly revisionNumber?: number | null;
};

export type InvestabilityFounderLine = {
  readonly recordedAt?: string | null;
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
  /** Null: no deck offered to all investors, or no reading of it. */
  readonly deck: {
    readonly extractionId: string;
    readonly readAt: string;
    /** Investor-shown sections only (confirmed or corrected); others UNCLEAR. */
    readonly sections: readonly DeckSection[];
    /**
     * ADR 0075: Q's reading of sections the founder has NOT reviewed yet,
     * of this same deck (open to all investors). Never a dismissed section.
     * Scored as Q's inference of what the deck says (reduced weight) and
     * never quoted to investors.
     */
    readonly unconfirmed?: readonly DeckSection[] | undefined;
  } | null;
  /**
   * ADR 0075: the current founder pitch that investors may play (READY,
   * moderation ALLOWED, AUTHORISED playback, not superseded), with its
   * generated transcript text when there is one. Never quoted.
   */
  readonly pitch?:
    | {
        readonly mediaAssetId: string;
        readonly readyAt: string | null;
        readonly transcript: string | null;
      }
    | null
    | undefined;
};
