import type {
  MaterialActionAuditWriter,
  SecurityEventWriter,
} from "@capital-q/audit";
import type { DatabaseExecutor, TransactionManager } from "@capital-q/database";
import type {
  ActorContextResolver,
  AuthorizationService,
} from "@capital-q/security";
import type {
  ActiveOrganisationContextStore,
  ApplicationIdentityLookup,
} from "@capital-q/security/postgres";
import type { OutboxWriter } from "@capital-q/eventing";

import type {
  MembershipRepository,
  OrganisationCreationRequestStore,
  OrganisationRepository,
  RoleTemplateRepository,
  TenantRepository,
} from "./ports.js";

/**
 * Everything the organisation use cases consume, supplied by the composition
 * root. Security, audit and eventing arrive as their existing ports: this
 * context decides nothing about authority, records nothing outside the
 * audit writer and publishes nothing outside the outbox.
 */
export type OrganisationServiceDependencies = {
  /** Request-class executor for reads outside a transaction. */
  readonly sql: DatabaseExecutor;
  readonly transactions: TransactionManager;
  /** AuthUserId -> Person, on the executor of the running transaction. */
  readonly identities: (
    executor: DatabaseExecutor,
  ) => ApplicationIdentityLookup;
  readonly authorization: AuthorizationService;
  readonly resolver: ActorContextResolver;
  readonly activeContexts: ActiveOrganisationContextStore;
  readonly outbox: OutboxWriter;
  readonly audit: MaterialActionAuditWriter;
  /** Optional: context switches are recorded as security events when present. */
  readonly securityEvents?: SecurityEventWriter | undefined;
  /** Non-fatal problems (a failed security-event write) are reported here. */
  readonly onWarning?: ((message: string, error: unknown) => void) | undefined;
  readonly repositories: {
    readonly tenants: TenantRepository;
    readonly organisations: OrganisationRepository;
    readonly memberships: MembershipRepository;
    readonly roleTemplates: RoleTemplateRepository;
    readonly creationRequests: OrganisationCreationRequestStore;
  };
};
