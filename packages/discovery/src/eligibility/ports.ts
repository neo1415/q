import type {
  MandateConstraintDimension,
  MandateConstraintOperator,
  MandateConstraintValue,
  MandatePreferenceClass,
} from "@capital-q/contracts";
import type { ActorContext } from "@capital-q/security";

/**
 * What hard eligibility reads, and — as importantly — what it cannot.
 *
 * Every port returns canonical structured state or declared policy. There
 * is no port for Q memory, conversations, documents, evidence text, public
 * research, observed behaviour, scores or model output. A criterion that
 * needs one of those does not exist here; a port that cannot express them
 * cannot be misused later (doc 19 §204.8/§204.9; ADR 0012).
 *
 * Ports are batch-shaped where a candidate set would otherwise mean one
 * query per company (§33). Nothing here writes.
 */

/** The Companies context's answer, already reduced to a participation verdict. */
export type CompanyEligibilityFacts = {
  readonly companyId: string;
  readonly tenantId: string;
  readonly organisationId: string;
  readonly companyStatus: "active" | "closed";
  readonly marketplaceVisibility: string;
  /** From `marketplaceParticipationOf` in the Companies context; never derived here. */
  readonly marketplaceParticipation: "ELIGIBLE" | "NOT_ELIGIBLE";
  readonly currentStageCode: string | null;
  readonly headquartersCountry: string | null;
};

export type CompanyEligibilityFactsPort = {
  /** Cross-tenant by design; unknown ids are absent. */
  readonly findMany: (
    companyIds: readonly string[],
  ) => Promise<readonly CompanyEligibilityFacts[]>;
};

/**
 * One ACTIVE classification of a company: the node, its vocabulary and its
 * provenance. The port returns every provenance; the policy decides which
 * count (eligibility.v2: declared only).
 */
export type CompanyClassification = {
  readonly nodeId: string;
  readonly vocabularyCode: string;
  readonly source: string;
};

export type CompanyClassificationsPort = {
  /**
   * ACTIVE assignments only, read under the company's own tenant (the
   * Taxonomy context's rule). Companies with no classification at all are
   * present with an empty list — absence means "nobody has said", and the
   * policy treats that as unknown, never as a mismatch.
   */
  readonly listActive: (
    companies: readonly {
      readonly companyId: string;
      readonly tenantId: string;
    }[],
  ) => Promise<ReadonlyMap<string, readonly CompanyClassification[]>>;
};

/** A declared constraint as the Investor context's snapshot presents it. */
export type MandateHardConstraint = {
  readonly dimension: MandateConstraintDimension;
  readonly operator: MandateConstraintOperator;
  readonly value: MandateConstraintValue;
  readonly importance: MandatePreferenceClass;
  readonly isHardExclusion: boolean;
  /** MANUAL_ONLY constraints are stored for humans and never become a rule. */
  readonly automatedUse: "ELIGIBLE" | "MANUAL_ONLY";
};

/** A declared taxonomy preference with its provenance. */
export type MandateTaxonomyRule = {
  readonly nodeId: string;
  readonly vocabularyCode: string;
  readonly preferenceStrength: MandatePreferenceClass;
  readonly isExclusion: boolean;
  /** user_selected | admin_curated | q_inferred | document_extracted | integration */
  readonly source: string;
};

/** The investor's mandate as policy input. No raw narrative, no cheque prose. */
export type MandateSnapshotForEligibility = {
  readonly mandateId: string;
  readonly investorOrganisationId: string;
  readonly version: number;
  readonly status: "DRAFT" | "ACTIVE" | "CLOSED";
  readonly constraints: readonly MandateHardConstraint[];
  readonly taxonomyPreferences: readonly MandateTaxonomyRule[];
};

export type ActiveMandateLookup =
  | { readonly kind: "FOUND"; readonly mandate: MandateSnapshotForEligibility }
  | { readonly kind: "NONE" }
  /** More than one ACTIVE mandate and the context named none. */
  | { readonly kind: "AMBIGUOUS" };

export type InvestorMandatePort = {
  /**
   * The ACTIVE mandate of the investor organisation, or the named one if
   * the context pins a mandate id. A DRAFT or CLOSED mandate is never
   * returned as FOUND: the port reads status and the policy checks it again.
   */
  readonly activeMandate: (input: {
    readonly tenantId: string;
    readonly investorOrganisationId: string;
    readonly mandateId: string | null;
  }) => Promise<ActiveMandateLookup>;
};

/** Resolves the acting investor organisation from the trusted actor only. */
export type InvestorSubjectPort = {
  readonly investorOrganisationFor: (
    actor: ActorContext,
  ) => Promise<{ readonly investorOrganisationId: string } | null>;
};

export type DiscoverabilityPort = {
  /**
   * The disclosure evaluator's word for each company, for this actor, at
   * `view`. True means ALLOW. Classification alone is never enough.
   */
  readonly permittedToView: (
    actor: ActorContext,
    companyIds: readonly string[],
  ) => Promise<ReadonlyMap<string, boolean>>;
};

/** What the Network context says about the pair. Never inferred from interest. */
export type RelationshipStanding =
  | { readonly kind: "NONE" }
  | { readonly kind: "STATE"; readonly currentState: string };

export type RelationshipStandingPort = {
  readonly standings: (
    investorOrganisationId: string,
    companyIds: readonly string[],
  ) => Promise<ReadonlyMap<string, RelationshipStanding>>;
};

export type TaxonomyVersionPort = {
  readonly currentVersions: () => Promise<Readonly<Record<string, number>>>;
};

export type EligibilityPorts = {
  readonly companies: CompanyEligibilityFactsPort;
  readonly classifications: CompanyClassificationsPort;
  readonly mandates: InvestorMandatePort;
  readonly investorSubject: InvestorSubjectPort;
  readonly discoverability: DiscoverabilityPort;
  readonly relationships: RelationshipStandingPort;
  readonly taxonomyVersions?: TaxonomyVersionPort | undefined;
};
