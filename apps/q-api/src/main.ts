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
import {
  CompanyIdSchema,
  createCompanyService,
  createPostgresCompanyQueryPort,
} from "@capital-q/companies";
import { COMPANY_EVENTS } from "@capital-q/companies/events";
import {
  createEventRegistry,
  type ModelDataPosture,
} from "@capital-q/contracts";
import { createRequestDatabaseClient } from "@capital-q/database";
import { createOutboxWriter } from "@capital-q/eventing";
import {
  createOnboardingQRecommendations,
  createOwnOnboardingSummaryReader,
} from "@capital-q/onboarding";
import { createPostgresDocumentQueryPort } from "@capital-q/evidence";
import {
  createPostgresInvestorMandateQueryPort,
  createPostgresInvestorOrganisationQueryPort,
  createPostgresInvestorOrganisationRepository,
} from "@capital-q/investors";
import {
  createInterestService,
  createPostgresRelationshipEventRepository,
  createPostgresRelationshipRepository,
  type RelationshipQueryPort,
} from "@capital-q/network";
import { NETWORK_EVENTS } from "@capital-q/network/events";
import { modelProviderConfigStatus } from "@capital-q/config/model-providers";
import { researchProviderConfigStatus } from "@capital-q/config/research-providers";
import { speechProviderConfigStatus } from "@capital-q/config/speech-providers";
import {
  Q_VOICE_SPEECH_PATH,
  Q_VOICE_THINK_PATH,
  Q_VOICE_WS_PATH,
} from "@capital-q/contracts";
import {
  createModelGateway,
  createModelProviderRegistry,
  createSyntheticDemoRoutingAllowance,
  createPostgresModelCatalog,
  createPostgresModelUsageRepository,
  createProcessLocalProviderHealth,
  type ModelProvider,
} from "@capital-q/model-gateway";
import { withTestRouting } from "@capital-q/model-gateway";
import { createQDelegationReader } from "@capital-q/model-gateway/q";
import { createGoogleModelProvider } from "@capital-q/model-gateway/providers/google";
import { createGroqModelProvider } from "@capital-q/model-gateway/providers/groq";
import { createOpenAIModelProvider } from "@capital-q/model-gateway/providers/openai";
import { createLogger, createTelemetryRuntime } from "@capital-q/observability";
import { createPostgresOrganisationQueryPort } from "@capital-q/organisations";
import { createRecommendationNarrator } from "@capital-q/q-specialists";
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
  createQActionNarrator,
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
import {
  createMemoryService,
  createPostgresMemoryRepository,
} from "@capital-q/q-knowledge";
import {
  ActorContextSchema,
  createAuthorizationService,
  type ActorContext,
} from "@capital-q/security";
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
import { createQArtifacts } from "./composition/artifacts.js";
import {
  createCompanyProfileUpdateAction,
  createProfileUpdateBoard,
} from "./composition/company-profile-action.js";
import { createCompanyVisibilitySetAction } from "./composition/company-visibility-action.js";
import { createExpressInterestAction } from "./composition/express-interest-action.js";
import { createRespondToInterestAction } from "./composition/respond-to-interest-action.js";
import {
  chainProposers,
  createRelationshipActionBoard,
  createRelationshipIntelligencePort,
} from "./composition/relationship-intelligence.js";
import { createInvestorFeedPort } from "./composition/investor-feed.js";
import {
  createDiscoveryService,
  createPostgresCompanyCardPort,
  createCurrentSlateExplanationService,
  createPostgresDiscoveryRepository,
  createPostgresInvestorDecisionReader,
  createRecommendationExplanationService,
  createSlateReadPipeline,
  readFeatureSnapshotById,
} from "@capital-q/discovery";

