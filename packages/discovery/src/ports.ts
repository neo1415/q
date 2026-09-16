import type { ActorContext } from "@capital-q/security";

import type {
  DeclaredClassification,
  DeclaredPreference,
} from "./domain/fit.js";

/**
 * What discovery reads. Every port returns DECLARED state and nothing
 * else: no behaviour, no browsing, no inference, no score. There is
 * deliberately no port for "what this person looked at", because doc 19
 * forbids it shaping a slate and a port that cannot express it cannot be
 * misused later.
 */

/** A company as a candidate: the network projection's fields, no more. */
export type CandidateCompany = {
  readonly companyId: string;
  readonly canonicalName: string;
  readonly websiteUrl: string | null;
  readonly headquartersCountry: string | null;
  readonly currentStageCode: string | null;
  readonly shortDescription: string | null;
  readonly classifications: readonly DeclaredClassification[];
};

/** An investor as a candidate: the declared profile, no mandate. */
export type CandidateInvestor = {
  readonly investorOrganisationId: string;
  readonly displayName: string;
  readonly investorType: string;
  readonly websiteUrl: string | null;
  readonly hqCountry: string | null;
  readonly publicDescription: string | null;
  readonly deploymentState: string | null;
};

/** The acting investor's own active mandate. Their data, used for them. */
export type OwnMandate = {
  readonly mandateId: string;
  readonly minStageCode: string | null;
  readonly maxStageCode: string | null;
  readonly preferences: readonly DeclaredPreference[];
};

export type DiscoveryRepository = {
  /**
   * Companies an authenticated participant may discover: classified
   * network-visible or public external, active, and never the actor's own.
   * Cross-tenant by design — "visible to the network" means the network,
   * not one tenant — which is why the visibility column is the filter and
   * the actor's organisation is the only exclusion.
   */
  readonly discoverableCompanies: (
    actor: ActorContext,
    input: { readonly limit: number; readonly afterId: string | null },
  ) => Promise<readonly CandidateCompany[]>;
  readonly discoverableInvestors: (
    actor: ActorContext,
    input: { readonly limit: number; readonly afterId: string | null },
  ) => Promise<readonly CandidateInvestor[]>;
  /** The actor's own active mandate, if they have one. */
  readonly ownActiveMandate: (
    actor: ActorContext,
  ) => Promise<OwnMandate | null>;
  /**
   * Which side of the network the actor's own organisation is on. A
   * platform fact read from canonical rows, never a guess and never a
   * model's reading of what somebody said.
   */
  readonly ownSide: (actor: ActorContext) => Promise<DiscoverySide>;
};

/** INVESTOR sees companies, FOUNDER sees investors, NONE has neither yet. */
export type DiscoverySide = "INVESTOR" | "FOUNDER" | "NONE";

/**
 * The disclosure layer's final word. Classification chooses candidates;
 * disclosure decides each one, exactly as the company search tool does.
 * Absent means no second check is composed and only classification stands.
 */
export type DiscoveryDisclosurePort = {
  readonly permitted: (
    actor: ActorContext,
    resources: readonly {
      readonly type: "company" | "investor_organisation";
      readonly id: string;
    }[],
  ) => Promise<readonly boolean[]>;
};
