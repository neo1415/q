/**
 * Q runtime service — a separate deployable boundary, not a module of the
 * application API and not a component of the web app (TA-005, IDA-002;
 * doc 10, 6). Capital Q is a consumer of this service.
 *
 * Composition only: configuration, the database pool, the Supabase-backed
 * authenticator, the PostgreSQL-backed actor-context resolver, the domain
 * query ports Q subjects resolve through, and the Q runtime service. Nothing
 * here imports apps/api or apps/web. The orchestrator (CQ-Q-003), the
 * Context Firewall (CQ-Q-004) and the Model Gateway with its provider
 * adapters (CQ-Q-005) and the Tool Registry with its Safe Read tools
 * (CQ-Q-007) are composed here; the stream adapter (CQ-Q-009) arrives with
 * its packet. Provider keys are read once from validated configuration,
 * handed to the adapters, and appear nowhere else; no tool ever receives
 * a credential, a connection or a table.
 */

import {
  loadDatabaseConfig,
  resolveDatabaseUrl,
} from "@capital-q/config/database";
import { loadQApiConfig } from "@capital-q/config/q-api";
import { requireSupabaseAuthConfig } from "@capital-q/config/supabase-auth";
import {
  createPostgresMaterialActionAuditWriter,
  createPostgresSecurityEventWriter,
} from "@capital-q/audit";
import { createPostgresCapitalObjectiveQueryPort } from "@capital-q/capital";
import { createPostgresCompanyQueryPort } from "@capital-q/companies";
import { createEventRegistry } from "@capital-q/contracts";
import { createRequestDatabaseClient } from "@capital-q/database";
import { createOutboxWriter } from "@capital-q/eventing";
import { createPostgresDocumentQueryPort } from "@capital-q/evidence";
import {
  createPostgresInvestorMandateQueryPort,
  createPostgresInvestorOrganisationQueryPort,
} from "@capital-q/investors";
import {
  createPostgresRelationshipEventRepository,
  createPostgresRelationshipRepository,
  type RelationshipQueryPort,
} from "@capital-q/network";
import { modelProviderConfigStatus } from "@capital-q/config/model-providers";
import {
  createModelGateway,
  createModelProviderRegistry,
  createPostgresModelCatalog,
  createPostgresModelUsageRepository,
  createProcessLocalProviderHealth,
  type ModelProvider,
} from "@capital-q/model-gateway";
import { createGoogleModelProvider } from "@capital-q/model-gateway/providers/google";
import { createGroqModelProvider } from "@capital-q/model-gateway/providers/groq";
import { createLogger, createTelemetryRuntime } from "@capital-q/observability";
import { createPostgresOrganisationQueryPort } from "@capital-q/organisations";
import {
  actorPrincipal,
  createDefaultDisclosureResolvers,
  createDisclosureAccessService,
  createDisclosureResourceResolverRegistry,
  createPostgresDisclosurePolicyRepository,
  createRelationshipPartyResolver,
  systemDisclosureClock,
} from "@capital-q/permissions";
import {
  createPostgresQActionRepositories,
  createQActionPort,
  createQActionRegistry,
  createQActionService,
} from "@capital-q/q-actions";
import { Q_ACTION_EVENTS } from "@capital-q/q-actions/events";
import { createContextFirewall } from "@capital-q/q-firewall";
import { createQTools } from "@capital-q/q-tools";
import {
  createLangGraphQOrchestrator,
  createPostgresQCheckpointStore,
} from "@capital-q/q-orchestrator";
import {
  createCapitalObjectiveQSubjectResolver,
  createCompanyQSubjectResolver,
  createDocumentQSubjectResolver,
  createInvestorOrganisationQSubjectResolver,
  createOrganisationQSubjectResolver,
  createPostgresQRuntimeRepositories,
  createInProcessQLiveDeltaBus,
  createPostgresQRunEventNotifier,
  createQOrchestrationRuntime,
  createQRunStreamService,
  createQRuntimeService,
  createQSubjectResolverRegistry,
  createRelationshipQSubjectResolver,
  createSelfUserQSubjectResolver,
  neverPause,
} from "@capital-q/q-runtime";
import { createAuthorizationService } from "@capital-q/security";
import {
  createPostgresActorContextResolver,
  createPostgresAuthorizationPolicySource,
} from "@capital-q/security/postgres";
import { createSupabaseAccessTokenAuthenticator } from "@capital-q/security/supabase";

