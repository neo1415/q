import type { CapitalObjectiveQueryPort } from "@capital-q/capital";
import type { CompanyQueryPort } from "@capital-q/companies";
import type {
  CurrentSlateExplanationService,
  DiscoveryService,
} from "@capital-q/discovery";
import type {
  InvestorMandateQueryPort,
  InvestorOrganisationQueryPort,
} from "@capital-q/investors";
import type {
  IncomingInterestDto,
  RelationshipStatusDto,
} from "@capital-q/contracts";
import type { DisclosureAccessService } from "@capital-q/permissions";
import type {
  PublicProfileLookupProvider,
  PublicWebResearchService,
} from "@capital-q/q-research";
import type { ActorContext, AuthorizationService } from "@capital-q/security";

/** One company as the investor's feed shows it. */
export type InvestorFeedCompany = {
  readonly companyId: string;
  readonly name: string;
  readonly stageCode: string | null;
  readonly headquartersCountry: string | null;
  readonly shortDescription: string | null;
  readonly websiteUrl: string | null;
  /** The feed's public reason codes, exactly as the card shows them. */
  readonly reasonCodes: readonly string[];
};

/**
 * A Save or Pass the investor recorded, by company identity. Two companies
 * may share a name; the id is what the decision was about, and the stage
 * and country are what tell them apart when Q has to say which.
 */
export type InvestorFeedDecision = {
  readonly companyId: string;
  readonly name: string;
  readonly stageCode: string | null;
  readonly headquartersCountry: string | null;
  readonly decision: "SAVED" | "PASSED";
};

export type InvestorFeedPort = {
  /** The first page of the actor's own feed; null when they are not an investor. */
  readonly page: (
    actor: ActorContext,
    limit: number,
  ) => Promise<{
    readonly items: readonly InvestorFeedCompany[];
    readonly notes: readonly string[];
  } | null>;
  /** Their own saved and passed companies, newest first, bounded, still visible to them. */
  readonly decisions: (
    actor: ActorContext,
    limit: number,
  ) => Promise<readonly InvestorFeedDecision[]>;
};

/**
 * The Network context's relationship capabilities, for Q (CQ-Q-030).
 *
 * Every read answers for the actor's own side only, folded from the
 * history that side may see (CQ-NET-012): a company never learns of an
 * investor's private discovery through Q any more than through the page.
 * The reads throw when the actor may not ask; `null` means nothing this
 * side may see exists.
 *
 * `prepareForApproval` is the one write: it hands a relationship action
 * to this run's Approval Engine proposer. It executes nothing -- the
 * person approves the exact payload, and only then does the action run,
 * through the same command the screen calls.
 */
export type RelationshipIntelligencePort = {
  readonly withCompany: (
    actor: ActorContext,
    companyId: string,
  ) => Promise<RelationshipStatusDto | null>;
  readonly withInvestor: (
    actor: ActorContext,
    investorOrganisationId: string,
  ) => Promise<RelationshipStatusDto | null>;
  /**
   * One relationship named by id (the RELATIONSHIP subject), as the
   * actor's own side sees it. The side is decided by the Network context
   * from the actor's membership; null when the actor is not a party.
   */
  readonly byRelationship: (
    actor: ActorContext,
    relationshipId: string,
  ) => Promise<{
    readonly side: "INVESTOR" | "COMPANY";
    readonly counterpart:
      | { readonly kind: "COMPANY"; readonly id: string }
      | { readonly kind: "INVESTOR_ORGANISATION"; readonly id: string };
    readonly status: RelationshipStatusDto | null;
  } | null>;
  /** Interest addressed to the actor's own company, with its answers. */
  readonly incomingInterest: (
    actor: ActorContext,
    companyId: string,
  ) => Promise<readonly IncomingInterestDto[]>;
  /** The Express Interest command's own authorisation; writes nothing. */
  readonly mayExpressInterest: (
    actor: ActorContext,
    companyId: string,
  ) => Promise<boolean>;
  /** The answer command's own authorisation; writes nothing. */
  readonly mayAnswerInterest: (
    actor: ActorContext,
    interestId: string,
  ) => Promise<boolean>;
  readonly prepareForApproval: (entry: {
    readonly runId: string;
    readonly tenantId: string;
    readonly actorUserId: string;
    readonly actionType:
      "relationship.interest.express" | "relationship.interest.respond";
    readonly payload: Readonly<Record<string, string>>;
  }) => "PREPARED" | "ONE_PER_TURN";
};

/**
 * Everything the Safe Read tools may reach: the owning contexts' public
 * query ports and the two deterministic authorities. No executor, no
 * connection, no credential — a tool cannot compose a statement, only
 * call a named operation another context owns.
 *
 * `research` is the one capability that reaches outside Capital Q
 * (CQ-Q-RESEARCH-001): a named operation over a provider-neutral port whose
 * outbound query is composed from allowed words, never forwarded. It is
 * optional; without a configured provider the research tools do not exist.
 */
export type QToolPorts = {
  readonly companies: CompanyQueryPort;
  readonly capital: CapitalObjectiveQueryPort;
  readonly mandates: InvestorMandateQueryPort;
  readonly investors: InvestorOrganisationQueryPort;
  readonly authorization: AuthorizationService;
  readonly disclosure: DisclosureAccessService;
  /**
   * The investor's own Discover feed and their own Save/Pass decisions
   * (CQ-QACT-001, ACC round 1b). When present, an investor's "what should
   * I look at" is answered from exactly the feed: the precomputed slate
   * with its declared eligibility, marketplace readiness, visibility,
   * ranking and pass suppression — never from a network listing that
   * bypasses them. Absent: the older network discovery answers.
   */
  readonly investorFeed?: InvestorFeedPort | undefined;
  /** Discovery (doc 19). Absent means the slate tool reports it is unavailable. */
  readonly discovery?: DiscoveryService | undefined;
  /**
   * Why a company is in this person's recommendations (CQ-REC-007R B).
   * Optional: absent, the tool is not offered and Q explains nothing about
   * ranking -- which is the correct behaviour, not a degraded one.
   */
  readonly recommendationExplanations?:
    CurrentSlateExplanationService | undefined;
  readonly research?: PublicWebResearchService | undefined;
  /** Public LinkedIn pages by URL; absent means the lookup tool does not exist. */
  readonly profiles?: PublicProfileLookupProvider | undefined;
  /** Relationships (CQ-Q-030); absent means no relationship tool exists. */
  readonly relationships?: RelationshipIntelligencePort | undefined;
  /** Profile changes for approval (BIZ-002); absent means the tool does not exist. */
  readonly profileChanges?: ProfileChangePort | undefined;
};

/**
 * Where a proposed profile change waits for the run's Approval Engine
 * proposer (BIZ-002). The composition validates the change against the
 * action's own payload schema -- normalising the way the profile page's
 * write path does -- and answers REFUSED with the person-facing reason
 * when it does not fit. Nothing here executes.
 */
export type ProfileChangePort = {
  readonly prepareForApproval: (entry: {
    readonly runId: string;
    readonly tenantId: string;
    readonly actorUserId: string;
    readonly profile: "PERSON" | "COMPANY" | "INVESTOR_ORGANISATION";
    /** Resolved by the tool from the actor and the plan, never by the model. */
    readonly subjectId: string;
    readonly changes: readonly {
      readonly field: string;
      readonly value: string | null;
    }[];
  }) => Promise<{
    readonly status: "PREPARED" | "ONE_PER_TURN" | "REFUSED";
    readonly awaitingApprovalOf: string | null;
    readonly reason: string | null;
  }>;
};
