import type { MaterialActionAuditWriter } from "@capital-q/audit";
import type { CompanyQueryPort } from "@capital-q/companies";
import type { DatabaseExecutor, TransactionManager } from "@capital-q/database";
import type { OutboxWriter } from "@capital-q/eventing";
import type { AuthorizationService } from "@capital-q/security";

import type {
  CapitalObjectiveCreationRequestStore,
  CapitalObjectiveHistoryWriter,
  CapitalObjectiveRepository,
} from "./ports.js";

/**
 * Everything the capital use cases consume. The company is reached only
 * through its public query port; authority, audit and events arrive as the
 * shared ports and are never bypassed. No model provider, no external HTTP:
 * this domain makes zero LLM or network calls and Q has no write path here.
 */
export type CapitalServiceDependencies = {
  readonly sql: DatabaseExecutor;
  readonly transactions: TransactionManager;
  readonly authorization: AuthorizationService;
  readonly companies: CompanyQueryPort;
  readonly outbox: OutboxWriter;
  readonly audit: MaterialActionAuditWriter;
  readonly repositories: {
    readonly objectives: CapitalObjectiveRepository;
    readonly history: CapitalObjectiveHistoryWriter;
    readonly creationRequests: CapitalObjectiveCreationRequestStore;
  };
};
