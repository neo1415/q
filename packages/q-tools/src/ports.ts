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
};
