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
import { createTelemetryRuntime } from "@capital-q/observability";
import { createCompanyService } from "@capital-q/companies";
import {
  createOrganisationService,
  createPostgresOrganisationQueryPort,
} from "@capital-q/organisations";
import { createAuthorizationService } from "@capital-q/security";
import {
  createPostgresActiveOrganisationContextStore,
  createPostgresActorContextResolver,
  createPostgresApplicationIdentityLookup,
  createPostgresAuthorizationPolicySource,
} from "@capital-q/security/postgres";
import { createSupabaseAccessTokenAuthenticator } from "@capital-q/security/supabase";

import { createApp } from "./app.js";
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

const { app, logger } = createApp(config, security, {
  organisations,
  companies,
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
