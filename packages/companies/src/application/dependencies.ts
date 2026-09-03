import type { MaterialActionAuditWriter } from "@capital-q/audit";
import type { DatabaseExecutor, TransactionManager } from "@capital-q/database";
import type { OutboxWriter } from "@capital-q/eventing";
import type { OrganisationQueryPort } from "@capital-q/organisations";
import type { AuthorizationService } from "@capital-q/security";

import type {
  CompanyCreationRequestStore,
  CompanyRepository,
} from "./ports.js";
import type {
  CompanyMemberRepository,
  CompanyTeamFactsRepository,
  FounderProfileRepository,
} from "./team-ports.js";

/**
 * Everything the company use cases consume. The organisation is reached
 * only through its public query port; authority, audit and events arrive
 * as the shared ports and are never bypassed.
 */
export type CompanyServiceDependencies = {
  readonly sql: DatabaseExecutor;
  readonly transactions: TransactionManager;
  readonly authorization: AuthorizationService;
  readonly organisations: OrganisationQueryPort;
  readonly outbox: OutboxWriter;
  readonly audit: MaterialActionAuditWriter;
  readonly repositories: {
    readonly companies: CompanyRepository;
    readonly creationRequests: CompanyCreationRequestStore;
    readonly members: CompanyMemberRepository;
    readonly founderProfiles: FounderProfileRepository;
    readonly teamFacts: CompanyTeamFactsRepository;
  };
};
