import type { MaterialActionAuditWriter } from "@capital-q/audit";
import type { DatabaseExecutor, TransactionManager } from "@capital-q/database";
import type { OutboxWriter } from "@capital-q/eventing";
import type { AuthorizationService } from "@capital-q/security";

import type { EvidenceSubjectResolverRegistry } from "../domain/subjects.js";
import type { EvidenceRepositories } from "./ports.js";

/**
 * Everything a use case needs, injected. No model provider, no parser, no
 * storage client, no queue: those belong to CQ-EVD-002/003 and arrive
 * behind their own adapters.
 */
export type EvidenceServiceDependencies = {
  readonly sql: DatabaseExecutor;
  readonly transactions: TransactionManager;
  readonly authorization: AuthorizationService;
  readonly subjects: EvidenceSubjectResolverRegistry;
  readonly outbox: OutboxWriter;
  readonly audit: MaterialActionAuditWriter;
  readonly repositories: EvidenceRepositories;
};
