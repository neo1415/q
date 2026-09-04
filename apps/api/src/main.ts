/**
 * Capital Q application API — deployable composition root (doc 23, 8; ERA-002).
 *
 * Composition only: configuration, the database pool, the Supabase-backed
 * authenticator and the PostgreSQL-backed security adapters are built here
 * and handed to the application. Domain routes arrive with their packets and
 * import business logic from domain packages rather than defining it here.
 */

import { loadApiConfig } from "@capital-q/config/api";
import { loadDatabaseConfig } from "@capital-q/config/database";
import { requireSupabaseAuthConfig } from "@capital-q/config/supabase-auth";
import {
  createPostgresMaterialActionAuditWriter,
  createPostgresSecurityEventWriter,
} from "@capital-q/audit";
import { createRequestDatabaseClient } from "@capital-q/database";
import { createOutboxWriter } from "@capital-q/eventing";
import { createLogger, createTelemetryRuntime } from "@capital-q/observability";
import { createFounderOnboardingIntegration } from "@capital-q/founder-onboarding";
import { createInvestorOnboardingIntegration } from "@capital-q/investor-onboarding";
import { createCapitalService } from "@capital-q/capital";
import {
  createCompanyService,
  createPostgresCompanyQueryPort,
} from "@capital-q/companies";
import {
  createInvestorService,
  createPostgresInvestorOrganisationQueryPort,
} from "@capital-q/investors";
import {
  createOrganisationService,
  createPostgresOrganisationQueryPort,
} from "@capital-q/organisations";
import { createAuthorizationService } from "@capital-q/security";
import {
  createCompanyOnboardingSubjectResolver,
  createInvestorOrganisationOnboardingSubjectResolver,
  createOnboardingService,
} from "@capital-q/onboarding";
import { createTaxonomyService } from "@capital-q/taxonomy";
import {
  createPostgresActiveOrganisationContextStore,
  createPostgresActorContextResolver,
  createPostgresApplicationIdentityLookup,
  createPostgresAuthorizationPolicySource,
} from "@capital-q/security/postgres";
import { createSupabaseAccessTokenAuthenticator } from "@capital-q/security/supabase";

import { apiServiceIdentity, createApp } from "./app.js";
import { createProductionEventRegistry } from "./event-registry.js";
import { createSupabaseRequestAuthenticator } from "./security/supabase-authenticator.js";

// Configuration is validated once here at the composition root. Invalid
// configuration fails startup rather than surfacing as a runtime error later.
const config = loadApiConfig();
// A service that cannot verify sessions does not start.
const supabaseAuth = requireSupabaseAuthConfig("api", config.supabaseAuth);

const telemetry = createTelemetryRuntime();
await telemetry.start();

// One pool per process, request-class access: never the privileged or
// migration credential. Holding it is not authority; every route still passes
// through ActorContext and AuthorizationService.
const database = createRequestDatabaseClient(loadDatabaseConfig());

const security = {
  authenticator: createSupabaseRequestAuthenticator(
    createSupabaseAccessTokenAuthenticator(supabaseAuth),
  ),
  resolver: createPostgresActorContextResolver({ sql: database.sql }),
  identities: createPostgresApplicationIdentityLookup({ sql: database.sql }),
};

// Domain modules. Authorization, audit and events are the shared ports;
// each bounded context receives them and never reaches around them.
const authorization = createAuthorizationService(
  createPostgresAuthorizationPolicySource({ sql: database.sql }),
);
const outbox = createOutboxWriter({
  registry: createProductionEventRegistry(),
});
const audit = createPostgresMaterialActionAuditWriter();

const organisations = createOrganisationService({
  sql: database.sql,
  transactions: database.transactions,
  authorization,
  resolver: security.resolver,
  activeContexts: createPostgresActiveOrganisationContextStore({
    transactions: database.transactions,
  }),
  outbox,
  audit,
  securityEvents: createPostgresSecurityEventWriter({ sql: database.sql }),
});

// Companies reach organisations only through the public query port.
const companies = createCompanyService({
  sql: database.sql,
  transactions: database.transactions,
  authorization,
  organisations: createPostgresOrganisationQueryPort({ sql: database.sql }),
  outbox,
  audit,
});

// Investors likewise: the organisation is reached only through its query
// port; the investor's own Postgres repositories are never handed to Q.
const investors = createInvestorService({
  sql: database.sql,
  transactions: database.transactions,
  authorization,
  organisations: createPostgresOrganisationQueryPort({ sql: database.sql }),
  outbox,
  audit,
});

// Capital reaches the company only through its public query port; the
// capital repositories are never handed to Q.
const capital = createCapitalService({
  sql: database.sql,
  transactions: database.transactions,
  authorization,
  companies: createPostgresCompanyQueryPort({ sql: database.sql }),
  outbox,
  audit,
});

// Taxonomy is a platform capability: reference reads for every authenticated
// user, company classification through the company query port, and the
// mandate preference port the investor service already uses.
const taxonomy = createTaxonomyService({
  sql: database.sql,
  transactions: database.transactions,
  authorization,
  companies: createPostgresCompanyQueryPort({ sql: database.sql }),
  outbox,
  audit,
  // Safe classification telemetry only; the classifier never logs text.
  logger: createLogger(apiServiceIdentity(config), {
    level: config.observability.logLevel,
  }),
});

// Onboarding owns journey state only. The Founder integration registers the
// write-target handlers and step-context providers for Founder Definition v1;
// each handler reaches the canonical domains through their public services on
// the onboarding transaction (CQ-ONB-002). Investor arrives with CQ-ONB-003.
const founder = createFounderOnboardingIntegration({
  outbox,
  audit,
  securityEvents: createPostgresSecurityEventWriter({ sql: database.sql }),
});
// The Investor integration (CQ-ONB-003) does the same for Investor
// Definition v1: canonical Investor Organisation, Representative, Mandate,
// taxonomy preferences and portfolio references through their services.
const investorOnboarding = createInvestorOnboardingIntegration({
  outbox,
  audit,
  securityEvents: createPostgresSecurityEventWriter({ sql: database.sql }),
});
const onboarding = createOnboardingService({
  sql: database.sql,
  transactions: database.transactions,
  outbox,
  writeTargets: [
    ...(founder.writeTargets ?? []),
    ...(investorOnboarding.writeTargets ?? []),
  ],
  stepContextProviders: [
    ...(founder.stepContextProviders ?? []),
    ...(investorOnboarding.stepContextProviders ?? []),
  ],
  subjectResolvers: [
    createInvestorOrganisationOnboardingSubjectResolver(
      createPostgresInvestorOrganisationQueryPort({ sql: database.sql }),
    ),
    createCompanyOnboardingSubjectResolver(
      createPostgresCompanyQueryPort({ sql: database.sql }),
    ),
  ],
  logger: createLogger(apiServiceIdentity(config), {
    level: config.observability.logLevel,
  }),
});

const { app, logger } = createApp(config, security, {
  organisations,
  companies,
  investors,
  capital,
  taxonomy: {
    query: taxonomy.query,
    candidates: taxonomy.classification.candidates,
  },
  onboarding: onboarding.runtime,
});

app.addHook("onClose", async () => {
  await database.close();
});

await app.listen({
  port: config.network.port,
  host: config.network.host,
});

// Safe startup metadata only. The configuration object is never logged.
logger.info(
  { host: config.network.host, port: config.network.port },
  "service started",
);
