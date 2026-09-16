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
import { researchProviderConfigStatus } from "@capital-q/config/research-providers";
import { speechProviderConfigStatus } from "@capital-q/config/speech-providers";
import { Q_VOICE_THINK_PATH, Q_VOICE_WS_PATH } from "@capital-q/contracts";
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
  createInProcessQLiveDeltaBus,
  createInvestorOrganisationQSubjectResolver,
  createOrganisationQSubjectResolver,
  createOrphanedRunSweep,
  createPostgresQRunEventNotifier,
  createPostgresQRuntimeRepositories,
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
  createPostgresApplicationIdentityLookup,
  createPostgresAuthorizationPolicySource,
} from "@capital-q/security/postgres";
import { createSupabaseAccessTokenAuthenticator } from "@capital-q/security/supabase";

import { createApp, SERVICE_NAME } from "./app.js";
import {
  composeQIntelligence,
  createProductionEmbeddingService,
} from "./composition/q-intelligence.js";
import {
  createDiscoveryService,
  createPostgresDiscoveryRepository,
} from "@capital-q/discovery";

import { composePresence } from "./composition/presence.js";
import { createPresenceTrigger } from "./voice/presence-trigger.js";
import { composeResearch } from "./composition/research.js";
import { createSupabaseRequestAuthenticator } from "./security/supabase-authenticator.js";
import { attachVoiceChannel } from "./voice/attach.js";
import { createVoiceSessionBindings } from "./voice/bindings.js";
import { createInterviewer } from "./voice/interviewer.js";
import { createLoggingPronunciationTeacher } from "./voice/pronunciation.js";
import { createElevenLabsPronunciationTeacher } from "./voice/providers/elevenlabs-pronunciation.js";
import { createVoiceTurnBoard } from "./voice/turn-board.js";
import { createWelcomeHost } from "./voice/welcome.js";
import type { VoiceAttachment } from "./voice/provider.js";
import { createDeepgramVoiceProvider } from "./voice/providers/deepgram.js";
import { createElevenLabsVoiceProvider } from "./voice/providers/elevenlabs.js";
import { createVoiceTurnHandler } from "./voice/turn.js";

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
    createGroqModelProvider({
      apiKey: providerSecrets.groq.reveal(),
      additionalApiKeys: providerSecrets.groqKeys
        .slice(1)
        .map((key) => key.reveal()),
    }),
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

// Controlled public-web research (CQ-Q-RESEARCH-001): the provider exists
// only when its key is configured, its outbound queries are composed from
// allowed words, its reads are limited to URLs a search in the same run
// surfaced, and what a founder's Q reads about their own company is
// recorded as the company's evidence. The same module composes the
// conversational statement recorder over the Knowledge Write Gate.
const researchComposition = composeResearch({
  sql: database.sql,
  transactions: database.transactions,
  authorization,
  investorQueries: investors,
  secrets: config.secrets.researchProviders,
  logger,
});

// Public presence (CQ-Q-PRESENCE-001): what the web already says about a
// person, their company or their fund, read in parallel the first time
// Capital Q knows enough to look and refreshed rather than rebuilt. It
// shares the Evidence owner and the Write Gate the research tools use, so
// there is one set of rules about what may be recorded and held.
const presenceComposition = composePresence({
  sql: database.sql,
  evidence: researchComposition.evidence,
  gateway: modelGateway,
  gate: researchComposition.gate,
  ...(researchComposition.research === undefined
    ? {}
    : { research: researchComposition.research }),
  ...(researchComposition.profiles === undefined
    ? {}
    : { profiles: researchComposition.profiles }),
  logger,
});
logger.info(
  {
    presence: presenceComposition === undefined ? "unconfigured" : "configured",
  },
  "public presence composed",
);
logger.info(
  {
    researchProviders: researchProviderConfigStatus(
      config.secrets.researchProviders,
    ),
  },
  "public research composed",
);

