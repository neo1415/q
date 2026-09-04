import type {
  MaterialActionAuditWriter,
  SecurityEventWriter,
} from "@capital-q/audit";
import {
  createSavepointTransactionManager,
  type DatabaseExecutor,
  type TransactionContext,
  type TransactionManager,
} from "@capital-q/database";
import type { OutboxWriter } from "@capital-q/eventing";
import {
  createInvestorService,
  type InvestorService,
} from "@capital-q/investors";
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
  createPostgresTaxonomyReferenceRepository,
  createTaxonomyQueryPort,
  normalizeTaxonomyAlias,
  type TaxonomyQueryPort,
} from "@capital-q/taxonomy";

/**
 * The canonical domains an investor step reaches, composed on the executor
 * of the onboarding transaction (see the founder integration for the
 * rationale). Every write goes through the Organisation or Investor public
 * service with its own authorization, versioning, audit and events; the
 * Taxonomy query port is read-only here (labels and existence).
 */
export type InvestorDomainServices = {
  readonly organisations: OrganisationService;
  readonly investors: InvestorService;
  readonly taxonomy: TaxonomyQueryPort;
  readonly resolver: ActorContextResolver;
};

export type InvestorDomainDependencies = {
  readonly outbox: OutboxWriter;
  readonly audit: MaterialActionAuditWriter;
  readonly securityEvents?: SecurityEventWriter | undefined;
};

function compose(
  sql: DatabaseExecutor,
  transactions: TransactionManager,
  dependencies: InvestorDomainDependencies,
): InvestorDomainServices {
  const authorization = createAuthorizationService(
    createPostgresAuthorizationPolicySource({ sql }),
  );
  const resolver = createPostgresActorContextResolver({ sql });
  const shared = {
    sql,
    transactions,
    authorization,
    outbox: dependencies.outbox,
    audit: dependencies.audit,
  };
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
    investors: createInvestorService({
      ...shared,
      organisations: createPostgresOrganisationQueryPort({ sql }),
    }),
    taxonomy: createTaxonomyQueryPort({
      sql,
      reference: createPostgresTaxonomyReferenceRepository(),
      normalizeAlias: normalizeTaxonomyAlias,
    }),
    resolver,
  };
}

/** Domain services whose units of work are savepoints inside `tx`. */
export function createInvestorDomainServices(
  tx: TransactionContext,
  dependencies: InvestorDomainDependencies,
): InvestorDomainServices {
  return compose(tx.sql, createSavepointTransactionManager(tx), dependencies);
}

/** Read-side composition for step-context providers; any write fails loudly. */
export function createInvestorReadServices(
  executor: DatabaseExecutor,
  dependencies: InvestorDomainDependencies,
): InvestorDomainServices {
  return compose(
    executor,
    {
      run: () =>
        Promise.reject(
          new Error("investor step-context providers are read-only"),
        ),
    },
    dependencies,
  );
}
