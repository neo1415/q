import type { MaterialActionAuditWriter } from "@capital-q/audit";
import type { DatabaseExecutor, TransactionManager } from "@capital-q/database";
import type { OutboxWriter } from "@capital-q/eventing";
import type { OrganisationQueryPort } from "@capital-q/organisations";
import type { AuthorizationService } from "@capital-q/security";
import type { MandateTaxonomyPreferencePort } from "@capital-q/taxonomy";

import type {
  InvestorMandateCreationRequestStore,
  InvestorMandateRepository,
} from "./mandate-ports.js";
import type { InvestorPortfolioReferenceRepository } from "./portfolio-ports.js";
import type {
  InvestorCreationRequestStore,
  InvestorOrganisationRepository,
  InvestorRepresentativeRepository,
} from "./ports.js";

/**
 * Everything the investor use cases consume. The organisation is reached
 * only through its public query port; authority, audit and events arrive
 * as the shared ports and are never bypassed. No model provider, no
 * external HTTP: this domain makes zero LLM or network calls.
 */
export type InvestorServiceDependencies = {
  readonly sql: DatabaseExecutor;
  readonly transactions: TransactionManager;
  readonly authorization: AuthorizationService;
  readonly organisations: OrganisationQueryPort;
  readonly outbox: OutboxWriter;
  readonly audit: MaterialActionAuditWriter;
  /**
   * Declared taxonomy preferences are persisted through the Taxonomy port
   * inside the mandate command's own transaction, so a taxonomy change is a
   * versioned, audited, published mandate change (CQ-TAX-001).
   */
  readonly taxonomy: MandateTaxonomyPreferencePort;
  readonly repositories: {
    readonly investors: InvestorOrganisationRepository;
    readonly representatives: InvestorRepresentativeRepository;
    readonly creationRequests: InvestorCreationRequestStore;
    readonly mandates: InvestorMandateRepository;
    readonly mandateCreationRequests: InvestorMandateCreationRequestStore;
    readonly portfolio: InvestorPortfolioReferenceRepository;
  };
};
