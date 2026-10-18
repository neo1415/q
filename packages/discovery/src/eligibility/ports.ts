import type {
  MandateConstraintDimension,
  MandateConstraintOperator,
  MandateConstraintValue,
  MandatePreferenceClass,
} from "@capital-q/contracts";
import type { ActorContext } from "@capital-q/security";
import type { PassStanding } from "@capital-q/network";

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
  /**
   * The mandate's declared stage range (CQ-REC-STAGE-001). Never an
   * eligibility rule — eligibility reads constraints only — but it is
   * stage intent: a mandate declared as "pre-seed to Series A" with no
   * stage constraint must still retrieve and score by stage. Absent on
   * a snapshot built before this existed, and then it is simply no range.
   */
  readonly stage?:
    | {
        readonly minStageCode: string | null;
        readonly maxStageCode: string | null;
      }
    | undefined;
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

/**
 * Whose question the disclosure evaluator is being asked
 * (CQ-PERM-ORG-VIEW-001).
 *
 * A person reading their own feed asks as themselves. Work that produces an
 * artefact the whole investor organisation reads asks as the organisation,
 * because otherwise what the organisation knows would depend on which
 * member happened to run the job — and one member's personal grant would
 * quietly become everybody's.
 *
 * The organisation viewpoint carries no user and no membership, so there is
 * nothing for a person's access to enter through.
 */
export type DiscoverabilityViewpoint =
  | { readonly kind: "ACTOR"; readonly actor: ActorContext }
  | {
      readonly kind: "INVESTOR_ORGANISATION";
      readonly tenantId: string;
      /** Undefined resolves to nothing: the viewpoint fails closed. */
      readonly organisationId: string | undefined;
    };

export type DiscoverabilityPort = {
  /**
   * The disclosure evaluator's word for each company, for this viewpoint,
   * at `view`. True means ALLOW. Classification alone is never enough.
   */
  readonly permittedToView: (
    viewpoint: DiscoverabilityViewpoint,
    companyIds: readonly string[],
  ) => Promise<ReadonlyMap<string, boolean>>;
};

/** What the Network context says about the pair. Never inferred from interest. */
export type RelationshipStanding =
  | { readonly kind: "NONE" }
  | {
      readonly kind: "STATE";
      readonly currentState: string;
      /**
       * PASSED only (relationship-state.v2): when the investor passed, the
       * mandate it was made under, and the company's newest evidence of a
       * material change, for the re-approach rule (doc 19 §67). Absent: the
       * pass stays closed.
       */
      readonly pass?:
        | {
            readonly standing: PassStanding;
            readonly latestPitchReadyAt: string | null;
            readonly latestCapitalObjectiveAt: string | null;
          }
        | undefined;
    };

/**
 * The company's newest evidence of a material change, by company (doc 19
 * §67): a pitch that became playable, a capital objective set. Owned by
 * the media and capital contexts; composed by the app.
 */
export type MaterialChangePort = {
  readonly latest: (companyIds: readonly string[]) => Promise<
    ReadonlyMap<
      string,
      {
        readonly latestPitchReadyAt: string | null;
        readonly latestCapitalObjectiveAt: string | null;
      }
    >
  >;
};

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
