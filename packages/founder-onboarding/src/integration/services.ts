import type {
  MaterialActionAuditWriter,
  SecurityEventWriter,
} from "@capital-q/audit";
import { createCapitalService, type CapitalService } from "@capital-q/capital";
import {
  createCompanyService,
  createPostgresCompanyQueryPort,
  type CompanyService,
} from "@capital-q/companies";
import {
  createSavepointTransactionManager,
  type DatabaseExecutor,
  type TransactionContext,
  type TransactionManager,
} from "@capital-q/database";
import type { OutboxWriter } from "@capital-q/eventing";
import {
  createOrganisationService,
  createPostgresOrganisationQueryPort,
  type OrganisationService,
} from "@capital-q/organisations";
import {
  createAuthorizationService,
  type ActorContextResolver,
} from "@capital-q/security";
import {
  createPostgresActiveOrganisationContextStore,
  createPostgresActorContextResolver,
  createPostgresApplicationIdentityLookup,
  createPostgresAuthorizationPolicySource,
} from "@capital-q/security/postgres";
import {
  createTaxonomyService,
  type TaxonomyService,
} from "@capital-q/taxonomy";

/**
 * The canonical domains, composed on the executor of the onboarding
 * transaction. A write-target handler runs inside the runtime's transaction;
 * the domain use cases it calls open savepoints inside it, and their
 * authorization, identity and membership reads see the rows the same
 * transaction just created (the organisation F1 bootstraps). Nothing here
 * is reached around: every write goes through the public service of the
 * owning context with its own authorization, audit and events.
 */
export type FounderDomainServices = {
  readonly organisations: OrganisationService;
  readonly companies: CompanyService;
  readonly taxonomy: TaxonomyService;
  readonly capital: CapitalService;
  readonly resolver: ActorContextResolver;
};

export type FounderDomainDependencies = {
  readonly outbox: OutboxWriter;
  readonly audit: MaterialActionAuditWriter;
  readonly securityEvents?: SecurityEventWriter | undefined;
};

function compose(
  sql: DatabaseExecutor,
  transactions: TransactionManager,
  dependencies: FounderDomainDependencies,
): FounderDomainServices {
  const authorization = createAuthorizationService(
    createPostgresAuthorizationPolicySource({ sql }),
  );
  const companyQueries = createPostgresCompanyQueryPort({ sql });
  const shared = {
    sql,
    transactions,
    authorization,
    outbox: dependencies.outbox,
    audit: dependencies.audit,
  };
  const resolver = createPostgresActorContextResolver({ sql });
  return {
    organisations: createOrganisationService({
      ...shared,
      resolver,
      activeContexts: createPostgresActiveOrganisationContextStore({
        transactions,
      }),
      identities: (executor) =>
        createPostgresApplicationIdentityLookup({ sql: executor }),
      securityEvents: dependencies.securityEvents,
    }),
    companies: createCompanyService({
      ...shared,
      organisations: createPostgresOrganisationQueryPort({ sql }),
    }),
    taxonomy: createTaxonomyService({ ...shared, companies: companyQueries }),
    capital: createCapitalService({ ...shared, companies: companyQueries }),
    resolver,
  };
}

/** Domain services whose units of work are savepoints inside `tx`. */
export function createFounderDomainServices(
  tx: TransactionContext,
  dependencies: FounderDomainDependencies,
): FounderDomainServices {
  return compose(tx.sql, createSavepointTransactionManager(tx), dependencies);
}

/**
 * Read-side composition for step-context providers, which run on whatever
 * executor the runtime is reading with (possibly no transaction). A provider
 * must not write; any attempt to open a unit of work fails loudly.
 */
export function createFounderReadServices(
  executor: DatabaseExecutor,
  dependencies: FounderDomainDependencies,
): FounderDomainServices {
  return compose(
    executor,
    {
      run: () =>
        Promise.reject(
          new Error("founder step-context providers are read-only"),
        ),
    },
    dependencies,
  );
}
