import type { MaterialActionAuditWriter } from "@capital-q/audit";
import type { DatabaseExecutor, TransactionManager } from "@capital-q/database";
import type { OutboxWriter } from "@capital-q/eventing";
import type { AuthorizationService } from "@capital-q/security";

import type {
  DisclosureClock,
  DisclosurePolicyRepository,
  DisclosureResourceResolverRegistry,
  RelationshipPartyResolver,
} from "./ports.js";

/**
 * Everything the Permissions application consumes. Domains are reached
 * only through the resolver registry and the relationship party resolver,
 * which are built over public query ports; capability authority arrives as
 * the security package's service and is never re-implemented here. No
 * model provider, no cache, no HTTP.
 */
export type PermissionsServiceDependencies = {
  readonly sql: DatabaseExecutor;
  readonly transactions: TransactionManager;
  readonly authorization: AuthorizationService;
  readonly outbox: OutboxWriter;
  readonly audit: MaterialActionAuditWriter;
  readonly clock: DisclosureClock;
  readonly resolvers: DisclosureResourceResolverRegistry;
  readonly relationshipParties: RelationshipPartyResolver;
  readonly repositories: {
    readonly policies: DisclosurePolicyRepository;
  };
};
