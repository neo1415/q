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

import { randomUUID } from "node:crypto";

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
import { CAPITAL_EVENTS } from "@capital-q/capital/events";
import {
  CapitalObjectiveNotFoundError,
  createCapitalService,
  createPostgresCapitalObjectiveQueryPort,
} from "@capital-q/capital";
import {
  CompanyIdSchema,
  createCompanyService,
  createPostgresCompanyMarketplaceQueryPort,
  createPostgresCompanyQueryPort,
} from "@capital-q/companies";
import {
  createCompanyMediaOwnerResolver,
  createMediaOwnerResolverRegistry,
  createMediaService,
  cuesAround,
  MediaAssetIdSchema,
} from "@capital-q/media";
import { MEDIA_EVENTS } from "@capital-q/media/events";
import { COMPANY_EVENTS } from "@capital-q/companies/events";
import { EVIDENCE_EVENTS } from "@capital-q/evidence/events";
import { ONBOARDING_EVENTS } from "@capital-q/onboarding/events";
import { ORGANISATION_EVENTS } from "@capital-q/organisations/events";
import { TAXONOMY_EVENTS } from "@capital-q/taxonomy/events";
import {
  createFounderOnboardingIntegration,
  FOUNDER_REVISABLE_STEPS,
} from "@capital-q/founder-onboarding";
import {
  createInvestorOnboardingIntegration,
  INVESTOR_REVISABLE_STEPS,
} from "@capital-q/investor-onboarding";
import { createPexelsPhotos } from "./composition/stock-photos.js";
import {
  createDocumentImages,
  createSupabaseDocumentImageStore,
} from "./composition/document-images.js";
import {
  createImageGateway,
  type ImageProvider,
} from "@capital-q/model-gateway/images";
import { createGoogleImageProvider } from "@capital-q/model-gateway/images/google";
import { createOpenAIImageProvider } from "@capital-q/model-gateway/images/openai";
import {
  createDocumentStudioPort,
  createDocumentsModule,
  ownCompanyOf,
} from "./composition/documents.js";
import { createRecallBots } from "./composition/recall-bots.js";
import { createOpenerFacts } from "./voice/returning-opener.js";
import { createScout } from "./composition/scout.js";
// AUTO block (ADR 0030): Q's delegated work.
import {
  createWorkActionBoard,
  createWorkPort,
  createWorkStartActions,
} from "./composition/work/actions.js";
import { createWorkComposers } from "./composition/work/composers.js";
import { createWorkRuntime } from "./composition/work/runtime.js";
import { createPostgresWorkStore } from "./composition/work/store.js";
import {
  createCounterpartNudger,
  createWorkWakeListener,
} from "./composition/waiting.js";
import {
  type ErrandNegotiation,
  createErrandReplyComposer,
  createErrandRunner,
  createErrandStartAction,
  createPostgresErrandStore,
} from "./composition/errands.js";
import { loadAppEmailConfig } from "@capital-q/config/app-email";
import {
  createDailyReaderService,
  createPostgresDailyReaderStore,
} from "@capital-q/q-daily";

