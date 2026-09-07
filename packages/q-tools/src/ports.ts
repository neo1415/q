import type { CapitalObjectiveQueryPort } from "@capital-q/capital";
import type { CompanyQueryPort } from "@capital-q/companies";
import type {
  InvestorMandateQueryPort,
  InvestorOrganisationQueryPort,
} from "@capital-q/investors";
import type { DisclosureAccessService } from "@capital-q/permissions";
import type { AuthorizationService } from "@capital-q/security";

/**
 * Everything the Safe Read tools may reach: the owning contexts' public
 * query ports and the two deterministic authorities. No executor, no
 * connection, no credential — a tool cannot compose a statement, only
 * call a named operation another context owns.
 */
export type QToolPorts = {
  readonly companies: CompanyQueryPort;
  readonly capital: CapitalObjectiveQueryPort;
  readonly mandates: InvestorMandateQueryPort;
  readonly investors: InvestorOrganisationQueryPort;
  readonly authorization: AuthorizationService;
  readonly disclosure: DisclosureAccessService;
};
