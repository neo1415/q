import type { CapitalObjectiveQueryPort } from "@capital-q/capital";
import type { CompanyQueryPort } from "@capital-q/companies";
import type {
  InvestorMandateQueryPort,
  InvestorOrganisationQueryPort,
} from "@capital-q/investors";
import type { DisclosureAccessService } from "@capital-q/permissions";
import type {
  PublicProfileLookupProvider,
  PublicWebResearchService,
} from "@capital-q/q-research";
import type { AuthorizationService } from "@capital-q/security";

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
  readonly research?: PublicWebResearchService | undefined;
  /** Public LinkedIn pages by URL; absent means the lookup tool does not exist. */
  readonly profiles?: PublicProfileLookupProvider | undefined;
};