import { composePresence } from "./composition/presence.js";
import { createPresenceTrigger } from "./voice/presence-trigger.js";
import { composeResearch } from "./composition/research.js";
import { createSupabaseRequestAuthenticator } from "./security/supabase-authenticator.js";
import { attachVoiceChannel } from "./voice/attach.js";
import { createVoiceSessionBindings } from "./voice/bindings.js";
import { createInterviewAgent } from "./voice/interview-agent.js";
import { createInterviewer } from "./voice/interviewer.js";
import { createLoggingPronunciationTeacher } from "./voice/pronunciation.js";
import { createElevenLabsPronunciationTeacher } from "./voice/providers/elevenlabs-pronunciation.js";
import { createVoiceTurnBoard } from "./voice/turn-board.js";
import { createWelcomeHost } from "./voice/welcome.js";
import type { VoiceAttachment } from "./voice/provider.js";
import { createDeepgramVoiceProvider } from "./voice/providers/deepgram.js";
import {
  createDeepgramSpeakStream,
  createDeepgramSpeechSynthesis,
} from "./voice/providers/deepgram-speak.js";
import { speechWithFallback } from "./voice/synthesis.js";
import {
  createElevenLabsSpeechRelay,
  createElevenLabsSpeechSynthesis,
} from "./voice/providers/elevenlabs-speak.js";
import { createElevenLabsVoiceProvider } from "./voice/providers/elevenlabs.js";
import { Q_VOICE_SPEAK_RELAY_PATH } from "./voice/routes.js";
import { createSpeechPerformanceBoard } from "./voice/speech-performance.js";
import { createVoiceTurnHandler } from "./voice/turn.js";
import {
  createVoiceTurnTimings,
  timedFetch,
  timedModelGateway,
  timedVoiceTurns,
} from "./voice/turn-timing.js";
import { createDecisionReader } from "./voice/decision.js";
import { createPersonProfileUpdateAction } from "./composition/person-profile-action.js";
import {
  createConversationDigestPort,
  createMemoryLearner,
  withLearning,
} from "./composition/memory-learner.js";

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
  createRelationshipQSubjectResolver(relationships, relationshipParties),
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
const ownInvestorOrganisations = createPostgresInvestorOrganisationRepository();
const runtimeDependencies = {
  sql: database.sql,
  transactions: database.transactions,
  subjects,
  securityEvents: createPostgresSecurityEventWriter({ sql: database.sql }),
  logger,
  // An investor asking about a company carries their own firm as context,
  // resolved from their membership on the server (CQ-QX-007).
  ownInvestorOrganisation: async (actor: ActorContext) => {
    if (actor.organisationId === undefined) return null;
    const found = await ownInvestorOrganisations.findByOrganisation(
      database.sql,
      actor.tenantId,
      actor.organisationId,
    );
    return found === null ? null : found.id;
  },
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
    createGoogleModelProvider({
      apiKey: providerSecrets.google.reveal(),
      additionalApiKeys: providerSecrets.googleKeys
        .slice(1)
        .map((key) => key.reveal()),
    }),
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
// The routing policies name gpt-5.6-luna first for every task class
// (20261008130000); a provider routed to but never registered is
// PROVIDER_UNCONFIGURED on every call, and every turn fell through to
// the free tiers it was meant to replace.
if (providerSecrets.openai !== undefined) {
  providers.push(
    createOpenAIModelProvider({ apiKey: providerSecrets.openai.reveal() }),
  );
}
/**
 * Doc 15 §62: free/shared inference may be used aggressively for synthetic
 * data and development, while confidential customer information still
 * requires an approved provider. This is the attestation that this
 * deployment holds the former — an operator opt-in, checked again against
 * the environment and the database before it counts for anything. Null
 * everywhere a real customer is served, which is what makes a
 * SYNTHETIC_DEMO posture inert there.
 */
const syntheticDemo = createSyntheticDemoRoutingAllowance({
  operatorEnabled: providerSecrets.syntheticDemoRouting,
  environment: config.runtime.deploymentEnvironment,
  databaseUrl: loadDatabaseConfig().secrets.url,
  hostedAttested: providerSecrets.syntheticDemoAttested,
  ...(providerSecrets.syntheticDemoProjectRef === undefined
    ? {}
    : { syntheticProjectRef: providerSecrets.syntheticDemoProjectRef }),
  supabaseUrl: config.public.supabaseUrl,
});

/**
 * What kind of material this service handles (doc 15 section 62).
 *
 * Named once rather than spelled out at each call site: it is the same
 * question every time, and four copies of a ternary is four chances to get
 * one of them backwards. Null attestation means REAL_CUSTOMER, which is
 * what every deployment serving a real person gets.
 */
const demoDataPosture: ModelDataPosture =
  syntheticDemo === null ? "REAL_CUSTOMER" : "SYNTHETIC_DEMO";

/**
 * The diagnostic route, when a local or test deployment names one
 * (QX-004 core gate).
 *
 * `withTestRouting` puts one provider's models first in every routing
 * policy and refuses loudly anywhere it could touch a real person. It had
 * only ever been applied by the interview smoke harness: this server read
 * CQ_TEST_MODEL_PROVIDER into its config, logged it as composed, and never
 * routed a single call through it -- so every local acceptance run was
 * still at the mercy of two free tiers. Absent, the catalogue is returned
 * unchanged, which is the ordinary case and the production one.
 */
const modelCatalog = withTestRouting(
  createPostgresModelCatalog({ sql: database.sql }),
  {
    providerCode: providerSecrets.testProviderCode,
    environment: config.runtime.deploymentEnvironment,
    syntheticDemoPermitted: syntheticDemo !== null,
  },
);

/**
 * Where each spoken turn's time goes (CQ-VOICE-010): one line per voice
 * turn, "voice turn timed". Created before the gateway so that every model
 * call made inside a voice turn is listed on it, whichever part of Q made
 * it. Outside a voice turn the wrapper adds nothing.
 */
const voiceTimings = createVoiceTurnTimings({ logger });
const modelGateway = timedModelGateway(
  createModelGateway({
    catalog: modelCatalog,
    registry: createModelProviderRegistry(providers),
    usage: createPostgresModelUsageRepository({ sql: database.sql }),
    health: createProcessLocalProviderHealth(),
    syntheticDemo,
    logger,
  }),
  voiceTimings,
);
logger.info(
  { modelProviders: modelProviderConfigStatus(providerSecrets) },
  "model gateway composed",
);
/**
 * Whether this deployment attested its material is invented, and on what
 * grounds (ADR 0014).
 *
 * The allowance has carried these conditions for the startup log since it
 * was written and nothing logged them, so the one security-relevant fact
 * about a deployment's routing was invisible until a request failed. The
 * conditions are names, never values: which environment, which project,
 * never a key.
 */
logger.info(
  {
    dataPosture: demoDataPosture,
    attestation: syntheticDemo?.attestation ?? null,
  },
  syntheticDemo === null
    ? "no synthetic-demo attestation: every request is a customer's"
    : "synthetic-demo attestation accepted",
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
  dataPosture: demoDataPosture,
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

/**
 * Why an investor is seeing a company (CQ-REC-007). The facts come from the
 * recommendation context, replayed from the item's own feature snapshot
 * under the ranking version its slate recorded. Q is offered the same
 * facts and may phrase them; if it cannot be reached, or says something
 * the factors do not support, the deterministic wording is what ships.
 *
 * It is composed here, in the Q service, because a person asking "why" is
 * asking Q — and because this is where the Model Gateway already lives.
 */
const slateRead = createSlateReadPipeline({
  sql: database.sql,
  disclosure,
  logger,
});
const recommendationExplanations = createRecommendationExplanationService({
  ports: slateRead.eligibilityPorts,
  slates: slateRead.slates,
  snapshots: { byId: (id) => readFeatureSnapshotById(database.sql, id) },
  cards: createPostgresCompanyCardPort({ sql: database.sql }),
  narrator: createRecommendationNarrator({
    gateway: modelGateway,
    // Doc 15 §62: where the server attested the data is invented, the
    // free model may carry the demo. Elsewhere this is REAL_CUSTOMER and
    // the reviewed ceilings decide, exactly as before.
    dataPosture: demoDataPosture,
    logger,
  }),
  logger,
});

/**
 * The same explanation, reachable from a conversation (CQ-REC-007R B).
 *
 * The HTTP route is handed the slate the surface was showing. A person
 * asking Q has no slate in their hand, so it is resolved from their own
 * investor organisation — and a model is never given a field to put one
 * in. Same service, same snapshot, same ranking version: one explanation
 * engine with two ways in, rather than two engines that will disagree.
 */
const currentSlateExplanations = createCurrentSlateExplanationService({
  ports: slateRead.eligibilityPorts,
  slates: slateRead.slates,
  explanations: recommendationExplanations,
  logger,
});

// Express Interest (CQ-NET-010): the Network context's command, composed
// as the application API composes it — the feed's investor subject, the
// network-preview disclosure rule, the same capability, idempotency and
// outbox — so Q's approved action and the feed button are one command.
const interestService = createInterestService({
  sql: database.sql,
  transactions: database.transactions,
  companies,
  investors,
  outbox: createOutboxWriter({
    registry: createEventRegistry(NETWORK_EVENTS),
  }),
  audit: createPostgresMaterialActionAuditWriter(),
  authorization,
  investorSubject: slateRead.eligibilityPorts.investorSubject,
  companyVisibility: {
    isVisibleToInvestor: async (actor, companyId) => {
      const decision = await disclosure.canDisclose({
        principal: actorPrincipal(actor),
        resource: { type: "company", id: companyId },
        requestedAccess: "view",
      });
      return (
        decision.outcome === "ALLOW" &&
        (decision.reasonCode === "NETWORK_VISIBLE" ||
          decision.reasonCode === "PUBLIC_EXTERNAL")
      );
    },
  },
});
// Relationship intelligence (CQ-Q-030): Q reads where the person's own
// side stands with a counterparty through the same InterestService, and
// prepares relationship actions on this board for the Approval Engine --
// it never executes one.
const relationshipBoard = createRelationshipActionBoard({ logger });

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
    // An investor's "what should I look at" is answered from their own
    // feed — the same reader the Discover surface calls — and their own
    // Save/Pass decisions by company id (CQ-QACT-001).
    investorFeed: createInvestorFeedPort({
      reader: slateRead.reader,
      ports: slateRead.eligibilityPorts,
      cards: createPostgresCompanyCardPort({ sql: database.sql }),
      decisions: createPostgresInvestorDecisionReader({ sql: database.sql }),
      logger,
    }),
    // Why a company is in this person's recommendations, from the
    // recommendation context itself. Without it Q explains nothing about
    // ranking, which is correct rather than degraded: the alternative is a
    // model reasoning about fit on its own (doc 19 §59).
    recommendationExplanations: currentSlateExplanations,
    ...(researchComposition.research === undefined
      ? {}
      : { research: researchComposition.research }),
    ...(researchComposition.profiles === undefined
      ? {}
      : { profiles: researchComposition.profiles }),
    relationships: createRelationshipIntelligencePort({
      interests: interestService,
      board: relationshipBoard,
    }),
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
// The companies context's own command surface, for the one action below.
// Composed here exactly as the application API composes it: the same
// service, the same `company.edit` check, the same outbox and audit.
const companyService = createCompanyService({
  sql: database.sql,
  transactions: database.transactions,
  authorization,
  organisations: createPostgresOrganisationQueryPort({ sql: database.sql }),
  // Only the companies context's own events can leave this writer.
  outbox: createOutboxWriter({ registry: createEventRegistry(COMPANY_EVENTS) }),
  audit: createPostgresMaterialActionAuditWriter(),
});
// A requested profile change travels from the answer seam to the proposer
// on this board (ADR 0011); the Approval Engine does everything after.
const profileBoard = createProfileUpdateBoard({ logger });
const identity = createPostgresApplicationIdentityLookup({ sql: database.sql });
const qActionRepositories = createPostgresQActionRepositories();
const qActionRegistry = createQActionRegistry([
  createCompanyProfileUpdateAction({
    profiles: companies,
    service: companyService,
    authorization,
    logger,
  }),
  // Who can see the company: the Visibility screen's own two choices,
  // through the same companies command it calls (CQ-QACT-001).
  createCompanyVisibilitySetAction({
    profiles: companies,
    service: companyService,
    authorization,
    logger,
  }),
  // Express Interest: the feed button's own command, approved (CQ-NET-010).
  createExpressInterestAction({ interests: interestService, logger }),
  // The company's answer: the inbox's own command, approved (CQ-NET-011).
  createRespondToInterestAction({ interests: interestService, logger }),
  // What Q calls the person: their own record, their own approval.
  createPersonProfileUpdateAction({
    people: {
      updateDisplayName: ({ userId, displayName }) =>
        identity.updateDisplayNameOfUser?.(userId, displayName) ??
        Promise.resolve(false),
    },
    logger,
  }),
]);
const qActions = createQActionService({
  sql: database.sql,
  transactions: database.transactions,
  repositories: qActionRepositories,
  runtime: repositories,
  registry: qActionRegistry,
  authorization,
  audit: createPostgresMaterialActionAuditWriter(),
  securityEvents: createPostgresSecurityEventWriter({ sql: database.sql }),
  outbox: createOutboxWriter({
    registry: createEventRegistry(Q_ACTION_EVENTS),
  }),
  logger,
});
const qActionPort = createQActionPort({
  service: qActions,
  // A relationship action Q prepared this run first (CQ-Q-030), then a
  // profile change; one proposal per run either way.
  proposer: chainProposers(relationshipBoard.proposer, profileBoard),
  // What Q says about an action is read from the records the engine
  // wrote, never from what a model intended (CQ-QACT-001).
  narrator: createQActionNarrator({
    sql: database.sql,
    transactions: database.transactions,
    runtime: repositories,
    actions: qActionRepositories.actions,
    registry: qActionRegistry,
    logger,
  }),
  logger,
});

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
const embeddings = createProductionEmbeddingService();
// One embedding before anyone asks for one. The runtime loads its model
// on first use, and that cost landed on the first person to speak after a
// start: a retrieval that should take under a second took twelve. Best
// effort and detached; a runtime that is not there yet is reported by
// retrieval itself, per request, as a degradation.
void embeddings
  .embedQuery("Capital Q is starting.", "EVIDENCE_RETRIEVAL", {
    signal: AbortSignal.timeout(30_000),
  })
  .then(() => logger.info({}, "embedding runtime warm"))
  .catch((error: unknown) =>
    logger.warn({ err: error }, "embedding runtime not warmed"),
  );
// What Q remembers about a person (ADR 0012): the memory service over
// q_knowledge.memory_items, its write gate, and the learner that runs
// after every run to propose memories and keep the conversation summary
// current. Recall is composed into the prompts below; learning is hung on
// the orchestrator further down.
const ownOnboardingSummaries = createOwnOnboardingSummaryReader({
  sql: database.sql,
});
const displayNameFor = async (actor: ActorContext): Promise<string | null> => {
  // A profile belongs to a person, not to a tenant: the predicate is the
  // acting user's own id, so this can only ever read the caller's name.
  const rows = await database.sql<
    { display_name: string | null }[]
  >`select p.display_name
      from identity.user_profiles p
     where p.id = ${actor.userId}
       and p.status = 'active'
     limit 1`;
  return rows[0]?.display_name ?? null;
};
const memoryService = createMemoryService({
  sql: database.sql,
  transactions: database.transactions,
  repository: createPostgresMemoryRepository(),
  conversations: createConversationDigestPort(repositories, database.sql),
  logger,
});
const memoryLearner = createMemoryLearner({
  gateway: modelGateway,
  dataPosture: demoDataPosture,
  memory: memoryService,
  repositories,
  sql: database.sql,
  transactions: database.transactions,
  people: { displayNameFor },
  logger,
});
/**
 * The artifact context (QX-003D; ADR 0013).
 *
 * Composed before the intelligence path, because the answer seam takes
 * the preparation port: a person who asks Q for a brief gets one written
 * inside their own run, under that run's own authorised plan.
 */
const qArtifacts = createQArtifacts({
  sql: database.sql,
  transactions: database.transactions,
  gateway: modelGateway,
  logger,
});
const qIntelligence = composeQIntelligence({
  // The attestation is the claim about the data; where it holds, every
  // founder, investor and company this process will see was invented.
  dataPosture: demoDataPosture,
  sql: database.sql,
  transactions: database.transactions,
  repositories,
  tools: qTools.port,
  gateway: modelGateway,
  embeddings,
  statements: researchComposition.statements,
  profileUpdates: profileBoard,
  memory: memoryLearner.recall,
  // Who the person is, from their own setup (CQ-QX-007): their name and
  // their own onboarding sessions, read by their own user id only. The
  // gateway asks only when the firewall granted OWN_ONBOARDING.
  ownOnboarding: {
    read: async (actor: ActorContext) => ({
      name: await displayNameFor(actor),
      journeys: await ownOnboardingSummaries.read(actor.userId),
    }),
  },
  // The same bus the run stream publishes from, so an answer reaches a
  // person as it is written rather than after it.
  deltas: liveDeltas,
  artifacts: qArtifacts.preparation,
  artifactReviser: qArtifacts.reviser,
  visibility: profileBoard,
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
const checkpointDatabase = loadDatabaseConfig();
const checkpoints = createPostgresQCheckpointStore({
  connectionString: resolveDatabaseUrl(checkpointDatabase, "REQUEST"),
  // A second pool against the same server: it takes a share of the same
  // budget rather than the driver's default, because what runs out is the
  // database's client limit, not this process's.
  poolMax: Math.max(1, Math.floor(checkpointDatabase.poolMax / 2)),
  connectTimeoutSeconds: checkpointDatabase.connectTimeoutSeconds,
  idleTimeoutSeconds: checkpointDatabase.idleTimeoutSeconds,
});
const orchestrationRuntime = createQOrchestrationRuntime({
  ...runtimeDependencies,
  repositories,
});
const orchestrator = withLearning(
  createLangGraphQOrchestrator({
    runtime: orchestrationRuntime,
    cancelRun: qRuntime.cancelRun,
    checkpoints,
    firewall,
    retrieval: qIntelligence.retrieval,
    answer: qIntelligence.answer,
    actions: qActionPort,
    pausePolicy: neverPause,
    logger,
  }),
  memoryLearner,
);

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
// Fenced by silence (CQ-QACT-001): another process's live run is never
// touched, so a second instance or a rolling deploy is safe. Periodic,
// because a run this process's predecessor left behind is only closed
// once it has been quiet long enough to be certainly nobody's.
const orphanSweep = createOrphanedRunSweep({
  sql: database.sql,
  runs: repositories.runs,
  runtime: orchestrationRuntime,
  logger,
});
await orphanSweep.sweep();
setInterval(
  () => {
    orphanSweep.sweep().catch((error: unknown) => {
      logger.warn({ err: error }, "orphaned q run sweep failed");
    });
  },
  5 * 60 * 1000,
).unref();

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
/**
 * How Q's words sound, kept apart from what they are (CQ-VOICE-010): the
 * delivery cues for each session's sentences wait here for the speak relay
 * and never enter the text, the transcript or the thread.
 */
const speechPerformance = createSpeechPerformanceBoard();
/**
 * Q's voice (QX-004 SPEAK rework): Deepgram listens, Q thinks, ElevenLabs
 * speaks. Composed from the ElevenLabs key alone — it needs no Speech
 * Engine resource, because this is plain text-to-speech and not the
 * whole-transport Speech Engine next to it.
 *
 * v3 conversational first, turbo for any utterance v3 fails or is slow to
 * start, and Aura-2 (same Deepgram key as the transport) for one ElevenLabs
 * cannot voice at all (CQ-VOICE-010).
 */
const elevenLabsSpeech =
  speechSecrets.elevenLabs === undefined
    ? undefined
    : {
        oneWay: createElevenLabsSpeechSynthesis({
          apiKey: speechSecrets.elevenLabs.reveal(),
          model: config.voice.ttsModel,
        }),
        relay: createElevenLabsSpeechRelay({
          apiKey: speechSecrets.elevenLabs.reveal(),
          model: config.voice.ttsModel,
          performance: speechPerformance,
          timings: voiceTimings,
          ...(speechSecrets.deepgram === undefined
            ? {}
            : {
                aura: createDeepgramSpeakStream({
                  apiKey: speechSecrets.deepgram.reveal(),
                }),
              }),
        }),
      };
// The Deepgram Voice Agent transport: the key and this server's public
// origin, so the agent's think calls come back here — and, when ElevenLabs
// is configured, its speak calls too.
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
          ...(elevenLabsSpeech === undefined
            ? {}
            : {
                speak: {
                  path: Q_VOICE_SPEAK_RELAY_PATH,
                  relay: elevenLabsSpeech.relay,
                },
              }),
        })
    : undefined;
/**
 * Q reading a line aloud (Q-FIRST-RUN-TTS-001).
 *
 * ElevenLabs where it is configured, so a first-run greeting and a spoken
 * conversation are the same voice; Deepgram otherwise, which is what the
 * preview stack falls back to. Deliberately not conditional on
 * `Q_API_PUBLIC_URL` or on a realtime transport: those exist because the
 * Voice Agent has to call this server back, and nothing calls back for
 * one-way synthesis.
 */
const speechSynthesis = speechWithFallback([
  ...(elevenLabsSpeech === undefined ? [] : [elevenLabsSpeech.oneWay]),
  // Aura-2 speaks a line only when ElevenLabs cannot (CQ-VOICE-010), and
  // is the whole voice on a build without an ElevenLabs key.
  ...(speechSecrets.deepgram === undefined
    ? []
    : [
        createDeepgramSpeechSynthesis({
          apiKey: speechSecrets.deepgram.reveal(),
        }),
      ]),
]);
const voiceBindings = createVoiceSessionBindings();
// Q conducting the interview: one model-driven turn per utterance, every
// reading validated and recorded through the onboarding runtime.
const interviewer = createInterviewer({
  gateway: modelGateway,
  // Doc 15 §62: where the deployment attested the material is invented,
  // the free route may carry the interview. Elsewhere this is
  // REAL_CUSTOMER and the reviewed ceilings decide, exactly as before.
  // Without it a staging interview had no eligible route the moment one
  // provider was spent, which is the whole of the QX-004 §0 defect.
  dataPosture: demoDataPosture,
  logger,
  personality: config.voice.personality,
  // Never inline audio tags in what Q says (CQ-VOICE-010). A tag written
  // into the reply is in the transcript, the thread and memory, and a voice
  // that cannot render it reads it out ("[laughs]" measured as "Halfs" on
  // turbo v2.5). How a reply sounds travels beside it, never inside it, so
  // Q_VOICE_EXPRESSIVE no longer reaches a prompt.
  expressive: false,
  // The interview meets the same person twice and knows it (ADR 0012).
  memory: {
    recallText: (attribution) =>
      voiceTimings.measure("memory", "recall", () =>
        memoryLearner.recall.recall({
          actor: ActorContextSchema.parse({
            userId: attribution.userId,
            tenantId: attribution.tenantId,
            actorType: "HUMAN",
          }),
          runId: "interview",
          subjects: [],
        }),
      ),
  },
});
// The interview as a tool-calling Q run (ADR 0016): the same firewall,
// tool pipeline and gateway as every Q answer.
const interviewAgent = createInterviewAgent({
  gateway: modelGateway,
  firewall,
  logger,
  memory: memoryService,
  recommendations: createOnboardingQRecommendations({
    transactions: database.transactions,
  }),
  // Which choices the person handed to Q, read independently of the
  // acting model: a delegated write is permitted only for those.
  delegation: createQDelegationReader({
    gateway: modelGateway,
    logger,
    dataPosture: demoDataPosture,
  }),
  dataPosture: demoDataPosture,
});
const voiceTurnBoard = createVoiceTurnBoard();
const welcomeHost = createWelcomeHost({
  gateway: modelGateway,
  logger,
  personality: config.voice.personality,
  // As for the interviewer: no stage directions inside what Q says.
  expressive: false,
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
const voiceTurn = timedVoiceTurns(
  createVoiceTurnHandler({
    qRuntime,
    qStream,
    interviewer,
    interviewAgent,
    board: voiceTurnBoard,
    welcome: welcomeHost,
    pronunciation,
    // A spoken yes to a proposal is the same decision a tap records.
    approvals: qActions,
    // And whether it was a yes is read from their words (ADR 0011).
    decisions: createDecisionReader({ gateway: modelGateway, logger }),
    ...(presenceComposition === undefined
      ? {}
      : {
          presence: createPresenceTrigger({
            presence: presenceComposition.presence,
            // What a company's own website says it does is offered into an
            // empty short description, through the same approval as any
            // change the person asks for (ADR 0011).
            profileSuggestions: profileBoard,
            profiles: {
              shortDescriptionOf: async (companyId) =>
                (
                  await companies.findCanonicalCompanyProfile(
                    CompanyIdSchema.parse(companyId),
                  )
                )?.shortDescription ?? null,
            },
            // The name to look a person up by, read from their own profile
            // row. Their own only: the query is keyed on the acting user.
            people: { displayNameFor },
            logger,
          }),
        }),
    orchestration: { orchestrator, autostart: Q_ORCHESTRATION_AUTOSTART },
    ...(config.voice.apiBaseUrl === undefined
      ? {}
      : {
          onboarding: {
            apiBaseUrl: config.voice.apiBaseUrl,
            // Each application-API call a spoken turn makes is listed on
            // that turn's timing line, by route shape only.
            fetch: timedFetch(fetch, voiceTimings),
          },
        }),
    // How each reply should sound, for the speak relay (CQ-VOICE-010).
    performance: speechPerformance,
    logger,
  }),
  voiceTimings,
);
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
    identity,
  },
  {
    qRuntime,
    artifacts: qArtifacts.service,
    recommendationExplanations,
    orchestration: { orchestrator, autostart: Q_ORCHESTRATION_AUTOSTART },
    qActions,
    qStream: { service: qStream },
    // Q as an MCP server, only where a deployment turned it on. The same
    // registry and pipeline a run uses; a different modality, no more
    // authority.
    ...(config.connectors.mcpServer
      ? {
          mcp: {
            firewall,
            registry: qTools.registry,
            tools: qTools.port,
            logger,
          },
        }
      : {}),
    ...(voiceProvider === undefined &&
    deepgramProvider === undefined &&
    speechSynthesis === undefined
      ? {}
      : {
          voice: {
            provider: voiceProvider,
            deepgram: deepgramProvider,
            speech: speechSynthesis,
            bindings: voiceBindings,
            interviewer,
            interviewAgent,
            apiBaseUrl: config.voice.apiBaseUrl,
            board: voiceTurnBoard,
            welcome: welcomeHost,
            turn: voiceTurn,
            memory: { termsFor: memoryLearner.termsFor },
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
    {
      thinkPath: Q_VOICE_THINK_PATH,
      voices: deepgramProvider.voices,
      // Which vendor is actually audible. The transport being Deepgram
      // says nothing about the voice since the speak provider became
      // configurable, and "which voice am I hearing" was otherwise only
      // answerable by listening.
      speak:
        deepgramProvider.speakRelay === undefined
          ? "deepgram-aura-2"
          : `elevenlabs (relayed via ${Q_VOICE_SPEAK_RELAY_PATH})`,
    },
    "voice transport: deepgram",
  );
  /**
   * Can the speech provider actually reach us? (QX-004 core gate.)
   *
   * The Voice Agent brings every turn back to `Q_API_PUBLIC_URL`, and
   * when that origin is wrong the only thing anyone sees is the
   * provider's own `FAILED_TO_THINK` in a browser console: audio flows,
   * the agent speaks its greeting, the microphone is fine, and nothing
   * whatsoever appears in this service's log, because nothing arrives.
   * A tunnel that rotated overnight cost a night to find that way.
   *
   * So the origin is asked, once, whether it reaches this server. An
   * unauthenticated think is refused with 401, and that refusal is the
   * proof: it means the route is there and answering. Anything else is
   * reported with the origin named, and nothing is blocked -- a warning
   * at boot, not a service that will not start.
   */
  void (async () => {
    const origin = config.voice.publicUrl;
    if (origin === undefined) return;
    try {
      const probe = await fetch(
        `${origin}${Q_VOICE_THINK_PATH}/chat/completions`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ messages: [] }),
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (probe.status === 401) return;
      appLogger.warn(
        { publicUrl: origin, status: probe.status },
        "Q_API_PUBLIC_URL does not reach this server's think route; the speech provider will report FAILED_TO_THINK",
      );
    } catch (error: unknown) {
      appLogger.warn(
        { publicUrl: origin, err: error },
        "Q_API_PUBLIC_URL is unreachable; the speech provider will report FAILED_TO_THINK",
      );
    }
  })();
}
if (speechSynthesis !== undefined) {
  appLogger.info(
    { path: Q_VOICE_SPEECH_PATH, voices: speechSynthesis.voices },
    `one-way speech: ${speechSynthesis.name}`,
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