import { createApp, SERVICE_NAME } from "./app.js";
import {
  composeQIntelligence,
  createProductionEmbeddingService,
} from "./composition/q-intelligence.js";
import { createSupabaseRequestAuthenticator } from "./security/supabase-authenticator.js";

// Q configuration is loaded from its own schema, separate from the application
// API even where the current fields coincide.
const config = loadQApiConfig();
// Q operations are human-initiated and authenticated; without an Auth server
// to verify against, the service does not start.
const supabaseAuth = requireSupabaseAuthConfig("q-api", config.supabaseAuth);

const telemetry = createTelemetryRuntime();
await telemetry.start();

// One pool per process, request-class access: never the privileged or
// migration credential. Holding it is not authority; every route still passes
// through ActorContext and the runtime's ownership checks.
const database = createRequestDatabaseClient(loadDatabaseConfig());

const logger = createLogger(
  {
    serviceName: SERVICE_NAME,
    environment: config.runtime.deploymentEnvironment,
    serviceVersion: config.observability.serviceVersion,
    region: config.observability.region,
  },
  { level: config.observability.logLevel },
);

// The owning contexts' public query ports. The Q side never touches another
// context's tables: subjects, disclosure and the firewall all read through
// these.
const companies = createPostgresCompanyQueryPort({ sql: database.sql });
const investors = createPostgresInvestorOrganisationQueryPort({
  sql: database.sql,
});
const mandates = createPostgresInvestorMandateQueryPort({ sql: database.sql });
const capital = createPostgresCapitalObjectiveQueryPort({ sql: database.sql });
const documents = createPostgresDocumentQueryPort({ sql: database.sql });
// Network exposes its read side through its service; the read port is
// assembled here from its exported repositories over the request executor.
const relationshipRepository = createPostgresRelationshipRepository();
const relationshipEventRepository = createPostgresRelationshipEventRepository();
const relationships: RelationshipQueryPort = {
  getById: (relationshipId) =>
    relationshipRepository.findById(database.sql, relationshipId),
  findByParties: (companyId, investorOrganisationId) =>
    relationshipRepository.findByParties(
      database.sql,
      companyId,
      investorOrganisationId,
    ),
  listEvents: (relationshipId, page = {}) =>
    relationshipEventRepository.listByRelationship(
      database.sql,
      relationshipId,
      {
        afterSequence: page.afterSequence,
        limit: page.limit ?? 100,
      },
    ),
  getEventById: (relationshipEventId) =>
    relationshipEventRepository.findById(database.sql, relationshipEventId),
};

// Deterministic authority (CQ-Q-004). Capability authorization from the
// security package; disclosure — who may see which resource, under which
// live grant, until when — from the permissions package, over the same
// resolvers the application API uses. No model is ever consulted.
const authorization = createAuthorizationService(
  createPostgresAuthorizationPolicySource({ sql: database.sql }),
);
const disclosurePorts = {
  companies,
  investors,
  mandates,
  capital,
  relationships,
};
const disclosureResolvers = createDisclosureResourceResolverRegistry(
  createDefaultDisclosureResolvers(disclosurePorts),
);
const relationshipParties = createRelationshipPartyResolver(disclosurePorts);
const disclosure = createDisclosureAccessService({
  sql: database.sql,
  policies: createPostgresDisclosurePolicyRepository(),
  resolvers: disclosureResolvers,
  relationshipParties,
  clock: systemDisclosureClock,
});

