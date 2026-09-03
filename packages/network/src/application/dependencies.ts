import type { MaterialActionAuditWriter } from "@capital-q/audit";
import type { CompanyQueryPort } from "@capital-q/companies";
import type { DatabaseExecutor, TransactionManager } from "@capital-q/database";
import type { OutboxWriter } from "@capital-q/eventing";
import type { InvestorOrganisationQueryPort } from "@capital-q/investors";

import type { RelationshipEventRegistry } from "../domain/event-registry.js";
import type {
  RelationshipEventRepository,
  RelationshipRepository,
} from "./ports.js";

/**
 * Everything the Network application consumes. Companies and investor
 * organisations are reached only through their public query ports; audit
 * and events arrive as the shared ports. No authorization service is held
 * here: the owning workflow authorises before it calls, and no model
 * provider, feed, recommendation or GateQ module is ever imported.
 */
export type NetworkServiceDependencies = {
  readonly sql: DatabaseExecutor;
  readonly transactions: TransactionManager;
  readonly companies: CompanyQueryPort;
  readonly investors: InvestorOrganisationQueryPort;
  readonly outbox: OutboxWriter;
  readonly audit: MaterialActionAuditWriter;
  readonly registry: RelationshipEventRegistry;
  readonly repositories: {
    readonly relationships: RelationshipRepository;
    readonly events: RelationshipEventRepository;
  };
};