// The Tool Registry (CQ-Q-007): four SAFE_READ tools over the same public
// query ports and the same two authorities the firewall uses, plus the two
// bounded public-web research tools when a research provider is composed.
// A run is offered only the tools its plan admits; every proposal is
// validated, authorised and executed deterministically before anything
// returns to the model. No SQL, arbitrary HTTP, shell or connector tool
// exists.
const qTools = createQTools({
  ports: {
    companies,
    capital,
    mandates,
    investors,
    authorization,
    disclosure,
    // Discovery (doc 19): the same deterministic slate the Discover
    // surface shows, so Q answers "who can you tell me about" from the
    // platform rather than from nothing.
    discovery: createDiscoveryService({
      repository: createPostgresDiscoveryRepository({ sql: database.sql }),
    }),
    ...(researchComposition.research === undefined
      ? {}
      : { research: researchComposition.research }),
    ...(researchComposition.profiles === undefined
      ? {}
      : { profiles: researchComposition.profiles }),
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
  statements: researchComposition.statements,
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
const orchestrationRuntime = createQOrchestrationRuntime({
  ...runtimeDependencies,
  repositories,
});
const orchestrator = createLangGraphQOrchestrator({
  runtime: orchestrationRuntime,
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

// Runs this process was orchestrating when it last stopped have no engine
// any more. Close them before serving, so a reconnecting client receives one
// terminal, retryable failure instead of "working" forever (CQ-PRE-REC-001 §8).
await createOrphanedRunSweep({
  sql: database.sql,
  runs: repositories.runs,
  runtime: orchestrationRuntime,
  logger,
}).sweep();

// The realtime voice channel (CQ-Q-VOICE-001 C): ElevenLabs as the Speech
// Engine, composed only when its key and a Speech Engine id are configured.
// The key is revealed here, once, and handed to the adapter; the channel
// itself is attached to the HTTP server below, after it listens, on the
// route the Speech Engine resource points at. Without the application API
// origin, spoken turns carry Q conversations only.
const speechSecrets = config.secrets.speechProviders;
const speechEngines = config.voice.speechEngines;
const voiceProvider =
  config.voice.provider === "elevenlabs" &&
  speechSecrets.elevenLabs !== undefined &&
  speechEngines !== undefined
    ? createElevenLabsVoiceProvider({
        apiKey: speechSecrets.elevenLabs.reveal(),
        speechEngines,
      })
    : undefined;
// The Deepgram Voice Agent transport: the key and this server's public
// origin, so the agent's think calls come back here.
const deepgramProvider =
  config.voice.provider === "deepgram" && speechSecrets.deepgram !== undefined
    ? config.voice.publicUrl === undefined
      ? (logger.warn(
          {},
          "Q_VOICE_PROVIDER resolves to deepgram but Q_API_PUBLIC_URL is unset; voice is not composed",
        ),
        undefined)
      : createDeepgramVoiceProvider({
          apiKey: speechSecrets.deepgram.reveal(),
          publicUrl: config.voice.publicUrl,
          thinkPath: Q_VOICE_THINK_PATH,
        })
    : undefined;
const voiceBindings = createVoiceSessionBindings();
// Q conducting the interview: one model-driven turn per utterance, every
// reading validated and recorded through the onboarding runtime.
const interviewer = createInterviewer({
  gateway: modelGateway,
  logger,
  personality: config.voice.personality,
  expressive: config.voice.expressive,
});
const voiceTurnBoard = createVoiceTurnBoard();
const welcomeHost = createWelcomeHost({
  gateway: modelGateway,
  logger,
  personality: config.voice.personality,
  expressive: config.voice.expressive,
});
const pronunciation =
  config.secrets.speechProviders.elevenLabs !== undefined &&
  config.voice.speechEngines !== undefined
    ? createElevenLabsPronunciationTeacher({
        apiKey: config.secrets.speechProviders.elevenLabs.reveal(),
        engineIds: [
          config.voice.speechEngines.default,
          ...(config.voice.speechEngines.male === undefined
            ? []
            : [config.voice.speechEngines.male]),
        ],
        logger,
      })
    : createLoggingPronunciationTeacher(logger);
// One turn handler for every transport: the websocket channel and the
// think route both hand it a bound conversation and a speaker.
const voiceTurn = createVoiceTurnHandler({
  qRuntime,
  qStream,
  interviewer,
  board: voiceTurnBoard,
  welcome: welcomeHost,
  pronunciation,
  ...(presenceComposition === undefined
    ? {}
    : {
        presence: createPresenceTrigger({
          presence: presenceComposition.presence,
          logger,
        }),
      }),
  orchestration: { orchestrator, autostart: Q_ORCHESTRATION_AUTOSTART },
  ...(config.voice.apiBaseUrl === undefined
    ? {}
    : { onboarding: { apiBaseUrl: config.voice.apiBaseUrl } }),
  logger,
});
logger.info(
  {
    speech: speechProviderConfigStatus(
      speechSecrets,
      speechEngines,
      config.voice.provider,
    ),
    interviewApi:
      config.voice.apiBaseUrl === undefined ? "unconfigured" : "configured",
  },
  "voice channel composed",
);

const { app, logger: appLogger } = createApp(
  config,
  {
    authenticator: createSupabaseRequestAuthenticator(
      createSupabaseAccessTokenAuthenticator(supabaseAuth),
    ),
    resolver: createPostgresActorContextResolver({ sql: database.sql }),
    identity: createPostgresApplicationIdentityLookup({ sql: database.sql }),
  },
  {
    qRuntime,
    orchestration: { orchestrator, autostart: Q_ORCHESTRATION_AUTOSTART },
    qActions,
    qStream: { service: qStream },
    ...(voiceProvider === undefined && deepgramProvider === undefined
      ? {}
      : {
          voice: {
            provider: voiceProvider,
            deepgram: deepgramProvider,
            bindings: voiceBindings,
            interviewer,
            apiBaseUrl: config.voice.apiBaseUrl,
            board: voiceTurnBoard,
            welcome: welcomeHost,
            turn: voiceTurn,
            logger,
          },
        }),
  },
);

// The voice channel is attached once the server listens (below); its
// close hook must be registered now, while hooks may still be added.
let voiceChannel: VoiceAttachment | undefined;
app.addHook("onClose", async () => {
  await voiceChannel?.close();
  await runEventNotifier.close();
  await checkpoints.close();
  await database.close();
});

await app.listen({
  port: config.network.port,
  host: config.network.host,
});

if (deepgramProvider !== undefined) {
  appLogger.info(
    { thinkPath: Q_VOICE_THINK_PATH, voices: deepgramProvider.voices },
    "voice transport: deepgram",
  );
}
if (voiceProvider !== undefined) {
  voiceChannel = await attachVoiceChannel(app.server, Q_VOICE_WS_PATH, {
    provider: voiceProvider,
    bindings: voiceBindings,
    turn: voiceTurn,
    logger,
  });
  appLogger.info(
    { path: Q_VOICE_WS_PATH, voices: voiceProvider.voices },
    "voice channel attached",
  );
}

appLogger.info(
  { host: config.network.host, port: config.network.port },
  "service started",
);