// A subject outside the caller's tenant is selectable only when disclosure
// says the caller may view it; absent and unshared are the same 404.
const subjectView = {
  canView: async (
    actor: Parameters<typeof actorPrincipal>[0],
    resource: { type: "company" | "investor_organisation"; id: string },
  ) =>
    (
      await disclosure.canDisclose({
        principal: actorPrincipal(actor),
        resource,
        requestedAccess: "view",
      })
    ).outcome === "ALLOW",
};

// Subjects resolve only through the owning contexts' public query ports,
// and a kind without a resolver fails closed.
const subjects = createQSubjectResolverRegistry([
  createCompanyQSubjectResolver(companies, subjectView),
  createInvestorOrganisationQSubjectResolver(investors, subjectView),
  createOrganisationQSubjectResolver(
    createPostgresOrganisationQueryPort({ sql: database.sql }),
  ),
  createSelfUserQSubjectResolver(),
  createCapitalObjectiveQSubjectResolver(capital),
  createDocumentQSubjectResolver(documents),
  createRelationshipQSubjectResolver(relationships),
]);

// The Context Firewall: the deterministic boundary between what the
// platform can access and what Q may reason over for this actor,
// organisation, purpose and subject set. It runs inside the orchestrator
// before any retrieval, and again ahead of retrieval on every resume.
const firewall = createContextFirewall({
  authorization,
  disclosure,
  resolvers: disclosureResolvers,
  relationshipParties,
  documents,
  capital,
  clock: systemDisclosureClock,
  logger,
});

const repositories = createPostgresQRuntimeRepositories();
const runtimeDependencies = {
  sql: database.sql,
  transactions: database.transactions,
  subjects,
  securityEvents: createPostgresSecurityEventWriter({ sql: database.sql }),
  logger,
};
const qRuntime = createQRuntimeService({
  ...runtimeDependencies,
  repositories,
});

// The resumable run stream (CQ-Q-009). Truth stays in q_runtime.run_events;
// the Postgres notifier is the wake-up that reaches every instance, and the
// in-process delta bus is the seam a streaming answer path will publish
// into. No provider streams today, so the bus carries nothing in
// production and the stream shows stages and the persisted message.
const runEventNotifier = createPostgresQRunEventNotifier({
  listen: database.listen,
  logger,
});
const liveDeltas = createInProcessQLiveDeltaBus();
const qStream = createQRunStreamService({
  ...runtimeDependencies,
  repositories,
  notifier: runEventNotifier,
  deltas: liveDeltas,
});

// The Model Gateway (CQ-Q-005): the one inference boundary. Providers are
// registered only when their key is configured; routing, eligibility and
// the kill switches come from ai_ops, and a service with no provider at
// all still starts — model-capable tasks then fail safely as unavailable.
// The keys are revealed here, once, and handed to the adapters.
const providerSecrets = config.secrets.modelProviders;
const providers: ModelProvider[] = [];
if (providerSecrets.google !== undefined) {
  providers.push(
    createGoogleModelProvider({ apiKey: providerSecrets.google.reveal() }),
  );
}
if (providerSecrets.groq !== undefined) {
  providers.push(
    createGroqModelProvider({ apiKey: providerSecrets.groq.reveal() }),
  );
}
const modelGateway = createModelGateway({
  catalog: createPostgresModelCatalog({ sql: database.sql }),
  registry: createModelProviderRegistry(providers),
  usage: createPostgresModelUsageRepository({ sql: database.sql }),
  health: createProcessLocalProviderHealth(),
  logger,
});
logger.info(
  { modelProviders: modelProviderConfigStatus(providerSecrets) },
  "model gateway composed",
);

// The Tool Registry (CQ-Q-007): four SAFE_READ tools over the same public
// query ports and the same two authorities the firewall uses. A run is
// offered only the tools its plan admits; every proposal is validated,
// authorised and executed deterministically before anything returns to
// the model. No SQL, HTTP, shell or connector tool exists.
const qTools = createQTools({
  ports: {
    companies,
    capital,
    mandates,
    investors,
    authorization,
    disclosure,
  },
  logger,
});
logger.info(
  { tools: qTools.registry.list().map((record) => record.versionId) },
  "q tool registry composed",
);