import {
  createPostgresStandingStore,
  PERSONALITY_NOTES,
} from "./voice/standing.js";
import {
  createPostgresRehearsalStore,
  createRehearsalComposer,
  createRehearsalService,
  type Sourced,
} from "./composition/rehearsals.js";
import { createMeetingNotesComposer } from "./composition/meeting-notes.js";
import {
  createProfileAnswerAction,
  type ProfileAnswersPort,
} from "./composition/profile-answer-action.js";
import {
  CorrelationIdSchema,
  QRunIdSchema,
  createEventRegistry,
  type ModelDataPosture,
  type QViewingMoment,
} from "@capital-q/contracts";
import { createRequestDatabaseClient } from "@capital-q/database";
import { createOutboxWriter } from "@capital-q/eventing";
import {
  createOnboardingNudges,
  createOnboardingQRecommendations,
  createOnboardingService,
  OnboardingSessionIdSchema,
  createOwnOnboardingSummaryReader,
} from "@capital-q/onboarding";
import {
  composeChat,
  composeSchedule,
  // AUTO block (2026-10-02)
  createCounterpartNotices,
  meetingIcs,
  createMeetingAssistantService,
  createNetworkMeetingActivityWriter,
} from "@capital-q/communication";
import {
  createPostgresDocumentQueryPort,
  DocumentIdSchema,
} from "@capital-q/evidence";
import {
  createInvestorService,
  createPostgresInvestorMandateQueryPort,
  createPostgresInvestorOrganisationQueryPort,
  createPostgresInvestorOrganisationRepository,
  createPostgresInvestorProfileQueryPort,
  InvestorOrganisationIdSchema,
} from "@capital-q/investors";
import { INVESTOR_EVENTS } from "@capital-q/investors/events";
import {
  createCommitmentService,
  createInterestService,
  createPostgresRelationshipEventRepository,
  createPostgresRelationshipRepository,
  createRelationshipEventAppender,
  createRelationshipEventRegistry,
  parseSpokenAmount,
  RELATIONSHIP_EVENT_DEFINITIONS,
  sideOfParty,
  type RelationshipQueryPort,
} from "@capital-q/network";
import { NETWORK_EVENTS } from "@capital-q/network/events";
import { modelProviderConfigStatus } from "@capital-q/config/model-providers";
import { researchProviderConfigStatus } from "@capital-q/config/research-providers";
import { speechProviderConfigStatus } from "@capital-q/config/speech-providers";
import {
  QActionProposalIdSchema,
  Q_WORK_WAKE_CHANNEL,
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
import {
  createCorrelationId,
  createLogger,
  createTelemetryRuntime,
} from "@capital-q/observability";
import { createPostgresOrganisationQueryPort } from "@capital-q/organisations";
import { createRecommendationNarrator } from "@capital-q/q-specialists";
import {
  actorPrincipal,
  createDefaultDisclosureResolvers,
  createDisclosureAccessService,
  createDisclosureResourceResolverRegistry,
  createPermissionsService,
  createPostgresDisclosurePolicyRepository,
  createRelationshipPartyResolver,
  createVisibilityCentre,
  systemDisclosureClock,
} from "@capital-q/permissions";
import { PERMISSIONS_EVENTS } from "@capital-q/permissions/events";
import {
  createPostgresQActionRepositories,
  createQActionNarrator,
  createQActionPort,
  createQActionRegistry,
  createQActionService,
} from "@capital-q/q-actions";
import { Q_ACTION_EVENTS } from "@capital-q/q-actions/events";
import { createContextFirewall } from "@capital-q/q-firewall";
import { createQTools, type DocumentStudioPort } from "@capital-q/q-tools";
// BILLING block (ADR 0034)
import {
  createEntitlementService,
  FEATURE_DELEGATIONS,
} from "@capital-q/billing";
import {
  createQEntitlementPort,
  meteredQAction,
} from "./composition/entitlements.js";
// end BILLING block
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
  createKnowledgeQueryService,
  createMemoryService,
  createPostgresKnowledgeRepository,
  createPostgresMemoryRepository,
} from "@capital-q/q-knowledge";
import {
  OrganisationIdSchema,
  TenantIdSchema,
  createAuthorizationService,
  type ActorContext,
} from "@capital-q/security";
import {
  createPostgresActorContextResolver,
  createPostgresApplicationIdentityLookup,
  createPostgresAuthorizationPolicySource,
  createPostgresPersonProfileStore,
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
import {
  createRevokeShareAction,
  createShareRaiseAction,
  createVisibilityActionBoard,
} from "./composition/visibility-actions.js";
import { createInvestorFeedPort } from "./composition/investor-feed.js";
import { createDiscoveryDecisionPort } from "./composition/discovery-decisions.js";
import {
  createEvidenceDocumentsPort,
  createOwnRecordsPort,
  createRelationshipMailPort,
} from "./composition/own-records.js";
import {
  createRecordChangeActions,
  createRecordChangeBoard,
} from "./composition/record-change-actions.js";
import {
  createDiscoveryService,
  createInteractionSignalService,
  createPostgresCompanyCardPort,
  createPostgresInteractionRepository,
  createCurrentSlateExplanationService,
  createPostgresDiscoveryRepository,
  createPostgresInvestorDecisionReader,
  createRecommendationExplanationService,
  createSlateReadPipeline,
  readFeatureSnapshotById,
} from "@capital-q/discovery";

import {
  composePresence,
  createPresenceReadPort,
} from "./composition/presence.js";
import {
  createCompaniesHouseRegistry,
  createInvestorResearchReader,
  createSecEdgarRegistry,
  investorResearchReadFrom,
  createFounderResearchReader,
  founderResearchReadFrom,
} from "./composition/investor-research.js";
import { createInvestorResearch } from "./voice/investor-research.js";
import { createOnboardingPort } from "./voice/onboarding-port.js";
import { createPresenceTrigger } from "./voice/presence-trigger.js";
import { composeResearch } from "./composition/research.js";
import { createSupabaseRequestAuthenticator } from "./security/supabase-authenticator.js";
import { attachVoiceChannel } from "./voice/attach.js";
import { createVoiceSessionBindings } from "./voice/bindings.js";
import { createInterviewAgent } from "./voice/interview-agent.js";
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
  personaVoiceId,
  createElevenLabsSpeechSynthesis,
} from "./voice/providers/elevenlabs-speak.js";
import { createElevenLabsVoiceProvider } from "./voice/providers/elevenlabs.js";
import { Q_VOICE_SPEAK_RELAY_PATH } from "./voice/routes.js";
import { createSpeechPerformanceBoard } from "./voice/speech-performance.js";
import { createVoiceTurnHandler } from "./voice/turn.js";
import {
  createRehearsalAwareTurn,
  performRehearsalLine,
} from "./voice/rehearsal-turn.js";
import {
  createVoiceTurnTimings,
  timedFetch,
  timedModelGateway,
  timedVoiceTurns,
} from "./voice/turn-timing.js";
import { createDecisionReader } from "./voice/decision.js";
import { createPersonProfileUpdateAction } from "./composition/person-profile-action.js";
import { createInvestorProfileUpdateAction } from "./composition/investor-profile-action.js";
import { createProfileChangeBoard } from "./composition/profile-change-board.js";
import { createProfileFindingsReader } from "./composition/profile-findings.js";
import { createHandleClaimAction } from "./composition/handle-claim-action.js";
import { assertComposedActionTypes } from "./composition/q-action-types.js";
import {
  createConversationApprovalPort,
  createPendingDecisionPort,
  plainProposalStatus,
} from "./composition/conversation-approvals.js";
import { createApprovedContinuation } from "./composition/approved-continuation.js";
import { createHandleClaimBoard } from "./composition/handle-claim-board.js";
import {
  createPostgresPublicIdentityRepository,
  createPublicIdentityService,
  createSubjectDirectory,
} from "@capital-q/public-identity";
import {
  createCompanyVerificationService,
  createPublicVerificationReader,
  createVerificationClaimsReadinessPort,
  VERIFICATION_EVENTS,
} from "@capital-q/verification";
import {
  createConversationDigestPort,
  createMemoryLearner,
  withLearning,
} from "./composition/memory-learner.js";
import { ownRecordTerms } from "./voice/vocabulary.js";
import { loadGoogleWorkspaceConfig } from "@capital-q/config/google-workspace";
import {
  composeGoogleIntegrations,
  createPostgresCounterpartDirectory,
  createBrevoApiEmailSender,
  createSmtpAppEmailSender,
  unavailableAppEmailSender,
} from "@capital-q/integrations";
import {
  createEmailActionBoard,
  createEmailIntelligencePort,
  createEmailSendAction,
  createRelationshipCounterparts,
} from "./composition/email-action.js";
import {
  createChatActionBoard,
  createChatIntelligencePort,
  createChatMessageSendAction,
} from "./composition/chat-actions.js";
import {
  createMeetingCancelAction,
  createMeetingRescheduleAction,
  createMeetingScheduleAction,
  createReminderCreateAction,
  createScheduleIntelligencePort,
} from "./composition/schedule-actions.js";
// ADMIN block
import { createResultsReader, resultsWindow } from "@capital-q/results";
import {
  createPlatformAdmin,
  createFlagReader,
  isSuspended as isAccountSuspended,
  recordingEmailSender,
  recordingFirewall,
} from "@capital-q/platform-admin";
import { withSuspension } from "./composition/suspension.js";
// end ADMIN block
// ADMIN-3 block
import {
  createHumanReviewBoard,
  createReviewRequestAction,
} from "./composition/human-review-action.js";
// end ADMIN-3 block

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
// ADMIN block (ADR 0033): every decision is also logged, codes only, for
// the operations console's per-run trace. Recording never alters it.
const firewall = recordingFirewall(
  createContextFirewall({
    authorization,
    disclosure,
    resolvers: disclosureResolvers,
    relationshipParties,
    documents,
    capital,
    clock: systemDisclosureClock,
    logger,
  }),
  {
    sql: database.sql,
    onRecordError: (error) =>
      logger.warn({ err: error }, "firewall decision not recorded"),
  },
);
// end ADMIN block

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
  // R18: what the person was viewing is kept on a run only when the media
  // context says they may play that pitch now (the playback rule, which
  // includes the company's visibility to them). Composed below.
  viewing: {
    authorise: (actor: ActorContext, viewing: QViewingMoment) => {
      const mediaAssetId = MediaAssetIdSchema.safeParse(viewing.mediaAssetId);
      return mediaAssetId.success
        ? pitchMedia.mayPlayPitch({
            actor,
            companyId: viewing.companyId,
            mediaAssetId: mediaAssetId.data,
          })
        : Promise.resolve(false);
    },
  },
  ownInvestorOrganisation: async (actor: ActorContext) => {
    if (actor.organisationId === undefined) return null;
    const found = await ownInvestorOrganisations.findByOrganisation(
      database.sql,
      actor.tenantId,
      actor.organisationId,
    );
    return found === null ? null : found.id;
  },
  // A founder's own company, the default "my company" (CQ-QX-008).
  ownCompany: async (actor: ActorContext) => {
    if (actor.organisationId === undefined) return null;
    const found =
      (await companies.findOrganisationCompany?.(
        actor.tenantId,
        actor.organisationId,
      )) ?? null;
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

/**
 * Pitch media for Q (R18: "Q watches the video with us"): the Media
 * context composed as the application API composes it, with the same
 * viewer rule -- the feed's own REC-001 eligibility -- so Q can read a
 * pitch's transcript exactly when the person could play the pitch, and
 * never otherwise. Q never syncs, uploads or plays anything; it reads.
 */
const pitchMarketplaceFacts = createPostgresCompanyMarketplaceQueryPort({
  sql: database.sql,
});
const pitchMedia = createMediaService({
  sql: database.sql,
  transactions: database.transactions,
  authorization,
  owners: createMediaOwnerResolverRegistry([
    createCompanyMediaOwnerResolver(companies),
  ]),
  outbox: createOutboxWriter({ registry: createEventRegistry(MEDIA_EVENTS) }),
  audit: createPostgresMaterialActionAuditWriter(),
  viewers: {
    resolveViewableCompany: async (actor, companyId) => {
      const investor =
        await slateRead.eligibilityPorts.investorSubject.investorOrganisationFor(
          actor,
        );
      if (investor === null) return null;
      const mandate = await slateRead.eligibilityPorts.mandates.activeMandate({
        tenantId: actor.tenantId,
        investorOrganisationId: investor.investorOrganisationId,
        mandateId: null,
      });
      if (mandate.kind !== "FOUND" || mandate.mandate.status !== "ACTIVE") {
        return null;
      }
      const parsed = CompanyIdSchema.safeParse(companyId);
      if (!parsed.success) return null;
      const evaluation = await slateRead.eligibility.evaluate({
        actor,
        mode: "INVESTOR_DISCOVER",
        mandateId: mandate.mandate.mandateId,
        companyIds: [parsed.data],
      });
      if (
        !evaluation.results.some(
          (result) =>
            result.companyId === parsed.data && result.decision === "ELIGIBLE",
        )
      ) {
        return null;
      }
      const [facts] = await pitchMarketplaceFacts.findCanonicalMarketplaceFacts(
        [parsed.data],
      );
      return facts === undefined
        ? null
        : {
            tenantId: facts.tenantId,
            ownerOrganisationId: facts.organisationId,
          };
    },
  },
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
// A profile change the person asked Q for waits here for approval (BIZ-002).
const profileChangeBoard = createProfileChangeBoard({ logger });
// Email on a relationship (BIZ-007): the person's own connected Gmail,
// through the integrations context. The approved `email.send` executes
// here, so q-api carries the same Google variables as api and workers.
const googleWorkspace = loadGoogleWorkspaceConfig(process.env);
// Approved meeting.*, email.send execute on THIS service: without these
// every approved call or email fails as "not connected", so say so loudly.
if (
  googleWorkspace.oauth === undefined ||
  googleWorkspace.tokenEncryptionKey === undefined
) {
  logger.error(
    {
      missing: [
        ...(googleWorkspace.oauth === undefined
          ? ["GOOGLE_WORKSPACE_CLIENT_ID", "GOOGLE_WORKSPACE_CLIENT_SECRET"]
          : []),
        ...(googleWorkspace.tokenEncryptionKey === undefined
          ? ["GOOGLE_TOKEN_ENCRYPTION_KEY"]
          : []),
      ],
    },
    "google workspace not configured on q-api: approved meetings and emails cannot execute",
  );
} else {
  logger.info(
    {},
    "google workspace configured on q-api: approved meetings and emails execute here",
  );
}
const integrations = composeGoogleIntegrations({
  sql: database.sql,
  transactions: database.transactions,
  oauth: googleWorkspace.oauth,
  tokenEncryptionKey: googleWorkspace.tokenEncryptionKey,
  pushTopic: googleWorkspace.push?.topic,
  logger,
});
const emailBoard = createEmailActionBoard();
const emailInvestorNames = createPostgresInvestorProfileQueryPort({
  sql: database.sql,
});
const relationshipCounterparts = createRelationshipCounterparts({
  interests: interestService,
  directory: createPostgresCounterpartDirectory({ sql: database.sql }),
  nameOf: async (kind, id) => {
    if (kind === "INVESTOR_ORGANISATION") {
      return (
        (await emailInvestorNames.findCanonicalInvestorProfile(id))
          ?.displayName ?? null
      );
    }
    const companyId = CompanyIdSchema.safeParse(id);
    return companyId.success
      ? ((await companies.findCanonicalCompanyProfile(companyId.data))
          ?.canonicalName ?? null)
      : null;
  },
});
// Relationship chat (R34): the same composition api uses. Q reads a thread
// only for a party, and posts only as an approved `chat.message.send`.
const chatBoard = createChatActionBoard();
const chat = composeChat({
  sql: database.sql,
  transactions: database.transactions,
  interests: interestService,
  ownDocument: async (actor, documentId) => {
    const parsed = DocumentIdSchema.safeParse(documentId);
    if (!parsed.success) return null;
    const { document, currentVersion } =
      await researchComposition.evidence.getDocumentWithVersion({
        actor,
        documentId: parsed.data,
      });
    return currentVersion === null
      ? null
      : {
          versionId: currentVersion.id,
          title: document.title,
          mimeType: currentVersion.mimeType,
          sizeBytes: currentVersion.sizeBytes,
          malwareScanStatus: currentVersion.malwareScanStatus,
        };
  },
  newCorrelationId: createCorrelationId,
});
// Meetings and reminders (BIZ-008): the person's own Google Calendar
// through the integrations context; approved actions execute here. App
// email (reminders) is the workers' job, so q-api composes none.
const schedule = composeSchedule({
  sql: database.sql,
  transactions: database.transactions,
  interests: interestService,
  calendars: (userId) => integrations.calendarOf(userId),
  email: unavailableAppEmailSender,
  logger,
});
// Handles and the Q Card (BIZ-004), composed as the application API
// composes them: the same service, the same allowlisted subject facts.
const cardVerification = createPublicVerificationReader({
  sql: database.sql,
});
const cardInvestorFacts = createPostgresInvestorProfileQueryPort({
  sql: database.sql,
});
const cardSubjects = createSubjectDirectory({
  findCompany: async (companyId) => {
    const id = CompanyIdSchema.safeParse(companyId);
    return id.success ? companies.findCanonicalCompanyProfile(id.data) : null;
  },
  findInvestor: (investorOrganisationId) =>
    cardInvestorFacts.findCanonicalInvestorProfile(investorOrganisationId),
  companyVerification: async (subject) => {
    const standings = await cardVerification.companyStandings({
      tenantId: TenantIdSchema.parse(subject.tenantId),
      organisationId: OrganisationIdSchema.parse(subject.organisationId),
    });
    return {
      organisation: standings.organisation.verified,
      founderIdentity: standings.founderIdentity.verified,
      demoAttested: {
        organisation: standings.organisation.syntheticDemo,
        founderIdentity: standings.founderIdentity.syntheticDemo,
      },
    };
  },
});
const publicIdentity = createPublicIdentityService({
  sql: database.sql,
  transactions: database.transactions,
  authorization,
  audit: createPostgresMaterialActionAuditWriter(),
  repository: createPostgresPublicIdentityRepository(),
  subjects: cardSubjects,
});
// "Make me a Q card" waits here for approval (BIZ-004).
const handleClaimBoard = createHandleClaimBoard({ publicIdentity, logger });
// ADMIN-3 block: appeals Stage 4 -- Q prepares, the person approves.
const humanReviewBoard = createHumanReviewBoard();
const humanReviews = createPlatformAdmin({
  sql: database.sql,
  transactions: database.transactions,
});
// end ADMIN-3 block

// Who can see what (CQ-BIZ-003): the permissions context's visibility
// centre, composed as the application API composes it -- the same
// disclosure resolvers, the policy manager for shares and revokes, and the
// company's relationships from InterestService's company-side list.
const permissionsService = createPermissionsService({
  sql: database.sql,
  transactions: database.transactions,
  authorization,
  outbox: createOutboxWriter({
    registry: createEventRegistry(PERMISSIONS_EVENTS),
  }),
  audit: createPostgresMaterialActionAuditWriter(),
  resolvers: disclosureResolvers,
  relationshipParties,
});
const visibilityCentre = createVisibilityCentre({
  access: permissionsService.access,
  inspect: permissionsService.inspectResourceDisclosure,
  policies: permissionsService.policies,
  authorization,
  companies,
  capital,
  relationshipParties,
  relationshipsOf: async (actor, companyId) =>
    (
      await interestService.listRelationshipsForCompany({ actor, companyId })
    ).map((listing) => ({
      relationshipId: listing.relationship.id,
      investorOrganisationId: listing.relationship.investorOrganisationId,
      name: listing.counterpartName,
    })),
});
// Shares and revokes Q prepares wait here for the Approval Engine.
const visibilityBoard = createVisibilityActionBoard({ logger });

// The Tool Registry (CQ-Q-007): four SAFE_READ tools over the same public
// query ports and the same two authorities the firewall uses, plus the two
// bounded public-web research tools when a research provider is composed.
// A run is offered only the tools its plan admits; every proposal is
// validated, authorised and executed deterministically before anything
// returns to the model. No SQL, arbitrary HTTP, shell or connector tool
// exists.
// The profile page's "Q found" column (BIZ-002), read by the route and,
// for the person's own profile, by Q (R33).
const profileFindingsReader = createProfileFindingsReader({
  companies,
  investors,
  firewall,
  knowledge: createKnowledgeQueryService({
    sql: database.sql,
    knowledge: createPostgresKnowledgeRepository(),
    logger,
  }),
  evidence: researchComposition.evidence,
  logger,
});

// Setup reminders (founder directive 2026-09-27): the versioned policy
// over the person's own setup, keyed by the actor's own user id. Q says it
// at a natural pause; "later", "stop" and "let's finish it" are tools.
const onboardingNudges = createOnboardingNudges({ sql: database.sql });

// AUTO block (ADR 0030): "Q, handle it". The store, the approval board
// its tools prepare on, and the port every Q surface reads it through.
const workStore = createPostgresWorkStore(database.sql);
const workBoard = createWorkActionBoard();
const workIsInvestor = async (actor: ActorContext): Promise<boolean> =>
  (await slateRead.eligibilityPorts.investorSubject
    .investorOrganisationFor(actor)
    .catch(() => null)) !== null;
const workOwnCompany = (actor: ActorContext): Promise<string | null> =>
  runtimeDependencies.ownCompany(actor).catch(() => null);
const workPort = createWorkPort({
  // Errands are composed further down; read only when a tool asks.
  errands: {
    own: (actor) => errands.own(actor),
    stop: (actor, errandId) => errands.stop(actor, errandId),
  },
  store: workStore,
  board: workBoard,
  isInvestor: workIsInvestor,
  ownCompany: workOwnCompany,
});
// end AUTO block

// ADMIN block (spec admin.md §5): the person's own results for Q's
// get_my_results / get_my_results_report tools. Same read model and raise
// view as the Results page and Capital.
const ownResults = createResultsReader({
  sql: database.sql,
  raise: async (actor, companyId) => {
    let target: { amount: string; currencyCode: string } | null = null;
    try {
      const objective = await capitalService.getCurrentCapitalObjective({
        actor,
        companyId: CompanyIdSchema.parse(companyId),
      });
      target = {
        amount: objective.target.amount,
        currencyCode: objective.target.currency,
      };
    } catch (error: unknown) {
      if (!(error instanceof CapitalObjectiveNotFoundError)) throw error;
    }
    const view = await meetingCommitments.fundraising({
      actor,
      companyId,
      target,
    });
    return {
      target: view.target,
      totals: view.totals,
      remaining: view.remaining,
      pipeline: view.pipeline,
      investors: view.investors.map((investor) => ({
        investorName: investor.investorName,
        amount: investor.amount,
        currencyCode: investor.currencyCode,
        bucket: investor.bucket,
      })),
    };
  },
});
// end ADMIN block
// DAILY block: The Q Daily, read and set by the person (routes and Q's
// tools); editions are prepared by the worker only.
const dailyReader = createDailyReaderService({
  store: createPostgresDailyReaderStore(database.sql),
});
const ownDaily = (actor: {
  readonly userId: string;
  readonly tenantId: string;
}) => ({
  userId: actor.userId,
  tenantId: actor.tenantId,
});
// end DAILY block

// BILLING block (ADR 0034): plans and the meter, the same service the
// API reads; Q's tools see it through the plan gate.
const entitlements = createEntitlementService({ sql: database.sql });
// end BILLING block

// Approval by conversation: the one change waiting for this person in
// this conversation, approved as the card approves it (live test
// 2026-09-27 #1). The engine and orchestrator are composed below.
const conversationApprovals = createConversationApprovalPort({
  runtime: qRuntime,
  late: () => ({ actions: qActions, orchestrator, continueApproved }),
  logger,
});
const errandStore = createPostgresErrandStore(database.sql);
const qTools = createQTools({
  ports: {
    // BILLING block
    entitlements: createQEntitlementPort(entitlements),
    // end BILLING block
    // AUTO block (ADR 0030)
    work: workPort,
    // ADMIN block
    results: {
      read: (actor, query) => ownResults.read(actor, resultsWindow(query)),
    },
    // end ADMIN block
    onboardingReminders: {
      choose: (actor, choice) => onboardingNudges.choose(actor.userId, choice),
      unfinished: (actor) => onboardingNudges.continueTarget(actor.userId),
    },
    // DAILY block
    daily: {
      latest: async (actor) => {
        const home = await dailyReader.home(ownDaily(actor), null, new Date());
        return { edition: home.latest, preferences: home.preferences };
      },
      setPreferences: (actor, patch) =>
        dailyReader.setPreferences(ownDaily(actor), patch, new Date()),
    },
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
      ownCompany: runtimeDependencies.ownCompany,
    }),
    // R18: what is said in the pitch around a moment, under the playback rule.
    pitchMoments: {
      momentAround: async (actor, query) => {
        const mediaAssetId = MediaAssetIdSchema.safeParse(query.pitchId);
        if (!mediaAssetId.success) return null;
        const view = await pitchMedia
          .getPitchTranscriptByPitch({ actor, mediaAssetId: mediaAssetId.data })
          .catch(() => null);
        if (view === null) return null;
        return view.status === "AVAILABLE"
          ? {
              status: "AVAILABLE",
              cues: cuesAround(view.cues, query.atMs, query.windowMs),
            }
          : { status: view.status };
      },
    },
    // BIZ-007: "email the founder", drafted for approval.
    email: createEmailIntelligencePort({
      counterparts: relationshipCounterparts,
      integrations,
      board: emailBoard,
    }),
    // R34: the relationship chat, for the person who invoked Q.
    chat: createChatIntelligencePort({
      chat,
      board: chatBoard,
      // One errand per subject: Q says what it is already doing instead
      // of preparing a second card (QA 2026-10-01).
      activeErrand: (actor, ref) =>
        errandStore.activeFor?.(actor, ref) ?? Promise.resolve(null),
      counterpartName: async (actor, relationshipId) =>
        (await relationshipCounterparts.of(actor, relationshipId))?.name ??
        null,
    }),
    // BIZ-008: calls and reminders, prepared on the chat board.
    schedule: createScheduleIntelligencePort(schedule),
    // BIZ-002: every profile field the page edits, Q can prepare.
    profileChanges: profileChangeBoard,
    visibility: {
      state: (actor, companyId) => visibilityCentre.state({ actor, companyId }),
      prepareForApproval: visibilityBoard.prepareForApproval,
    },
    handleClaims: handleClaimBoard,
    // ADMIN-3 block
    humanReviews: humanReviewBoard,
    // end ADMIN-3 block
    // Approval by conversation: the one change waiting for this person in
    // this conversation, approved as the card approves it (live test
    // 2026-09-27 #1). The engine and orchestrator are composed below.
    pendingProposals: conversationApprovals,
    // Live test 2026-09-27 #4: "is my card saved?" -- the Q Card screen's
    // own read, authorised again by the service (card.view).
    qCards: {
      getCard: async (actor, subject) => {
        const card = await publicIdentity.getCard({
          actor,
          subject: {
            subjectType: subject.subjectType,
            subjectId: subject.subjectId,
          },
        });
        return card === null
          ? null
          : {
              handle: card.handle,
              indexable: card.indexable,
              updatedAt: card.updatedAt,
            };
      },
    },
    // R20/R33: a person's screen reads every Home Q answer, so the app's
    // own browser actions (theme, reload, their website) are Q's too.
    clientActions: true,
    // R33: what waits for their approval, across conversations: the
    // Approval Engine's own listing, as the actor (composed below).
    approvalInbox: {
      pending: async (actor) =>
        (await qActions.listPendingApprovals({ actor, limit: 20 })).map(
          (row) => ({
            approvalId: row.approvalId,
            summary: row.summary,
            requestedAt: row.requestedAt,
            expiresAt: row.expiresAt,
          }),
        ),
    },
    // R33: their own documents, the artifact service's own list, as them.
    documents: {
      list: async (actor, limit) =>
        (await qArtifacts.service.list(actor, { limit })).items.map((item) => ({
          artifactId: item.artifactId,
          type: item.type,
          status: item.status,
          title: item.title,
          currentVersion: item.currentVersion,
          updatedAt: item.updatedAt,
        })),
    },
    // Revising one of their documents into a new version (founder
    // directive 2026-09-28). A closure: the artifact composition is built
    // further down, and only called once a run is under way.
    documentRevision: {
      revise: (input) => qArtifacts.documentRevision.revise(input),
    },
    // DOCS block: brand kit, a document's audit, their brand applied. A
    // closure for the same reason as documentRevision.
    documentStudio: {
      brandState: (actor) => documentStudioPort().brandState(actor),
      suggestBrand: (actor) => documentStudioPort().suggestBrand(actor),
      audit: (actor, artifactId) =>
        documentStudioPort().audit(actor, artifactId),
      applyBrand: (input) => documentStudioPort().applyBrand(input),
      illustrate: (input) => documentStudioPort().illustrate(input),
    },
    // R33: Save / Unsave / Pass, recorded by the interaction service the
    // Discover buttons call, with the feed's own eligibility re-run.
    // R33: the record forms as Prepare -> Approve (the board is composed
    // with the services below), and the person's own records, read through
    // the services their screens call.
    recordChanges: {
      prepare: (entry) => recordChangeBoard.prepare(entry),
    },
    ownRecords: {
      read: (actor, query) => ownRecords.read(actor, query),
      reassessReadiness: (actor, companyId, correlationId) =>
        ownRecords.reassessReadiness(actor, companyId, correlationId),
    },
    evidenceDocuments: createEvidenceDocumentsPort(
      researchComposition.evidence,
    ),
    relationshipMail: createRelationshipMailPort(integrations),
    discoveryDecisions: createDiscoveryDecisionPort(
      createInteractionSignalService({
        ports: slateRead.eligibilityPorts,
        eligibility: slateRead.eligibility,
        slates: slateRead.slates,
        repository: createPostgresInteractionRepository({ sql: database.sql }),
        logger,
      }),
    ),
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
  // R33: readiness (read and reassessed by Q) reads Capital Q's own
  // verification claims, as in the application API.
  verification: createVerificationClaimsReadinessPort({ sql: database.sql }),
});
// A requested profile change travels from the answer seam to the proposer
// on this board (ADR 0011); the Approval Engine does everything after.
const profileBoard = createProfileUpdateBoard({ logger });
const identity = createPostgresApplicationIdentityLookup({ sql: database.sql });
// The person's own profile: the same store `PATCH /v1/me/profile` writes
// through in the application API (BIZ-002), so the page and Q share it.
const people = createPostgresPersonProfileStore({ sql: database.sql });
// The investors context's own command surface, composed as the
// application API composes it, for investor.profile.update (BIZ-002).
const investorService = createInvestorService({
  sql: database.sql,
  transactions: database.transactions,
  authorization,
  organisations: createPostgresOrganisationQueryPort({ sql: database.sql }),
  // Only the investors context's own events can leave this writer.
  outbox: createOutboxWriter({
    registry: createEventRegistry(INVESTOR_EVENTS),
  }),
  audit: createPostgresMaterialActionAuditWriter(),
});
// R33: the capital and verification contexts, composed as the application
// API composes them, for the raise as a Q change and the verification read.
const capitalService = createCapitalService({
  sql: database.sql,
  transactions: database.transactions,
  authorization,
  companies,
  outbox: createOutboxWriter({ registry: createEventRegistry(CAPITAL_EVENTS) }),
  audit: createPostgresMaterialActionAuditWriter(),
});
const verificationService = createCompanyVerificationService({
  sql: database.sql,
  transactions: database.transactions,
  authorization,
  companies,
  outbox: createOutboxWriter({
    registry: createEventRegistry(VERIFICATION_EVENTS),
  }),
  audit: createPostgresMaterialActionAuditWriter(),
});
/**
 * ADR 0024: a profile fact first given during onboarding, revised by Q
 * after approval. The onboarding runtime with the founder and investor
 * write targets, composed as the API composes it, so a revision merges
 * into the mandate or the company exactly as onboarding did.
 */
const revisionOutbox = createOutboxWriter({
  registry: createEventRegistry([
    ...ORGANISATION_EVENTS,
    ...COMPANY_EVENTS,
    ...INVESTOR_EVENTS,
    ...EVIDENCE_EVENTS,
    ...CAPITAL_EVENTS,
    ...TAXONOMY_EVENTS,
    ...ONBOARDING_EVENTS,
  ]),
});
const revisionAudit = createPostgresMaterialActionAuditWriter();
const founderRevisions = createFounderOnboardingIntegration({
  outbox: revisionOutbox,
  audit: revisionAudit,
  securityEvents: createPostgresSecurityEventWriter({ sql: database.sql }),
});
const investorRevisions = createInvestorOnboardingIntegration({
  outbox: revisionOutbox,
  audit: revisionAudit,
  securityEvents: createPostgresSecurityEventWriter({ sql: database.sql }),
});
const onboardingRevisions = createOnboardingService({
  sql: database.sql,
  transactions: database.transactions,
  outbox: revisionOutbox,
  writeTargets: [
    ...(founderRevisions.writeTargets ?? []),
    ...(investorRevisions.writeTargets ?? []),
  ],
  stepContextProviders: [
    ...(founderRevisions.stepContextProviders ?? []),
    ...(investorRevisions.stepContextProviders ?? []),
  ],
  revisableSteps: {
    founder: FOUNDER_REVISABLE_STEPS,
    investor: INVESTOR_REVISABLE_STEPS,
  },
  logger,
});
const profileAnswers: ProfileAnswersPort = {
  completedSession: async (actor, journey) => {
    const view = await onboardingRevisions.runtime.getCurrentSession({
      actor: { userId: actor.userId, context: actor },
      journeyType: journey,
    });
    return view === null || view.session.status !== "COMPLETED"
      ? null
      : { sessionId: view.session.id, version: view.session.version };
  },
  revise: async (input) => {
    const view = await onboardingRevisions.runtime.reviseResponse({
      actor: { userId: input.actor.userId, context: input.actor },
      sessionId: OnboardingSessionIdSchema.parse(input.sessionId),
      stepKey: input.stepKey,
      response: { value: input.value },
      expectedSessionVersion: input.expectedSessionVersion,
      idempotencyKey: input.idempotencyKey,
      correlationId: CorrelationIdSchema.parse(input.correlationId),
    });
    return { sessionVersion: view.session.version };
  },
};
const recordChangeDependencies = {
  companies,
  investors,
  capital: capitalService,
  companyService,
  investorService,
  publicIdentity,
  authorization,
  logger,
};
const recordChangeBoard = createRecordChangeBoard({
  ...recordChangeDependencies,
  profileAnswers,
});
const ownRecords = createOwnRecordsPort({
  companyService,
  investorService,
  capital: capitalService,
  verification: verificationService,
  visibility: visibilityCentre,
  profileFindings: profileFindingsReader,
});
const qActionRepositories = createPostgresQActionRepositories();
// Errands (founder direction 2026-09-29): one approval, an exact plan Q
// carries forward as the relationship moves.
const errandRelationships = createRelationshipIntelligencePort({
  interests: interestService,
  board: relationshipBoard,
  ownCompany: runtimeDependencies.ownCompany,
});
// ADMIN block: a suspended account resolves to no actor (ADR 0033).
const actorContextResolver = withSuspension(
  createPostgresActorContextResolver({ sql: database.sql }),
  (userId) => isAccountSuspended(database.sql, userId),
);
const killSwitches = createFlagReader(database.sql);
// end ADMIN block
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
  // Sharing the raise with an investor, and revoking it (CQ-BIZ-003).
  createShareRaiseAction({
    visibility: visibilityCentre,
    authorization,
    logger,
  }),
  createRevokeShareAction({
    visibility: visibilityCentre,
    authorization,
    logger,
  }),
  // What Q shows about the person: their own record, their own approval.
  createPersonProfileUpdateAction({ people, logger }),
  // The investor organisation's declared profile (BIZ-002).
  // The organisation's public handle and Q Card (BIZ-004).
  // ADMIN-3 block
  createReviewRequestAction({ reviews: humanReviews, logger }),
  // end ADMIN-3 block
  createHandleClaimAction({
    publicIdentity,
    subjects: cardSubjects,
    authorization,
    logger,
  }),
  createInvestorProfileUpdateAction({
    investors: investorService,
    authorization,
    logger,
  }),
  // R33: the record forms (raise, mandate, team, role, Q Card details,
  // investor visibility) as Q changes, each through its own service.
  ...createRecordChangeActions(recordChangeDependencies),
  // ADR 0024: a profile fact from onboarding, revised on approval.
  createProfileAnswerAction({ answers: profileAnswers, logger }),
  // An email on a relationship, from the approver's own Gmail (BIZ-007).
  createEmailSendAction({
    integrations,
    counterparts: relationshipCounterparts,
    logger,
  }),
  // R34: chat message from the relationship chat.
  createChatMessageSendAction({ chat, logger }),
  // BIZ-008: reminders and calls (Google Calendar + Meet).
  createReminderCreateAction({ schedule, logger }),
  createMeetingScheduleAction({ schedule, logger }),
  createMeetingRescheduleAction({ schedule }),
  createMeetingCancelAction({ schedule }),
  // BILLING block (ADR 0034): an errand, outreach or a stand-in each draw
  // one "Q handles it" unit from the plan when they run.
  meteredQAction(
    createErrandStartAction({
      sql: database.sql,
      interests: interestService,
      relationships: errandRelationships,
      chat,
      logger,
    }),
    FEATURE_DELEGATIONS,
    entitlements,
  ),
  // AUTO block (ADR 0030): outreach and stand-in, one approval each.
  ...createWorkStartActions({
    store: workStore,
    isInvestor: workIsInvestor,
    ownCompany: workOwnCompany,
    logger,
  }).map((definition) =>
    meteredQAction(definition, FEATURE_DELEGATIONS, entitlements),
  ),
  // end BILLING block
]);
// Every composed action has a capability entry (R20): the list the
// completeness test reads is the list composed here.
assertComposedActionTypes(qActionRegistry);
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
  proposer: chainProposers(
    relationshipBoard.proposer,
    emailBoard.proposer,
    chatBoard.proposer,
    // AUTO block (ADR 0030)
    workBoard.proposer,
    profileChangeBoard.proposer,
    visibilityBoard.proposer,
    handleClaimBoard.proposer,
    humanReviewBoard.proposer,
    recordChangeBoard.proposer,
    profileBoard,
  ),
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
const embeddings = createProductionEmbeddingService({
  onMissing: (missing) => {
    logger.warn(
      { missing },
      "embedding runtime not configured: semantic retrieval disabled",
    );
  },
});
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
// DOCS block: generated images for documents (ADR 0031 addendum). Off
// unless CQ_DOCUMENT_IMAGES=enabled: every picture spends the founder's
// provider credit, so budgets cap it per document, per organisation per
// day and across Capital Q per day. The image bucket is private and needs
// the server's storage key; without it no picture is made.
const imageProviders: ImageProvider[] = [];
if (providerSecrets.openai !== undefined) {
  imageProviders.push(
    createOpenAIImageProvider({ apiKey: providerSecrets.openai.reveal() }),
  );
}
if (providerSecrets.google !== undefined) {
  imageProviders.push(
    createGoogleImageProvider({ apiKey: providerSecrets.google.reveal() }),
  );
}
const documentImages = createDocumentImages({
  sql: database.sql,
  // BILLING block (ADR 0034): each picture is one unit of the plan's AI images.
  meter: createQEntitlementPort(entitlements, "Q_API"),
  gateway: createImageGateway({
    enabled: config.documentImages.enabled,
    providers: imageProviders,
    usage: createPostgresModelUsageRepository({ sql: database.sql }),
  }),
  store:
    config.secrets.supabaseSecretKey === undefined ||
    config.supabaseAuth === undefined
      ? undefined
      : createSupabaseDocumentImageStore({
          supabaseUrl: config.supabaseAuth.url,
          secretKey: config.secrets.supabaseSecretKey,
        }),
  budgets: config.documentImages,
  logger,
});
// DOCS block: the document studio (brand kit, answer exports).
// The Q tools port is built lazily: the tools are composed before the
// artifact service exists further down.
let studioPort: DocumentStudioPort | undefined;
const documentStudioPort = (): DocumentStudioPort => {
  studioPort ??= createDocumentStudioPort({
    studio: documentStudio,
    artifacts: qArtifacts.service,
  });
  return studioPort;
};
const documentStudio = createDocumentsModule({
  sql: database.sql,
  transactions: database.transactions,
  images: documentImages,
  runMessages: async (actor, runId) =>
    (
      await qRuntime.getRun({
        actor,
        runId: QRunIdSchema.parse(runId),
      })
    ).summary.messages ?? [],
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
  photos: createPexelsPhotos(
    process.env.PEXELS_API_KEY ?? process.env.PEXELS_API,
  ),
  // DOCS: decks about the actor's own company take their confirmed brand
  // and their sector's design; read as the actor, never from model output.
  studio: {
    brandOf: async (actor) => {
      const effective = await documentStudio.brandKit.effective(actor);
      return effective === null
        ? null
        : {
            kitVersion: effective.kitVersion,
            palette: effective.palette,
            pairing: effective.pairing,
          };
    },
    ownCompanyOf: (actor) => ownCompanyOf(database.sql, actor),
    illustrationsFor: (request) =>
      documentImages.illustrationsFor({
        actor: request.actor,
        runId: request.runId,
        correlationId: request.correlationId,
      }),
  },
});
// Q's standing with each person (founder direction 2026-09-30): their chosen
// personality, which every Q surface speaks with, and Q's patience.
const standingStore = createPostgresStandingStore(database.sql);
const qIntelligence = composeQIntelligence({
  // A relationship a hand-over names, planned on its own (QA 2026-10-01).
  firewall,
  // A typed yes or no to a waiting change, read and acted on by code
  // through the Approval Engine (founder fixture #1).
  pendingDecisions: createPendingDecisionPort({
    proposals: conversationApprovals,
    decisions: createDecisionReader({
      gateway: modelGateway,
      logger,
      dataPosture: demoDataPosture,
    }),
  }),
  personalityOf: ({ tenantId, userId }) =>
    standingStore
      .read(userId, tenantId, new Date())
      .then((standing) => PERSONALITY_NOTES[standing.personality]),
  // Their own name and company, from their own record in their own
  // tenant: what they would be annoyed to be asked.
  askerOf: async ({ tenantId, userId }) => {
    const rows = await database.sql<
      {
        display_name: string | null;
        company: string | null;
        website_url: string | null;
        business_title: string | null;
        no_deck: boolean | null;
      }[]
    >`
      select p.display_name, c.canonical_name as company, c.website_url,
             m.business_title,
             m.company_id is not null and not exists (
               select 1 from artifacts.artifacts a
                where a.tenant_id = ${tenantId}
                  and a.created_by_user_id = p.id
                  and a.type = 'PITCH_DECK'
                  and a.archived_at is null) as no_deck
        from identity.user_profiles p
        left join core.company_members m
          on m.user_id = p.id and m.tenant_id = ${tenantId} and m.is_current
        left join core.companies c
          on c.id = m.company_id and c.tenant_id = ${tenantId}
       where p.id = ${userId}
       order by m.is_founder desc nulls last
       limit 1`;
    const row = rows[0];
    if (row === undefined) return null;
    // What research found for their setup and they never confirmed (live
    // 2026-09-30: Nixo's description and country sat pending after
    // onboarding finished). Their own session's suggestions only.
    const found = await database.sql<
      { step_key: string; value: unknown; rationale: string | null }[]
    >`
      select g.step_key, g.suggested_value as value, g.rationale
        from onboarding.suggestions g
        join onboarding.sessions s on s.id = g.session_id
       where s.user_id = ${userId}
         and s.tenant_id = ${tenantId}
         and s.status = 'COMPLETED'
         and g.status = 'PENDING'
       order by g.created_at desc
       limit 4`.catch(() => []);
    const findings = found
      .map((f) => {
        const v = f.value as { text?: unknown; optionKey?: unknown } | null;
        const said =
          typeof v?.text === "string"
            ? v.text
            : typeof v?.optionKey === "string"
              ? v.optionKey
              : null;
        return said === null
          ? null
          : `${f.step_key}: "${said.slice(0, 160)}"${f.rationale === null ? "" : ` (${f.rationale.slice(0, 80)})`}`;
      })
      .filter((f): f is string => f !== null);
    const name = row.display_name?.trim().slice(0, 80) ?? "";
    const company = row.company?.trim().slice(0, 120) ?? "";
    if (name.length === 0 && company.length === 0) return null;
    return [
      name.length === 0 ? "This person" : name,
      company.length === 0
        ? ""
        : `, ${row.business_title === null ? "of" : `${row.business_title.slice(0, 60)} of`} their own company ${company}${row.website_url === null ? "" : ` (${row.website_url.slice(0, 200)})`}`,
      ".",
      // A founder who has no deck yet (often one who put it off until
      // setup was done): Q offers once to make it, never presses.
      row.no_deck === true
        ? " They have no pitch deck yet: when their question is answered, offer once, in one short sentence, to make one with them now."
        : "",
      findings.length === 0
        ? ""
        : ` Research found these for their profile and they have not confirmed them: ${findings.join("; ")}. Offer them once, in one line; if they agree, propose the profile change for their approval.`,
    ].join("");
  },
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
  onboardingNudge: {
    peek: (actor: ActorContext, conversationId: string) =>
      onboardingNudges.peek(actor.userId, {
        surface: "Q_NOTE",
        conversationId,
      }),
    markShown: (actor: ActorContext, conversationId: string) =>
      onboardingNudges.markShown(actor.userId, {
        surface: "Q_NOTE",
        conversationId,
      }),
  },
  // The same bus the run stream publishes from, so an answer reaches a
  // person as it is written rather than after it.
  deltas: liveDeltas,
  artifacts: qArtifacts.preparation,
  artifactReviser: qArtifacts.reviser,
  // What this conversation already produced, read back from the owning
  // records as the person (CQ-QX-008): a document through the artifact
  // service (owner-scoped), an action through its approval record.
  receipts: {
    artifact: async (actor: ActorContext, artifactId: string) => {
      const detail = await qArtifacts.service.read(actor, artifactId);
      return { status: detail.artifact.status };
    },
    // Read as the person, in plain terms: SAVED only when the action
    // executed, never from the approval row alone (live test 2026-09-27 #2).
    action: async (actor: ActorContext, proposalId: string) => {
      const approval = await qActions.findApprovalForAction(
        actor.tenantId,
        QActionProposalIdSchema.parse(proposalId),
      );
      if (approval === null) return null;
      const view = await qActions
        .getApproval({ actor, approvalId: approval.id })
        .catch(() => null);
      return view === null ? null : { status: plainProposalStatus(view) };
    },
  },
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
// What runs an approved action, for the card, a spoken yes and a typed
// yes alike: resume the paused run, or -- when that run can no longer be
// resumed -- the same execution gate directly (live 2026-09-28 #4).
const continueApproved = createApprovedContinuation({
  orchestrator: () => orchestrator,
  actions: qActionPort,
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

// Q in a meeting (founder direction 2026-09-29): the organiser brings Q to
// a booked call through a meeting bot; afterwards Q files notes. Composed
// only where the bot provider's key is set. The collector reads a bot only
// once its call has started, every two minutes, so a trial budget is spent
// on calls, not on polling.
const meetingCommitments = createCommitmentService({
  sql: database.sql,
  transactions: database.transactions,
  interests: interestService,
  appender: createRelationshipEventAppender({
    registry: createRelationshipEventRegistry(RELATIONSHIP_EVENT_DEFINITIONS),
    repositories: {
      relationships: createPostgresRelationshipRepository(),
      events: createPostgresRelationshipEventRepository(),
    },
  }),
  newCorrelationId: () => CorrelationIdSchema.parse(`cor_${randomUUID()}`),
});
const meetingAssistant = createMeetingAssistantService({
  sql: database.sql,
  bots: createRecallBots({
    apiKey: process.env.RECALL_API_KEY ?? process.env.RECALL_API,
    region: process.env.RECALL_REGION ?? "eu-central-1",
  }),
  composer: createMeetingNotesComposer({
    gateway: modelGateway,
    dataPosture: demoDataPosture,
    logger,
  }),
  // ADR 0027: the call is marked on the relationship's history once its
  // record exists, through Network's own appender.
  onHeld: async (held) => {
    const writer = createNetworkMeetingActivityWriter();
    await database.transactions.run((tx) =>
      writer.record(tx, {
        relationshipId: held.relationshipId,
        eventType: "meeting_held",
        meetingId: held.meetingId,
        actorUserId: held.organiserUserId,
        correlationId: `cor_${randomUUID()}`,
      }),
    );
    // Founder direction 2026-09-30: money said in the call is filed by Q
    // for both sides to adopt or dispute; it never counts until confirmed.
    for (const [index, signal] of held.commitments.entries()) {
      const money = parseSpokenAmount(signal.amount);
      if (money === null) continue;
      await meetingCommitments
        .detect({
          relationshipId: held.relationshipId,
          meetingId: held.meetingId,
          amount: money.amount,
          currencyCode: money.currencyCode,
          level: signal.firmness === "FIRM" ? "FIRM" : "SOFT",
          statedBySide: sideOfParty(signal.party, held.attendees),
          quote: signal.quote,
          key: `meeting:${held.meetingId}:${String(index)}`,
        })
        .catch((error: unknown) => {
          logger.warn(
            { err: error, meetingId: held.meetingId },
            "detected commitment not filed",
          );
        });
    }
  },
  // A declined recording stays on the relationship's history.
  onDeclined: async (declined) => {
    const writer = createNetworkMeetingActivityWriter();
    await database.transactions.run((tx) =>
      writer.record(tx, {
        relationshipId: declined.relationshipId,
        eventType: "meeting_recording_declined",
        meetingId: declined.meetingId,
        actorUserId: declined.declinedByUserId,
        correlationId: `cor_${randomUUID()}`,
      }),
    );
  },
  nameOf: (userId) =>
    database.sql<{ display_name: string | null }[]>`
      select display_name from identity.user_profiles where id = ${userId} limit 1`.then(
      (rows) => rows[0]?.display_name ?? null,
    ),
  logger,
});
setInterval(
  () => {
    // ADR 0027: every booked call gets Q, enlisted shortly before it starts.
    meetingAssistant
      .enlist()
      .then(() => meetingAssistant.collect())
      .catch((error: unknown) => {
        logger.warn({ err: error }, "meeting assistant collection failed");
      });
  },
  2 * 60 * 1000,
).unref();

// AUTO block (founder direction 2026-10-01): one gentle reminder to a
// silent counterpart, shared by errands and delegated work.
const counterpartNudger = createCounterpartNudger(database.sql);
// AUTO block (2026-10-02): booking without Google -- Q offers times in the
// chat, reads the answer by meaning, records the agreed meeting and emails
// both sides an invite (.ics); and the other side hears what Q did.
const counterpartNotices = createCounterpartNotices(database.sql);
const inviteEmailConfig = loadAppEmailConfig(process.env);
const inviteEmail =
  inviteEmailConfig.brevoApi !== undefined
    ? recordingEmailSender(
        createBrevoApiEmailSender(inviteEmailConfig.brevoApi),
        {
          sql: database.sql,
          source: "q_api.meeting_invite",
          provider: "BREVO_API",
        },
      )
    : inviteEmailConfig.smtp === undefined
      ? unavailableAppEmailSender
      : recordingEmailSender(createSmtpAppEmailSender(inviteEmailConfig.smtp), {
          sql: database.sql,
          source: "q_api.meeting_invite",
          provider: "SMTP",
        });
const errandComposers = createWorkComposers({
  gateway: modelGateway,
  dataPosture: demoDataPosture,
  logger,
});
const errandNegotiation: ErrandNegotiation = {
  zoneOf: async (userId) =>
    (
      await database.sql<{ timezone: string | null }[]>`
        select timezone from identity.user_profiles where id = ${userId}`
    )[0]?.timezone ?? null,
  readSlots: (input) =>
    errandComposers.slotReader(input.actor, {
      principalName: input.principalName,
      counterpartName: input.counterpartName,
      offered: input.offered,
      timeZone: input.timeZone,
      now: input.now,
      reply: input.reply,
    }),
  recordAgreed: (input) => schedule.recordAgreed(input),
  sendInvites: async (invite) => {
    if (!inviteEmail.available) throw new Error("app email is not configured");
    const ics = meetingIcs({
      uid: invite.meetingId,
      sequence: 0,
      start: invite.start,
      end: invite.end,
      summary: invite.purpose,
      description: `${invite.purpose}\n\nAgreed on Capital Q. A video link will follow.`,
      location: null,
      organiser: invite.organiser,
      attendees: invite.invitees,
      createdAt: new Date(),
    });
    const when = new Intl.DateTimeFormat("en-GB", {
      dateStyle: "full",
      timeStyle: "short",
      timeZone: invite.timeZone,
    }).format(invite.start);
    for (const person of [invite.organiser, ...invite.invitees]) {
      await inviteEmail.send({
        to: person.email,
        subject: `Call: ${invite.purpose}`
          .replace(/[\r\n]+/g, " ")
          .slice(0, 150),
        text: `${invite.purpose}\n${when} (${invite.timeZone})\n\nThe calendar invite is attached. A video link will follow.`,
        attachments: [
          {
            filename: "invite.ics",
            content: ics,
            contentType: "text/calendar; method=REQUEST",
          },
        ],
      });
    }
  },
};
const errands = createErrandRunner({
  nudger: counterpartNudger,
  counterpartNotices,
  negotiation: errandNegotiation,
  store: errandStore,
  resolver: actorContextResolver,
  chat,
  schedule,
  relationships: errandRelationships,
  composer: createErrandReplyComposer({
    gateway: modelGateway,
    dataPosture: demoDataPosture,
    logger,
  }),
  nameOf: (userId) =>
    database.sql<{ display_name: string | null }[]>`
      select display_name from identity.user_profiles where id = ${userId} limit 1`.then(
      (rows) => rows[0]?.display_name ?? null,
    ),
  logger,
});
setInterval(() => {
  // ADMIN block: the operators' kill switch stops every errand step.
  killSwitches
    .isEnabled("q.autonomy.errands")
    .then((enabled) => (enabled ? errands.tick() : undefined))
    .catch((error: unknown) => {
      logger.warn({ err: error }, "errand run failed");
    });
}, 60 * 1000).unref();

// AUTO block (ADR 0030): Q's delegated work on LangGraph, checkpointed in
// q_runtime.checkpoint* beside the conversation runs, so a deploy never
// loses a wait. Every step runs as the person, through their own commands.
const workFeed = createInvestorFeedPort({
  reader: slateRead.reader,
  ports: slateRead.eligibilityPorts,
  cards: createPostgresCompanyCardPort({ sql: database.sql }),
  decisions: createPostgresInvestorDecisionReader({ sql: database.sql }),
  logger,
});
const workRuntime = createWorkRuntime({
  nudger: counterpartNudger,
  counterpartNotices,
  noCalendar: {
    zoneOf: errandNegotiation.zoneOf,
    recordAgreed: errandNegotiation.recordAgreed,
    sendInvites: errandNegotiation.sendInvites,
  },
  // ADMIN block: the operators' kill switch (ADR 0033).
  enabled: () => killSwitches.isEnabled("q.autonomy.delegations"),
  // end ADMIN block
  store: workStore,
  checkpoints,
  resolver: actorContextResolver,
  authUserOf: async (userId) =>
    (
      await database.sql<{ auth_user_id: string | null }[]>`
        select auth_user_id from identity.user_profiles where id = ${userId}`
    )[0]?.auth_user_id ?? null,
  composers: createWorkComposers({
    gateway: modelGateway,
    dataPosture: demoDataPosture,
    logger,
  }),
  chat,
  schedule,
  interests: interestService,
  relationships: errandRelationships,
  feed: async (actor, limit) =>
    (await workFeed.page(actor, limit))?.items ?? null,
  pitchTranscript: async (actor, companyId, mediaAssetId) => {
    const id = MediaAssetIdSchema.safeParse(mediaAssetId);
    if (!id.success) return null;
    const view = await pitchMedia.getPitchTranscript({
      actor,
      companyId,
      mediaAssetId: id.data,
    });
    return view.status === "AVAILABLE"
      ? view.cues.map((cue) => cue.text).join(" ")
      : null;
  },
  mandateText: async (actor) => {
    const own =
      await slateRead.eligibilityPorts.investorSubject.investorOrganisationFor(
        actor,
      );
    if (own === null) return null;
    const tenantId = TenantIdSchema.parse(actor.tenantId);
    const organisationId = InvestorOrganisationIdSchema.parse(
      own.investorOrganisationId,
    );
    const active = await mandates.listActiveMandates(tenantId, organisationId);
    const first = active[0];
    if (first === undefined) return null;
    const mandate = await mandates.getMandate(
      tenantId,
      organisationId,
      first.id,
    );
    // Their own declared mandate, as data for the shortlist; ids dropped.
    return mandate === null
      ? null
      : JSON.stringify(mandate, (key, value: unknown) =>
          /id$/i.test(key) ? undefined : value,
        ).slice(0, 3_000);
  },
  ownCompany: workOwnCompany,
  nameOf: (userId) =>
    database.sql<{ display_name: string | null }[]>`
      select display_name from identity.user_profiles where id = ${userId} limit 1`.then(
      (rows) => rows[0]?.display_name ?? null,
    ),
  logger,
});
setInterval(() => {
  workRuntime.tick().catch((error: unknown) => {
    logger.warn({ err: error }, "q work run failed");
  });
}, 60 * 1000).unref();
// Acceptance wakes waiting work at once (founder direction 2026-10-01):
// the workers' outbox consumer announces the relationship on this channel.
void createWorkWakeListener({
  listen: (channel, onNotify, onListen) =>
    database.listen(channel, onNotify, onListen),
  channel: Q_WORK_WAKE_CHANNEL,
  catchUp: () => {
    void workRuntime.tick().catch(() => undefined);
  },
  targets: [
    {
      name: "errands",
      wake: async (relationshipId) =>
        (await killSwitches.isEnabled("q.autonomy.errands"))
          ? errands.wake(relationshipId)
          : 0,
    },
    {
      name: "delegations",
      wake: (relationshipId) => workRuntime.wake(relationshipId),
    },
  ],
  logger,
})
  .start()
  .then(() => logger.info({}, "q work wake listener started"))
  .catch((error: unknown) => {
    // The minute's tick still carries the work; only the instant wake is lost.
    logger.warn({ err: error }, "q work wake listener not started");
  });
// end AUTO block

// The Investor Twin (founder direction 2026-09-30, C12): a founder
// rehearses a meeting with an investor Q plays. Every read below answers
// for the founder's own side: the investor as Discover or their own
// relationship shows them, the other side's messages in their own chat,
// and calls the founder was on. Never the investor's mandate or Q chats.

// REHEARSE block (founder direction 2026-10-01; C12 generalised): a person
// rehearses a meeting with someone they are connected to, played by Q.
// Every read below answers for the rehearsing person's own side only: the
// counterpart as Discover or their own relationship shows them, the other
// side's messages in their own chat, calls they were on, a company's pitch
// only under the playback rule and its knowledge only where it is network
// or publicly visible, and the founder's own material. Never the other
// person's Q chats, mandate internals or founder-private records.
const rehearsalDiscovery = createDiscoveryService({
  repository: createPostgresDiscoveryRepository({ sql: database.sql }),
});
const transcriptText = async (
  actor: ActorContext,
  companyId: string,
  label: string,
): Promise<Sourced> => {
  // Ids only; whether this person may read each pitch is the media
  // context's own playback rule, applied by getPitchTranscript.
  const assets = await database.sql<{ id: string }[]>`
    select id from media.media_assets
     where owner_type = 'COMPANY' and owner_id = ${companyId}
       and purpose = 'FOUNDER_PITCH' and deleted_at is null
       and superseded_at is null
     order by created_at desc limit 2`;
  const texts: string[] = [];
  for (const asset of assets) {
    const id = MediaAssetIdSchema.safeParse(asset.id);
    if (!id.success) continue;
    const view = await pitchMedia
      .getPitchTranscript({ actor, companyId, mediaAssetId: id.data })
      .catch(() => null);
    if (view?.status === "AVAILABLE") {
      texts.push(view.cues.map((cue) => cue.text).join(" "));
    }
  }
  return texts.length === 0
    ? { text: "", sources: [] }
    : {
        text: `PITCH VIDEO TRANSCRIPT:\n${texts.join("\n---\n")}`.slice(
          0,
          9_000,
        ),
        sources: [{ kind: "PITCH_TRANSCRIPT", label, url: null }],
      };
};
const knowledgeText = async (
  companyId: string,
  scopes: readonly string[],
  label: string,
): Promise<Sourced> => {
  const rows = await database.sql<{ statement: string; truth_class: string }[]>`
    select statement, truth_class from q_knowledge.objects
     where subject_type = 'COMPANY' and subject_id = ${companyId}
       and status = 'ACTIVE' and visibility_scope = any(${scopes as string[]})
     order by recorded_at desc limit 40`;
  return rows.length === 0
    ? { text: "", sources: [] }
    : {
        text: `WHAT IS KNOWN (truth class in brackets):\n${rows
          .map((row) => `- [${row.truth_class}] ${row.statement}`)
          .join("\n")}`.slice(0, 5_000),
        sources: [{ kind: "PUBLIC_KNOWLEDGE", label, url: null }],
      };
};
/**
 * An uploaded pitch deck's words: the text chunks document processing
 * already extracted into Postgres (q_knowledge.chunks), for the current
 * version of a PITCH_DECK document of this company, in slide order, only
 * in the visibility scopes the caller names.
 */
const uploadedDeckText = async (
  companyId: string,
  scopes: readonly string[],
): Promise<string> => {
  const rows = await database.sql<{ content: string }[]>`
    select c.content from q_knowledge.chunks c
      join evidence.document_versions v on v.id = c.document_version_id
      join evidence.documents d on d.id = v.document_id
     where c.subject_type = 'COMPANY' and c.subject_id = ${companyId}
       and c.status = 'ACTIVE' and c.role = 'LEAF'
       and d.document_type = 'PITCH_DECK'
       and c.visibility_scope = any(${scopes as string[]})
     order by c.chunk_index limit 60`;
  return rows
    .map((row) => row.content)
    .join("\n")
    .slice(0, 6_000);
};
/** Every string in a document's content, in order: the deck's words. */
const contentWords = (value: unknown, out: string[] = []): string[] => {
  if (typeof value === "string") {
    if (value.length > 1 && !/^https?:\/\//.test(value)) out.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) contentWords(item, out);
  } else if (value !== null && typeof value === "object") {
    for (const item of Object.values(value)) contentWords(item, out);
  }
  return out;
};
const rehearsals = createRehearsalService({
  store: createPostgresRehearsalStore(database.sql),
  material: {
    viewer: async (actor) => {
      const companyId = await runtimeDependencies.ownCompany(actor);
      if (companyId !== null) {
        const profile = await companies
          .findCanonicalCompanyProfile(CompanyIdSchema.parse(companyId))
          .catch(() => null);
        return profile === null
          ? null
          : { role: "FOUNDER", organisationName: profile.canonicalName };
      }
      const firmId = await runtimeDependencies.ownInvestorOrganisation(actor);
      if (firmId === null) return null;
      const firm = await investors
        .findCanonicalInvestorOrganisation(
          InvestorOrganisationIdSchema.parse(firmId),
        )
        .catch(() => null);
      return firm === null
        ? null
        : { role: "INVESTOR", organisationName: firm.displayName };
    },
    counterpart: async (actor, kind, id) => {
      if (kind === "INVESTOR_ORGANISATION") {
        const [relationship, seen] = await Promise.all([
          errandRelationships.withInvestor(actor, id).catch(() => null),
          rehearsalDiscovery.findInvestor(actor, id).catch(() => null),
        ]);
        if (relationship === null && seen === null) return null;
        const name =
          seen?.displayName ??
          (
            await investors
              .findCanonicalInvestorOrganisation(
                InvestorOrganisationIdSchema.parse(id),
              )
              .catch(() => null)
          )?.displayName ??
          null;
        if (name === null) return null;
        const profile = [
          `Name: ${name}`,
          seen === null ? null : `Type: ${seen.investorType}`,
          seen?.hqCountry == null ? null : `Based in: ${seen.hqCountry}`,
          seen?.deploymentState == null
            ? null
            : `Deploying: ${seen.deploymentState}`,
          seen?.publicDescription == null
            ? null
            : `In their own words: ${seen.publicDescription}`,
          relationship === null
            ? null
            : `Where things stand with you: ${relationship.state}`,
        ]
          .filter((line): line is string => line !== null)
          .join("\n");
        return {
          name,
          profile,
          relationshipId: relationship?.relationshipId ?? null,
        };
      }
      const companyId = CompanyIdSchema.safeParse(id);
      if (!companyId.success) return null;
      const [relationship, visible] = await Promise.all([
        errandRelationships.withCompany(actor, id).catch(() => null),
        subjectView.canView(actor, { type: "company", id }).catch(() => false),
      ]);
      if (relationship === null && !visible) return null;
      const company = await companies
        .findCanonicalCompanyProfile(companyId.data)
        .catch(() => null);
      if (company === null) return null;
      // The declared, network-projected fields only (no financials).
      const profile = [
        `Company: ${company.canonicalName}`,
        company.currentStageCode === null
          ? null
          : `Stage: ${company.currentStageCode}`,
        company.headquartersCountry === null
          ? null
          : `Based in: ${company.headquartersCity ?? ""} ${company.headquartersCountry}`,
        company.websiteUrl === null ? null : `Website: ${company.websiteUrl}`,
        company.shortDescription === null
          ? null
          : `In their words: ${company.shortDescription}`,
        company.primaryDescription === null
          ? null
          : `About: ${company.primaryDescription.slice(0, 2_000)}`,
        relationship === null
          ? null
          : `Where things stand with you: ${relationship.state}`,
      ]
        .filter((line): line is string => line !== null)
        .join("\n");
      return {
        name: company.canonicalName,
        profile,
        relationshipId: relationship?.relationshipId ?? null,
      };
    },
    theirMessages: async (actor, relationshipId) => {
      const read = await chat.readForQ({ actor, relationshipId, limit: 60 });
      return read.messages
        .filter((message) => message.from === "OTHER_SIDE")
        .flatMap((message) =>
          message.text === null
            ? []
            : [`${message.senderName}: ${message.text}`],
        )
        .join("\n");
    },
    theirCalls: async (actor, relationshipId) => {
      const meetings =
        (await schedule.listMeetings(actor, relationshipId)) ?? [];
      const calls = await Promise.all(
        meetings
          .slice(0, 5)
          .map((meeting) =>
            meetingAssistant.read(actor, meeting.id).catch(() => null),
          ),
      );
      return calls
        .flatMap((call) => call?.transcript ?? [])
        .map((line) => `${line.speaker ?? "Someone"}: ${line.text}`)
        .join("\n");
    },
    counterpartMaterial: async (actor, kind, id) => {
      if (kind !== "COMPANY") return { text: "", sources: [] };
      const [pitch, known, uploaded] = await Promise.all([
        transcriptText(actor, id, "Their pitch video"),
        knowledgeText(
          id,
          ["network_visible", "public_external"],
          "What Capital Q shows of them",
        ),
        // Only a deck they made visible to the network or the public.
        uploadedDeckText(id, ["network_visible", "public_external"]).catch(
          () => "",
        ),
      ]);
      return {
        text: [
          pitch.text,
          known.text,
          uploaded.length === 0 ? "" : `THEIR DECK:\n${uploaded}`,
        ]
          .filter((t) => t.length > 0)
          .join("\n\n"),
        sources: [
          ...pitch.sources,
          ...known.sources,
          ...(uploaded.length === 0
            ? []
            : [{ kind: "DECK" as const, label: "Their deck", url: null }]),
        ],
      };
    },
    publicWeb: async (_actor, name, kind) => {
      const provider = researchComposition.provider;
      if (provider === undefined) return { text: "", sources: [] };
      const result = await provider.search(
        {
          query:
            `"${name.trim()}" ${kind === "COMPANY" ? "startup founder" : "investor"}`.slice(
              0,
              200,
            ),
          maxResults: 5,
          freshness: "ANY",
          includeDomains: [],
        },
        { signal: AbortSignal.timeout(12_000) },
      );
      const hits = result.hits.filter((hit) => hit.url.startsWith("https://"));
      return {
        text: hits
          .map((hit) => `${hit.title ?? hit.url}: ${hit.snippet ?? ""}`)
          .join("\n"),
        sources: hits.map((hit) => ({
          kind: "PUBLIC_WEB" as const,
          label: (hit.title ?? hit.url).slice(0, 200),
          url: hit.url.slice(0, 2048),
          excerpt: (hit.snippet ?? "").slice(0, 600),
        })),
      };
    },
    ownMaterial: async (actor) => {
      const companyId = await runtimeDependencies.ownCompany(actor);
      if (companyId === null || actor.organisationId === undefined) {
        return { text: "", sources: [] };
      }
      const [company, pitch, known, decks, uploaded] = await Promise.all([
        companies
          .findCanonicalCompanyProfile(CompanyIdSchema.parse(companyId))
          .catch(() => null),
        transcriptText(actor, companyId, "Your pitch video").catch(() => ({
          text: "",
          sources: [],
        })),
        // Their own company's records, except anyone's personal notes.
        knowledgeText(
          companyId,
          [
            "organisation_private",
            "founder_private",
            "relationship_shared",
            "specifically_shared",
            "network_visible",
            "public_external",
          ],
          "Your company record",
        ).catch(() => ({ text: "", sources: [] })),
        database.sql<{ content: unknown }[]>`
          select v.content from artifacts.artifacts a
            join artifacts.artifact_versions v
              on v.artifact_id = a.id and v.tenant_id = a.tenant_id
           where a.tenant_id = ${actor.tenantId}
             and a.organisation_id = ${actor.organisationId}
             and a.type = 'PITCH_DECK' and a.archived_at is null
           order by v.created_at desc limit 1`.catch(() => []),
        // A deck they uploaded, in every scope but someone's personal notes.
        uploadedDeckText(companyId, [
          "organisation_private",
          "founder_private",
          "relationship_shared",
          "specifically_shared",
          "network_visible",
          "public_external",
        ]).catch(() => ""),
      ]);
      // The deck Q made, else the one they uploaded.
      const deck =
        decks[0] === undefined
          ? uploaded
          : contentWords(decks[0].content).join(" ");
      return {
        text: [
          company === null
            ? null
            : `THEIR COMPANY: ${company.canonicalName}. ${company.shortDescription ?? ""} ${company.primaryDescription?.slice(0, 1_500) ?? ""}`,
          pitch.text || null,
          deck.length === 0 ? null : `THEIR DECK:\n${deck.slice(0, 5_000)}`,
          known.text || null,
        ]
          .filter((t): t is string => t !== null && t.trim().length > 0)
          .join("\n\n"),
        sources: [
          { kind: "OWN_COMPANY", label: "Your company profile", url: null },
          ...pitch.sources,
          ...(deck.length === 0
            ? []
            : [{ kind: "DECK" as const, label: "Your deck", url: null }]),
          ...known.sources,
        ],
      };
    },
    relationships: async (actor) => {
      const own = await errandRelationships.ownRelationships?.(actor);
      if (own === null || own === undefined) return [];
      return own.items
        .filter((item) => item.state !== "DECLINED")
        .map((item) => ({
          relationshipId: item.relationshipId,
          kind:
            item.counterpart.kind === "COMPANY"
              ? ("COMPANY" as const)
              : ("INVESTOR_ORGANISATION" as const),
          id: item.counterpart.id,
          name: item.counterpart.name,
          state: item.state,
        }));
    },
    upcomingMeetings: async (actor) =>
      (await schedule.upcomingMeetings(actor))
        .filter((meeting) => meeting.status !== "CANCELLED")
        .map((meeting) => ({
          meetingId: meeting.id,
          relationshipId: meeting.relationshipId,
          startsAt: meeting.startsAt,
          purpose: meeting.purpose,
        })),
  },
  composer: createRehearsalComposer({
    gateway: modelGateway,
    dataPosture: demoDataPosture,
    logger,
  }),
  logger,
});
// end REHEARSE block

// Q's scout (founder direction 2026-09-29): every six hours, what is new on
// the public web about each recently active founder's own company, each at
// most once a day; the first run waits a few minutes after a deploy.
const scout = createScout({
  sql: database.sql,
  provider: researchComposition.provider,
  logger,
});
const runScout = () => {
  scout.tick().catch((error: unknown) => {
    logger.warn({ err: error }, "scout run failed");
  });
};
setTimeout(runScout, 5 * 60 * 1000).unref();
setInterval(runScout, 6 * 60 * 60 * 1000).unref();

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
// The interview as a tool-calling Q run (ADR 0016): the same firewall,
// tool pipeline and gateway as every Q answer.
const onboardingRecommendations = createOnboardingQRecommendations({
  transactions: database.transactions,
});
// Research first (BIZ-009, R13): an investor's own public sources, read as
// soon as the firm is known, offered back as recommendations with their
// source. The web through founder presence's read port (Bright Data reads
// only a link the person gave, C5); a registry only when its key or
// contact is configured.
const researchSecrets = config.secrets.researchProviders;
const investorRegistries = [
  ...(researchSecrets.companiesHouse === undefined
    ? []
    : [
        createCompaniesHouseRegistry({
          apiKey: researchSecrets.companiesHouse.reveal(),
        }),
      ]),
  ...(researchSecrets.secEdgarUserAgent === undefined
    ? []
    : [
        createSecEdgarRegistry({
          userAgent: researchSecrets.secEdgarUserAgent,
        }),
      ]),
];
const investorResearch =
  researchComposition.research === undefined && investorRegistries.length === 0
    ? undefined
    : createInvestorResearch({
        read:
          researchComposition.research === undefined
            ? () => Promise.resolve([])
            : investorResearchReadFrom(
                createPresenceReadPort({
                  research: researchComposition.research,
                  ...(researchComposition.profiles === undefined
                    ? {}
                    : { profiles: researchComposition.profiles }),
                  logger,
                }),
              ),
        registries: investorRegistries,
        reader: createInvestorResearchReader({
          gateway: modelGateway,
          dataPosture: demoDataPosture,
          logger,
        }),
        // The person's own session, under their own token: what was found
        // is held the moment it is found, as a durable recommendation.
        portFor: ({ actor, session, onboardingSessionId }) =>
          createOnboardingPort({
            session,
            onboardingSessionId,
            journeyType: "investor",
            ownerUserId: actor.userId,
            personTurns: [],
            recommendations: onboardingRecommendations,
          }),
        logger,
      });
// The founder's own company, read while Q interviews them (founder
// direction 2026-09-30): the same engine, the founder reader, and what is
// found held for the founder to confirm.
const founderResearch =
  researchComposition.research === undefined
    ? undefined
    : createInvestorResearch({
        read: founderResearchReadFrom(
          createPresenceReadPort({
            research: researchComposition.research,
            ...(researchComposition.profiles === undefined
              ? {}
              : { profiles: researchComposition.profiles }),
            logger,
          }),
        ),
        readFindings: createFounderResearchReader({
          gateway: modelGateway,
          dataPosture: demoDataPosture,
          logger,
        }),
        portFor: ({ actor, session, onboardingSessionId }) =>
          createOnboardingPort({
            session,
            onboardingSessionId,
            journeyType: "founder",
            ownerUserId: actor.userId,
            personTurns: [],
            recommendations: onboardingRecommendations,
          }),
        logger,
      });
logger.info(
  {
    investorResearch:
      investorResearch === undefined ? "unconfigured" : "configured",
    registries: investorRegistries.map((registry) => registry.name),
  },
  "investor research composed",
);
// Q's standing with each person (founder direction 2026-09-30): the
// personality they chose and Q's patience with small talk. A paused
// account is told to Capital Q's operators, in the app and by email.
const operatorEmailConfig = loadAppEmailConfig(process.env);
const operatorEmail =
  operatorEmailConfig.brevoApi !== undefined
    ? recordingEmailSender(
        createBrevoApiEmailSender(operatorEmailConfig.brevoApi),
        {
          sql: database.sql,
          source: "q_api.operator_notice",
          provider: "BREVO_API",
        },
      )
    : operatorEmailConfig.smtp === undefined
      ? unavailableAppEmailSender
      : recordingEmailSender(
          createSmtpAppEmailSender(operatorEmailConfig.smtp),
          {
            sql: database.sql,
            source: "q_api.operator_notice",
            provider: "SMTP",
          },
        );
const reportPausedAccount = async (
  actor: ActorContext,
  strikes: number,
): Promise<void> => {
  const operators = await database.sql<
    { user_id: string; tenant_id: string; email: string | null }[]
  >`
    select a.user_id, coalesce(
             (select m.tenant_id from identity.organisation_memberships m
               where m.user_id = a.user_id limit 1),
             ${actor.tenantId}) as tenant_id,
           u.email
      from identity.platform_admins a
      join identity.user_profiles p on p.id = a.user_id
      left join auth.users u on u.id = p.auth_user_id`;
  const who = await database.sql<{ display_name: string | null }[]>`
    select display_name from identity.user_profiles where id = ${actor.userId}`;
  const name = who[0]?.display_name ?? "A new member";
  for (const operator of operators) {
    await database.sql`
      insert into communication.notifications
        (tenant_id, user_id, kind, title, body, link_path, dedupe_key)
      values
        (${operator.tenant_id}, ${operator.user_id}, 'ACCOUNT_PAUSED',
         ${`Q paused ${name}'s account`.slice(0, 200)},
         ${`After ${strikes} warnings about steering onboarding to small talk. Review and reinstate from the admin console.`},
         '/admin', ${`paused:${actor.userId}`})
      on conflict do nothing`;
    if (operator.email !== null && operatorEmail.available) {
      await operatorEmail
        .send({
          to: operator.email,
          subject: `Capital Q: Q paused ${name}'s account`,
          text: `Q paused ${name}'s account after ${strikes} warnings about steering onboarding to small talk.\n\nReview it and reinstate it from the admin console: /admin\n\n-- Capital Q`,
        })
        .catch((error: unknown) => {
          logger.warn({ err: error }, "operator email about a pause not sent");
        });
    }
  }
};
const interviewAgent = createInterviewAgent({
  standing: standingStore,
  onPaused: reportPausedAccount,
  gateway: modelGateway,
  firewall,
  logger,
  memory: memoryService,
  recommendations: onboardingRecommendations,
  investorResearch,
  founderResearch,
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
  // No stage directions inside what Q says (CQ-VOICE-010).
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
// The public presence read that fills a profile's "Signals &
// verification": one trigger, for the spoken and the typed interview.
const presenceTrigger =
  presenceComposition === undefined
    ? undefined
    : createPresenceTrigger({
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
      });

const voiceTurn = timedVoiceTurns(
  createVoiceTurnHandler({
    qRuntime,
    qStream,
    interviewAgent,
    board: voiceTurnBoard,
    welcome: welcomeHost,
    pronunciation,
    // A spoken yes to a proposal is the same decision a tap records.
    approvals: qActions,
    continueApproved,
    // And whether it was a yes is read from their words (ADR 0011).
    decisions: createDecisionReader({
      gateway: modelGateway,
      logger,
      dataPosture: demoDataPosture,
    }),
    ...(presenceTrigger === undefined ? {} : { presence: presenceTrigger }),
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
// REHEARSE: a rehearsal's voice line speaks only as the person Q plays.
const rehearsalVoiceTurn = createRehearsalAwareTurn({
  rehearsals,
  fallback: voiceTurn,
  // The played person's mood becomes the voice's delivery (REHEARSE).
  performance: speechPerformance,
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
    resolver: actorContextResolver,
    identity,
  },
  {
    qRuntime,
    artifacts: qArtifacts.service,
    documentStudio,
    recommendationExplanations,
    // The profile page's "Q found" column (BIZ-002): firewall first, then
    // the own-public-presence envelope, then the cited pages.
    profileFindings: profileFindingsReader,
    memory: memoryService,
    meetingAssistant,
    errands,
    // AUTO block (ADR 0030)
    work: workPort,
    rehearsals,
    // BILLING block (ADR 0034)
    rehearsalEntitlements: entitlements,
    // end BILLING block
    standing: standingStore,
    // DAILY block
    daily: dailyReader,
    orchestration: { orchestrator, autostart: Q_ORCHESTRATION_AUTOSTART },
    qActions,
    continueApproved,
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
            interviewAgent,
            interviewPresence: presenceTrigger,
            apiBaseUrl: config.voice.apiBaseUrl,
            board: voiceTurnBoard,
            welcome: welcomeHost,
            turn: rehearsalVoiceTurn,
            memory: { termsFor: memoryLearner.termsFor },
            openerFacts: createOpenerFacts({ sql: database.sql }),
            rehearsals: {
              opening: rehearsals.opening,
              // The person Q plays speaks in a voice of their own, never Q's.
              voiceIdFor: personaVoiceId,
              performOpening: async (actor, rehearsalId, voiceSessionId) => {
                const opening = await rehearsals.opening(actor, rehearsalId);
                if (opening === null) return;
                performRehearsalLine(speechPerformance, voiceSessionId, {
                  text: opening.line,
                  mood: opening.mood,
                  intensity: opening.intensity,
                  reaction: opening.reaction,
                });
              },
            },
            // Their own records' names, for the recogniser (founder live
            // 2026-09-27, #6): read by the resolved actor's own
            // organisation and user id only, never from anything said.
            ownNames: {
              namesFor: async (actor: ActorContext) => {
                const organisationId = actor.organisationId;
                const [company, firm, personName] = await Promise.all([
                  organisationId === undefined ||
                  companies.findOrganisationCompany === undefined
                    ? Promise.resolve(null)
                    : companies.findOrganisationCompany(
                        actor.tenantId,
                        organisationId,
                      ),
                  organisationId === undefined
                    ? Promise.resolve(null)
                    : ownInvestorOrganisations.findByOrganisation(
                        database.sql,
                        actor.tenantId,
                        organisationId,
                      ),
                  displayNameFor(actor),
                ]);
                const profile =
                  company === null
                    ? null
                    : await companies.findCanonicalCompanyProfile(company.id);
                return ownRecordTerms({
                  companyNames: [
                    company?.canonicalName ?? null,
                    profile?.legalName ?? null,
                  ],
                  firmName: firm?.displayName ?? null,
                  personName,
                });
              },
            },
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
    turn: rehearsalVoiceTurn,
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