// The Approval Engine (CQ-Q-008). Durable proposals and approvals, the
// exact-payload binding, approver authorization, execution-time
// reauthorization and the idempotent execution gate. The production
// registry holds NO action definition: no email, calendar, messaging, Data
// Room, connector or MCP executor exists yet, so nothing consequential can
// be proposed or executed. When the first real CONFIRM_REQUIRED action
// arrives, it registers here and gains no authority the gate does not check.
const qActions = createQActionService({
  sql: database.sql,
  transactions: database.transactions,
  repositories: createPostgresQActionRepositories(),
  runtime: repositories,
  registry: createQActionRegistry([]),
  authorization,
  audit: createPostgresMaterialActionAuditWriter(),
  securityEvents: createPostgresSecurityEventWriter({ sql: database.sql }),
  outbox: createOutboxWriter({
    registry: createEventRegistry(Q_ACTION_EVENTS),
  }),
  logger,
});
const qActionPort = createQActionPort({ service: qActions, logger });

// Q's intelligence (CQ-C5-R1). Authorised hybrid retrieval (CQ-RAG-004),
// authorised Q Knowledge (CQ-KNW-002/003) and the Company Intelligence
// specialist (CQ-Q-020), composed into the two ports the orchestrator
// takes. Until this packet the service wired an unconfigured retrieval and
// no context port, so Q answered production questions with zero authorised
// facts while every layer sat verified and unreachable — the finding C5
// exists to catch.
//
// The query-embedding runtime holds confidential document text and lives on
// a private network. It is composed unconditionally: when it cannot be
// reached, retrieval runs lexically and says so in its own diagnostics,
// which is an honest degradation rather than a silent one.
const qIntelligence = composeQIntelligence({
  sql: database.sql,
  transactions: database.transactions,
  repositories,
  tools: qTools.port,
  gateway: modelGateway,
  embeddings: createProductionEmbeddingService(),
  logger,
});
logger.info(
  { capabilities: qIntelligence.capabilities },
  "q intelligence composed",
);

// Orchestration (CQ-Q-003). LangGraph lives entirely behind the
// QOrchestrator port; its checkpoints go to q_runtime.checkpoint* over the
// same request-class credential, whose URL is resolved here and handed to
// the store only.
const checkpoints = createPostgresQCheckpointStore({
  connectionString: resolveDatabaseUrl(loadDatabaseConfig(), "REQUEST"),
});
const orchestrator = createLangGraphQOrchestrator({
  runtime: createQOrchestrationRuntime({
    ...runtimeDependencies,
    repositories,
  }),
  cancelRun: qRuntime.cancelRun,
  checkpoints,
  firewall,
  retrieval: qIntelligence.retrieval,
  answer: qIntelligence.answer,
  actions: qActionPort,
  pausePolicy: neverPause,
  logger,
});

/**
 * The orchestration boundary. On: an accepted run is orchestrated at once
 * and reaches the composed answer seam. This is a composition decision, not
 * configuration: flip it here, with the packet that changes what the engine
 * can honestly do.
 */
const Q_ORCHESTRATION_AUTOSTART = true;

const { app, logger: appLogger } = createApp(
  config,
  {
    authenticator: createSupabaseRequestAuthenticator(
      createSupabaseAccessTokenAuthenticator(supabaseAuth),
    ),
    resolver: createPostgresActorContextResolver({ sql: database.sql }),
  },
  {
    qRuntime,
    orchestration: { orchestrator, autostart: Q_ORCHESTRATION_AUTOSTART },
    qActions,
    qStream: { service: qStream },
  },
);

app.addHook("onClose", async () => {
  await runEventNotifier.close();
  await checkpoints.close();
  await database.close();
});

await app.listen({
  port: config.network.port,
  host: config.network.host,
});

appLogger.info(
  { host: config.network.host, port: config.network.port },
  "service started",
);
