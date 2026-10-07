/**
 * Capital Q worker runtime — persistent Node workload boundary (doc 23, 10).
 *
 * The worker deployable has no public health endpoint (doc 21, 164) and is not
 * publicly addressable.
 *
 * It runs three loops. The outbox publisher moves committed domain events onto
 * the durable pgmq `domain-events` queue. A domain-event consumer turns
 * `evidence.document.version_created` into an `evidence.document.process` job.
 * The documents consumer runs that job: security gate, malware gate, isolated
 * parse, structured extraction, structure-aware chunking (CQ-RAG-001),
 * `evidence.document.ready`.
 *
 * This process holds the database and the storage credential. The parser does
 * not: it runs in a child process with a scrubbed environment, which is what
 * makes a hostile document a data problem instead of a credential problem.
 */

import { randomUUID } from "node:crypto";

import { z } from "zod";

import {
  createPostgresCapitalObjectiveQueryPort,
  createPostgresCapitalObjectiveTimes,
} from "@capital-q/capital";
import {
  CompanyIdSchema,
  createCompanyService,
  createPostgresCompanyQueryPort,
} from "@capital-q/companies";
import { createPostgresMaterialActionAuditWriter } from "@capital-q/audit";
import { createPostgresOrganisationQueryPort } from "@capital-q/organisations";
import { createAuthorizationService } from "@capital-q/security";
import { createPostgresAuthorizationPolicySource } from "@capital-q/security/postgres";
import { loadDatabaseConfig } from "@capital-q/config/database";
import { loadEmbeddingConfig } from "@capital-q/config/embeddings";
import {
  researchProviderEnvShape,
  researchProviderConfigStatus,
  toResearchProviderSecrets,
} from "@capital-q/config/research-providers";
import { loadWorkerConfig } from "@capital-q/config/workers";
import {
  CONTRACTS_VERSION,
  CorrelationIdSchema,
  Q_INSTRUCTION_WAKE_CHANNEL,
  Q_INSTRUCTION_NEW_COMPANY_CHANNEL,
  Q_WORK_WAKE_CHANNEL,
} from "@capital-q/contracts";
import { createRequestDatabaseClient } from "@capital-q/database";
import {
  createOutboxPublisher,
  createOutboxRetryPolicy,
  createPgmqEventDispatcher,
} from "@capital-q/eventing/publisher";
import {
  createRecommendationPipeline,
  createRefreshRequester,
  requestRebuildsForVersionDrift,
  createSlateInvalidationService,
  RECOMMENDATION_REFRESH_DEAD_LETTER_QUEUE,
  RECOMMENDATION_REFRESH_QUEUE,
  refreshDirectiveFor,
  RefreshRecommendationSlateJob,
  createMaterialChanges,
} from "@capital-q/discovery";
import { createOutboxWriter, DOMAIN_EVENTS_QUEUE } from "@capital-q/eventing";
import {
  createDocumentProcessingService,
  createPostgresEvidenceRepositories,
  createSupabaseDocumentStorageProvider,
  createPostgresDataRoom,
} from "@capital-q/evidence";
import {
  createFounderDocumentReview,
  createFounderExtraction,
  createFounderFinancialCheck,
} from "@capital-q/founder-onboarding";
import {
  createMandateReview,
  createMandateSynthesis,
} from "@capital-q/investor-onboarding";
import {
  createPostgresInvestorMandateQueryPort,
  createPostgresInvestorOrganisationQueryPort,
} from "@capital-q/investors";
import {
  createPostgresRelationshipEventRepository,
  createPostgresRelationshipRepository,
  createRelationshipStateProjector,
  type RelationshipQueryPort,
} from "@capital-q/network";
import {
  createDefaultDisclosureResolvers,
  createDisclosureAccessService,
  createDisclosureResourceResolverRegistry,
  createPostgresDisclosurePolicyRepository,
  createRelationshipPartyResolver,
  systemDisclosureClock,
} from "@capital-q/permissions";
import {
  createPostgresTaxonomyLexicalSearchRepository,
  createPostgresTaxonomyReferenceRepository,
  createTaxonomyCandidateFinder,
  createTaxonomyClassifier,
} from "@capital-q/taxonomy";
import {
  createDecidedClaimOwnerLookup,
  createPostgresPendingSyntheticClaimSource,
  createSyntheticAutoVerifySweep,
  createSyntheticVerificationDecider,
  createVerificationClaimsReadinessPort,
} from "@capital-q/verification";
import { modelProviderConfigStatus } from "@capital-q/config/model-providers";
import {
  createWordsReaders,
  budgetForTaskClass,
  createDeckReader,
  createDiligenceDocumentSummariser,
} from "@capital-q/model-gateway/q";
import {
  createOnboardingService,
  createPostgresOnboardingInterviewQuestionRepository,
  createPostgresOnboardingResponseRepository,
  createPostgresOnboardingSessionRepository,
  createPostgresOnboardingSuggestionRepository,
  createPostgresOnboardingUtteranceRepository,
} from "@capital-q/onboarding";
import { ProcessDocumentJob } from "@capital-q/evidence/jobs";
import {
  createPostgresAutomatedModeration,
  createPostgresDiscoverablePitchQueryPort,
  MediaAssetIdSchema,
} from "@capital-q/media";
import { createLogger, createTelemetryRuntime } from "@capital-q/observability";
import {
  createPostgresChunkRepository,
  createQKnowledgeService,
} from "@capital-q/q-knowledge";

import { createDocumentProcessingPipeline } from "./documents/pipeline.js";
import { createPipelineMetrics } from "./documents/metrics.js";
import { createUnavailableMalwareScanner } from "./documents/malware.js";
import { createDomainEventHandler } from "./events/document-processing-handler.js";
import { createProductionEventRegistry } from "./event-registry.js";
import {
  runSyntheticAutoVerifySweeps,
  verificationAttestationFor,
} from "./verification/auto-verify.js";
import { withVerificationDecisions } from "./verification/decide-handler.js";
import { withReadinessAfterVerification } from "./verification/readiness-handler.js";
import { withRelationshipProjection } from "./network/relationship-projection-handler.js";
import { rebuildRelationshipStatesAtStart } from "./network/relationship-rebuild-at-start.js";
import { redriveBlockedDocumentsAtStart } from "./documents/redrive.js";
import { backfillDocumentPagesAtStart } from "./documents/page-backfill.js";
import { withQWorkWake } from "./network/q-work-wake-handler.js";
import { withChatMessageEvents } from "./network/chat-message-handler.js";
import { withInterestNotices } from "./network/interest-notice-handler.js";
import { withOutcomeNotices } from "./network/outcome-notice-handler.js";
import { withCommitmentNotices } from "./network/commitment-notice-handler.js";
import { newlyReadyCompanyOf } from "./network/newly-ready-company.js";
import { createStartupAlertWatcher } from "./network/startup-alert-watcher.js";
import { withDiligenceSummaries } from "./network/diligence-summary-handler.js";
import {
  checkStoredDeckReadings,
  runReadAgainLoop,
  withDeckReadings,
} from "./evidence/deck-reading-handler.js";
import { runDeckReadingHeal } from "./evidence/deck-reading-backfill.js";
import { createOutboxPublisherRunner } from "./outbox-runner.js";
import { createParserSandbox } from "./parser/sandbox.js";
import { composeWorkerPresence } from "./presence/composition.js";
import { runGmailReplyPoller } from "./integrations/gmail-poller.js";
import { runScheduleTicker } from "./integrations/schedule-ticker.js";
import { composeWorkerDaily, runDailyTicker } from "./daily/composition.js";
import { loadGoogleWorkspaceConfig } from "@capital-q/config/google-workspace";
import {
  composeSchedule,
  // AUTO block (ADR 0030)
  createChatMessageNotices,
  createCounterpartNotices,
  createMeetingMailer,
  createNotificationDelivery,
  createPostgresMeetingDirectory,
  createWebPushSender,
  unavailableWebPushSender,
} from "@capital-q/communication";
import { loadWebPushConfig } from "@capital-q/config/web-push";
import { runNoticeDeliveryTicker } from "./integrations/notice-delivery-ticker.js";
import { loadAppEmailConfig } from "@capital-q/config/app-email";
import {
  composeGoogleIntegrations,
  createBrevoApiEmailSender,
  createSmtpAppEmailSender,
  unavailableAppEmailSender,
} from "@capital-q/integrations";
import { createPresenceResearchDispatch } from "./presence/dispatch.js";
import { createPostgresBuildPrincipalResolver } from "./recommendations/build-principal.js";
import { createRecommendationRefreshHandler } from "./recommendations/refresh-handler.js";
import { EXTRACTION_PARSER_LIMITS } from "./parser/limits.js";
import {
  createPgmqQueueClient,
  DOCUMENTS_DEAD_LETTER_QUEUE,
  DOCUMENTS_QUEUE,
} from "./queue/pgmq.js";
import { createQueueRunner } from "./queue/runner.js";
import { recordingEmailSender } from "@capital-q/platform-admin";
// ADMIN-4 block
import {
  createAutoVerificationRequester,
  createAutoVerificationSweep,
  createPostgresAutoRequestCandidateSource,
  createPostgresVerificationClaimRepository,
} from "@capital-q/verification";
import { runAutoVerificationRequests } from "./verification/auto-request.js";
// end ADMIN-4 block
import { composeDocumentJobs } from "./documents/composition.js";
import { composeWorkerModelGateway } from "./model-gateway.js";
import {
  composeRecommendationEmbedder,
  refreshCompanyEmbeddings,
  runCompanyEmbeddingRefresh,
} from "./recommendations/embeddings.js";
import { runDocumentJobTicker } from "./documents/document-jobs.js";

const SERVICE_NAME = "workers";

// Validated once at startup, never per job.
const config = loadWorkerConfig();
const databaseConfig = loadDatabaseConfig();

const telemetry = createTelemetryRuntime();
await telemetry.start();

const logger = createLogger(
  {
    serviceName: SERVICE_NAME,
    environment: config.runtime.deploymentEnvironment,
    serviceVersion: config.observability.serviceVersion,
    region: config.observability.region,
  },
  { level: config.observability.logLevel },
);

// The publisher writes outbox bookkeeping and the queue: ordinary server
// access, no elevation required.
const database = createRequestDatabaseClient(databaseConfig);
// P14: saved startup alerts, matched when a company becomes ready.
const startupAlertWatcher = createStartupAlertWatcher({ sql: database.sql });
const registry = createProductionEventRegistry();
const queues = createPgmqQueueClient(database.sql);

const runner = createOutboxPublisherRunner({
  publisher: createOutboxPublisher({
    transactions: database.transactions,
    registry,
    dispatcher: createPgmqEventDispatcher(),
    retryPolicy: createOutboxRetryPolicy({
      maxAttempts: config.outbox.maxAttempts,
    }),
  }),
  batchSize: config.outbox.batchSize,
  pollIntervalMs: config.outbox.pollIntervalMs,
  logger,
});

/**
 * Founder Onboarding Q (CQ-Q-021), finally reachable (CQ-C5-R2B §7).
 *
 * The worker composes one governed model call — the same Model Gateway,
 * the same catalogue, the same reviewed provider ceilings the Q service uses
 * — and the founder-onboarding review service that turns a processed
 * document into onboarding suggestions. With no provider key configured the
 * whole thing is absent: documents still process, and onboarding continues
 * without a review rather than stalling on one.
 */
const providerSecrets = config.secrets.modelProviders;
const {
  providers: modelProviders,
  syntheticDemo,
  dataPosture: demoDataPosture,
  gateway: modelGateway,
} = composeWorkerModelGateway({
  config,
  databaseUrl: databaseConfig.secrets.url,
  sql: database.sql,
  logger,
});

// One onboarding service for the worker. Its `internal` operations are the
// trusted, never-browser-reachable ones; nothing here registers a write
// handler, so a suggestion can only ever be an offer.
const onboarding = createOnboardingService({
  sql: database.sql,
  transactions: database.transactions,
  outbox: createOutboxWriter({ registry }),
  logger,
});

/**
 * Q.01: a founder's stated figure against their own confirmed deck. Pure
 * code, no model, so it is composed whether or not a model is: a
 * disagreement becomes one CONTRADICTION question, both readings kept.
 */
const deckRoom = createPostgresDataRoom();
const founderFinancialCheck = createFounderFinancialCheck({
  sql: database.sql,
  sessions: createPostgresOnboardingSessionRepository(),
  responses: createPostgresOnboardingResponseRepository(),
  questions: createPostgresOnboardingInterviewQuestionRepository(),
  deckReading: async (executor, companyId) => {
    const deck = await deckRoom.currentDeck(executor, companyId);
    if (deck === null) return null;
    const reading = await deckRoom.extractionFor(executor, deck.versionId);
    return reading === null
      ? null
      : {
          documentId: reading.documentId,
          sections: reading.sections,
          confirmed: reading.confirmed,
          reviews: reading.reviews,
        };
  },
  recordQuestions: (command) =>
    onboarding.internal.recordInterviewQuestions(command as never),
  logger,
});

const founderReview =
  modelProviders.length === 0
    ? undefined
    : createFounderDocumentReview({
        sql: database.sql,
        documents: createPostgresEvidenceRepositories().documents,
        chunks: createPostgresChunkRepository(),
        sessions: createPostgresOnboardingSessionRepository(),
        responses: createPostgresOnboardingResponseRepository(),
        suggestions: createPostgresOnboardingSuggestionRepository(),
        utterances: createPostgresOnboardingUtteranceRepository(),
        createSuggestion: (command) =>
          onboarding.internal.createSuggestion(command as never),
        recordQuestions: (command) =>
          onboarding.internal.recordInterviewQuestions(command as never),
        extraction: createFounderExtraction({
          // The extraction declares the narrow slice of the gateway it uses
          // — one task class, one output shape — which is deliberately not
          // the gateway's full signature. Bridging the two is exactly what a
          // composition root is for; no behaviour is changed and no policy is
          // bypassed, because the object on the right is the real gateway.
          gateway: {
            execute: (request, options) =>
              modelGateway.execute(request as never, options as never),
          },
          // Doc 15 §62. A founder's documents are declared CONFIDENTIAL and
          // stay so; what this says is whether the founder is real. The
          // attestation above is what decides, and it is null wherever a
          // real person is served — so this is REAL_CUSTOMER everywhere
          // except a local demo whose companies were invented.
          dataPosture: demoDataPosture,
          // One place decides what a task class may cost and how long it may
          // take; a caller inventing its own budget would be a second,
          // quieter answer to a question the gateway already governs.
          budget: budgetForTaskClass("STRUCTURED_EXTRACTION"),
          logger,
        }),
        logger,
      });

/**
 * Investor Mandate Q (CQ-Q-022), finally reachable (CQ-PRE-REC-001 §6).
 * One governed call per narrative answer, through the same gateway and
 * ceilings; the reading becomes onboarding suggestions and questions on
 * the real investor steps. Taxonomy phrases resolve through Capital Q's own
 * deterministic classifier, never the model.
 */
const taxonomyClassifier = createTaxonomyClassifier({
  reference: createPostgresTaxonomyReferenceRepository(),
  lexical: createPostgresTaxonomyLexicalSearchRepository(),
});
const taxonomyCandidates = createTaxonomyCandidateFinder({
  sql: database.sql,
  classifier: taxonomyClassifier,
  logger,
});
const mandateReview =
  modelProviders.length === 0
    ? undefined
    : createMandateReview({
        // J7: whether each named red flag is ruled out or avoided, read by
        // meaning on FAST_CLASSIFICATION.
        polarity: (who, mentions) =>
          createWordsReaders({
            gateway: modelGateway,
            dataPosture: demoDataPosture,
            logger,
          }).preferencePolarity(who, mentions),
        sql: database.sql,
        sessions: createPostgresOnboardingSessionRepository(),
        responses: createPostgresOnboardingResponseRepository(),
        suggestions: createPostgresOnboardingSuggestionRepository(),
        utterances: createPostgresOnboardingUtteranceRepository(),
        synthesis: createMandateSynthesis({
          gateway: {
            execute: (request, options) =>
              modelGateway.execute(request as never, options as never),
          },
          dataPosture: demoDataPosture,
          budget: budgetForTaskClass("STRUCTURED_EXTRACTION"),
          logger,
        }),
        taxonomy: {
          resolve: async (phrase, vocabularyCodes) => {
            const result = await taxonomyCandidates.findCandidates({
              text: phrase,
              vocabularyCodes: vocabularyCodes,
              limit: 3,
            });
            // Only a confident, unambiguous resolution becomes a criterion:
            // a phrase that could mean several categories is left for the
            // investor's own search rather than guessed.
            if (result.resolution === "EXACT") {
              return result.candidates.map((c) => String(c.nodeId));
            }
            if (result.resolution === "CANDIDATES") {
              const [top] = result.candidates;
              return top === undefined ? [] : [String(top.nodeId)];
            }
            return [];
          },
        },
        createSuggestion: (command) =>
          onboarding.internal.createSuggestion(command as never),
        recordQuestions: (command) =>
          onboarding.internal.recordInterviewQuestions(command as never),
        logger,
      });

logger.info(
  {
    modelProviders: modelProviderConfigStatus(providerSecrets),
    founderReview: founderReview === undefined ? "disabled" : "composed",
    mandateReview: mandateReview === undefined ? "disabled" : "composed",
  },
  "founder onboarding review composed",
);

/**
 * Public presence research (CQ-C2), dispatched off the same
 * `onboarding.response.committed` event the founder and mandate readings
 * above already consume.
 *
 * Before this packet, `@capital-q/q-presence` was reachable only from the
 * voice turn (`apps/q-api/src/voice/turn.ts`): a live request with an actor
 * already resolved and a place to hang a detached read off. A typed
 * session commits the very same event and never got one. The event fires
 * regardless of transport, so composing presence a second time here — off
 * the worker's own domain-event consumer rather than a request — closes
 * that gap without touching the interviewer, the voice trigger, or a
 * single prompt.
 *
 * Research provider keys (`TAVILY_API_KEY`, `BRIGHT_DATA_*`, `SERP_API_KEY`)
 * are q-api's own config surface (`@capital-q/config/research-providers`);
 * the worker deployable never had one; this reads the same env vars through
 * that package's own validated shape rather than inventing a second one.
 * Absent research keys, or no model provider to read a page with, mean
 * this composes to nothing and a typed session behaves exactly as before.
 */
const researchProviderSecrets = toResearchProviderSecrets(
  z.object(researchProviderEnvShape).parse(process.env),
);
const presenceEvidenceRepositories = createPostgresEvidenceRepositories();
const presenceComposition =
  modelProviders.length === 0
    ? undefined
    : composeWorkerPresence({
        sql: database.sql,
        transactions: database.transactions,
        evidence: presenceEvidenceRepositories,
        gateway: modelGateway,
        dataPosture: demoDataPosture,
        researchSecrets: researchProviderSecrets,
        logger,
      });
const presenceResearch =
  presenceComposition === undefined
    ? undefined
    : createPresenceResearchDispatch({
        sql: database.sql,
        presence: presenceComposition.presence,
        sessions: createPostgresOnboardingSessionRepository(),
        responses: createPostgresOnboardingResponseRepository(),
        suggestions: createPostgresOnboardingSuggestionRepository(),
        createSuggestion: (command) =>
          onboarding.internal.createSuggestion(command as never),
        logger,
      });
logger.info(
  {
    researchProviders: researchProviderConfigStatus(researchProviderSecrets),
    presenceResearch: presenceResearch === undefined ? "disabled" : "composed",
  },
  "public presence research composed",
);

/**
 * Persisted recommendation slates (CQ-REC-006). The same pipeline
 * composition the API serves from, over the same disclosure evaluator the
 * Q service uses. The embedding runtime is the local one q-api reads
 * (Q_EMBEDDING_*): when it cannot be reached, the semantic generator
 * degrades and the slate says so; nothing here calls a hosted model.
 * Domain events become invalidations and coalesced refresh requests; the
 * refresh queue turns those into builds.
 */
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
const disclosurePorts = {
  companies: createPostgresCompanyQueryPort({ sql: database.sql }),
  investors: createPostgresInvestorOrganisationQueryPort({ sql: database.sql }),
  mandates: createPostgresInvestorMandateQueryPort({ sql: database.sql }),
  capital: createPostgresCapitalObjectiveQueryPort({ sql: database.sql }),
  relationships,
};
const disclosure = createDisclosureAccessService({
  sql: database.sql,
  policies: createPostgresDisclosurePolicyRepository(),
  resolvers: createDisclosureResourceResolverRegistry(
    createDefaultDisclosureResolvers(disclosurePorts),
  ),
  relationshipParties: createRelationshipPartyResolver(disclosurePorts),
  clock: systemDisclosureClock,
});
const embeddingConfig = loadEmbeddingConfig();
// Q.02: TEI (local) or the hosted OpenAI adapter (Q_EMBEDDING_PROVIDER=openai).
const recommendationEmbedder = composeRecommendationEmbedder({
  config: embeddingConfig,
  openaiApiKey: providerSecrets.openai?.reveal(),
});
if (recommendationEmbedder.missing.length > 0) {
  // Named at startup rather than discovered per request: semantic
  // candidates stay off and semantic fit stays unknown, never zero.
  logger.warn(
    {
      provider: embeddingConfig.provider,
      missing: recommendationEmbedder.missing,
    },
    "embedding runtime not configured: semantic retrieval disabled",
  );
}
const recommendations = createRecommendationPipeline({
  sql: database.sql,
  transactions: database.transactions,
  disclosure,
  // After a post-meeting pass, the company comes back only on a material
  // change (doc 19 §67): a new pitch, a new raise, or a changed mandate.
  materialChanges: createMaterialChanges({
    pitchReadyAt: (companyIds) =>
      createPostgresDiscoverablePitchQueryPort({
        sql: database.sql,
      }).latestReadyAt?.(companyIds) ?? Promise.resolve(new Map()),
    capitalObjectiveAt: createPostgresCapitalObjectiveTimes({
      sql: database.sql,
    }).latestCreatedAt,
  }),
  // Q.02/Q.06: the raise behind the fit order's cheque comparison. The
  // pipeline asks disclosure as the investor organisation before using it.
  currentRaises: async (companyIds) => {
    const found = await Promise.all(
      companyIds.map(async (raw) => {
        const id = CompanyIdSchema.safeParse(raw);
        if (!id.success) return null;
        const company = await disclosurePorts.companies.findCanonicalCompany(
          id.data,
        );
        if (company === null) return null;
        const objective = await disclosurePorts.capital.getCurrentForCompany(
          company.tenantId,
          company.id,
        );
        return objective === null || objective.status !== "ACTIVE"
          ? null
          : {
              objectiveId: objective.id,
              companyId: objective.companyId,
              amount: objective.target.amount,
              currency: objective.target.currency,
            };
      }),
    );
    return found.filter((raise) => raise !== null);
  },
  embedder: recommendationEmbedder.embedder,
  logger,
});
const refreshRequester = createRefreshRequester({
  requests: recommendations.refreshRequests,
  queue: queues,
  logger,
});
const slateInvalidation = createSlateInvalidationService({
  slates: recommendations.slates,
  requester: refreshRequester,
  logger,
});
// Two builds at a time per process: each is a bounded pipeline run over
// the investor's pool. Queue identity and cadence are code constants.
const RECOMMENDATION_REFRESH_BATCH_SIZE = 2;
const RECOMMENDATION_REFRESH_POLL_INTERVAL_MS = 2_000;
const recommendationRefresh = createQueueRunner({
  queue: RECOMMENDATION_REFRESH_QUEUE,
  deadLetterQueue: RECOMMENDATION_REFRESH_DEAD_LETTER_QUEUE,
  client: queues,
  handle: createRecommendationRefreshHandler({
    builder: recommendations.builder,
    requests: recommendations.refreshRequests,
    principals: createPostgresBuildPrincipalResolver({ sql: database.sql }),
    queue: queues,
    logger,
  }),
  batchSize: RECOMMENDATION_REFRESH_BATCH_SIZE,
  pollIntervalMs: RECOMMENDATION_REFRESH_POLL_INTERVAL_MS,
  visibilityTimeoutSeconds:
    RefreshRecommendationSlateJob.retryPolicy.visibilityTimeoutSeconds,
  maxAttempts: RefreshRecommendationSlateJob.retryPolicy.maxAttempts,
  backoff: {
    initialDelaySeconds:
      RefreshRecommendationSlateJob.retryPolicy.backoff.initialDelaySeconds,
    maxDelaySeconds:
      RefreshRecommendationSlateJob.retryPolicy.backoff.maxDelaySeconds ?? 600,
    jitter: RefreshRecommendationSlateJob.retryPolicy.backoff.jitter ?? true,
  },
  logger,
});

// Automated pitch moderation (CQ-MEDIA-013): the platform's integrity
// decision, run by a versioned rule when a pitch becomes READY. Composed
// on the Media context's trusted operation with the worker's own outbox
// and audit writers; no actor, no browser, no model.
const mediaModeration = createPostgresAutomatedModeration({
  transactions: database.transactions,
  outbox: createOutboxWriter({ registry }),
});

/**
 * CQ-VERIFY-001: Capital Q decides a verification request by synthetic-demo
 * attestation, holding the same allowance the model gateway was given. It
 * is null wherever real people are served, so there the decider refuses
 * every request by name and each stays PENDING.
 */
// R43, temporary until BIZ-006 /ops (TODO(BIZ-006)): without the
// allowance, hosted staging falls back to SYNTHETIC_AUTO_VERIFY_POLICY,
// which needs no synthetic variable and still verifies only accounts
// whose app_metadata marks them synthetic. Production gets neither.
const verification = verificationAttestationFor({
  syntheticDemo,
  environment: config.runtime.deploymentEnvironment,
});
const verificationDecider = createSyntheticVerificationDecider({
  sql: database.sql,
  transactions: database.transactions,
  outbox: createOutboxWriter({ registry }),
  attestation: verification.attestation,
  environment: config.runtime.deploymentEnvironment,
});
// Requests already PENDING (the earlier seed, or events consumed while the
// decider refused) are offered to the same decider at startup and then
// every 10 minutes, at most 200 per run.
// ADMIN-4 block (founder direction 2026-10-02): verification requested
// automatically for organisations on the network; acceptance stays manual.
const autoVerificationSweep = createAutoVerificationSweep({
  source: createPostgresAutoRequestCandidateSource(database.sql),
  request: createAutoVerificationRequester({
    transactions: database.transactions,
    repository: createPostgresVerificationClaimRepository(),
    audit: createPostgresMaterialActionAuditWriter(),
    outbox: createOutboxWriter({ registry }),
  }),
  correlation: () => CorrelationIdSchema.parse(`cor_${randomUUID()}`),
  limit: 100,
  onFailure: (organisationId, error) =>
    logger.warn(
      { organisationId, err: error },
      "verification auto-request failed",
    ),
});
// end ADMIN-4 block
const syntheticAutoVerifySweep =
  verification.attestation === null
    ? undefined
    : createSyntheticAutoVerifySweep({
        source: createPostgresPendingSyntheticClaimSource(database.sql),
        decide: verificationDecider,
        correlation: () => CorrelationIdSchema.parse(`cor_${randomUUID()}`),
        limit: 200,
        onFailure: (claimId, error) =>
          logger.warn(
            { claimId, err: error },
            "synthetic auto-verify decision failed",
          ),
      });
logger.info(
  {
    source: verification.source,
    sweep: syntheticAutoVerifySweep !== undefined,
  },
  "verification decider composed",
);

/**
 * CQ-VERIFY-002: readiness follows a verification decision. The Companies
 * context's own reconciliation, run as Capital Q, for the organisation the
 * decided claim belongs to. The service holds the Verification claims as
 * its readiness seam, exactly as the API's does.
 */
const readinessCompanies = createCompanyService({
  sql: database.sql,
  transactions: database.transactions,
  authorization: createAuthorizationService(
    createPostgresAuthorizationPolicySource({ sql: database.sql }),
  ),
  organisations: createPostgresOrganisationQueryPort({ sql: database.sql }),
  outbox: createOutboxWriter({ registry }),
  audit: createPostgresMaterialActionAuditWriter(),
  verification: createVerificationClaimsReadinessPort({ sql: database.sql }),
});

/**
 * CQ-NET-012: relationship state follows its history. Every Network
 * announcement wakes the deterministic projector for the relationship it
 * names; the projector re-reads the whole history, so redelivery and
 * reordering converge, and the cache is written compare-and-set.
 */
const relationshipProjector = createRelationshipStateProjector({
  sql: database.sql,
  repositories: {
    relationships: createPostgresRelationshipRepository(),
    events: createPostgresRelationshipEventRepository(),
  },
});
/**
 * Q reads what a founder shared in diligence and writes the requester one
 * line about it (2026-10-04). Composed only with a model provider; without
 * one the shared file simply shows without Q's line.
 */
const diligenceSummariser =
  modelProviders.length === 0
    ? undefined
    : createDiligenceDocumentSummariser({
        gateway: modelGateway,
        logger,
        dataPosture: demoDataPosture,
      });
const withDiligenceSummary = (
  inner: Parameters<typeof withDiligenceSummaries>[0],
): Parameters<typeof withDiligenceSummaries>[0] =>
  diligenceSummariser === undefined
    ? inner
    : withDiligenceSummaries(inner, {
        registry,
        sql: database.sql,
        summariser: diligenceSummariser,
        chunks: {
          listActiveByVersion: (executor, tenantId, documentVersionId) =>
            createPostgresChunkRepository().listActiveByVersion(
              executor,
              tenantId as never,
              documentVersionId as never,
            ),
        },
        logger,
      });
/**
 * Overnight A5: Q reads a ready pitch deck into the twelve sections, for
 * the founder to confirm. Composed only with a model provider.
 */
const deckReader =
  modelProviders.length === 0
    ? undefined
    : createDeckReader({
        gateway: modelGateway,
        logger,
        dataPosture: demoDataPosture,
      });
const withDeckReading = (
  inner: Parameters<typeof withDeckReadings>[0],
): Parameters<typeof withDeckReadings>[0] =>
  deckReader === undefined
    ? inner
    : withDeckReadings(inner, {
        registry,
        sql: database.sql,
        reader: deckReader,
        store: createPostgresDataRoom(),
        chunks: {
          listActiveByVersion: (executor, tenantId, documentVersionId) =>
            createPostgresChunkRepository().listActiveByVersion(
              executor,
              tenantId as never,
              documentVersionId as never,
            ),
        },
        logger,
      });
/** Diligence summaries and deck readings both wait on a read document. */
const withDocumentReadings = (
  inner: Parameters<typeof withDeckReadings>[0],
): Parameters<typeof withDeckReadings>[0] =>
  withDiligenceSummary(withDeckReading(inner));
const documentEvents = createQueueRunner({
  queue: DOMAIN_EVENTS_QUEUE,
  client: queues,
  handle: withRelationshipProjection(
    // QA run 8a1d57b9: a chat message wakes the standing instructions
    // covering its relationship.
    withChatMessageEvents(
      // AUTO block (founder direction 2026-10-01): acceptance wakes Q's
      // waiting work at once, after the state above is projected.
      withQWorkWake(
        withCommitmentNotices(
          withOutcomeNotices(
            withDocumentReadings(
              withInterestNotices(
                withReadinessAfterVerification(
                  withVerificationDecisions(
                    createDomainEventHandler({
                      registry,
                      queues,
                      pipelineVersion: config.documents.pipelineVersion,
                      mediaModeration: {
                        onReady: (event) => {
                          // The message names the asset; the decision re-reads it. An id that
                          // is not one is archived by the handler's own outcome, not thrown.
                          const mediaAssetId = MediaAssetIdSchema.safeParse(
                            event.mediaAssetId,
                          );
                          if (!mediaAssetId.success) {
                            return Promise.resolve({ kind: "SKIPPED" });
                          }
                          return mediaModeration({
                            tenantId: event.tenantId,
                            mediaAssetId: mediaAssetId.data,
                            correlationId: CorrelationIdSchema.parse(
                              event.correlationId ?? `cor_${randomUUID()}`,
                            ),
                          });
                        },
                      },
                      ...(founderReview === undefined ? {} : { founderReview }),
                      founderFinancialCheck,
                      ...(mandateReview === undefined ? {} : { mandateReview }),
                      ...(presenceResearch === undefined
                        ? {}
                        : { presenceResearch }),
                      recommendations: {
                        onEvent: async (event) => {
                          const applied = await slateInvalidation.apply(
                            refreshDirectiveFor(event),
                            {
                              correlationId: event.correlationId,
                              causationId: `cau_${event.id}`,
                            },
                          );
                          // A company that became ready wakes standing
                          // instructions open to new companies (founder
                          // 2026-10-05). The id only; q-api re-reads all.
                          const ready = newlyReadyCompanyOf(event);
                          if (ready !== null) {
                            await database.sql`select pg_notify(${Q_INSTRUCTION_NEW_COMPANY_CHANNEL}, ${ready})`;
                            // P14: saved startup alerts it matches tell
                            // their investors (notice, pushed and emailed
                            // by the delivery ticker). Never fails the event.
                            await startupAlertWatcher(ready)
                              .then((told) => {
                                if (told > 0) {
                                  logger.info(
                                    { event: "gateq.startup_alert", told },
                                    "startup alert notices created",
                                  );
                                }
                              })
                              .catch((error: unknown) => {
                                logger.warn(
                                  {
                                    event: "gateq.startup_alert",
                                    errorName:
                                      error instanceof Error
                                        ? error.name
                                        : "unknown",
                                  },
                                  "startup alert matching failed",
                                );
                              });
                          }
                          return applied;
                        },
                      },
                      logger,
                    }),
                    { registry, decide: verificationDecider, logger },
                  ),
                  {
                    registry,
                    ownerOf: createDecidedClaimOwnerLookup({
                      sql: database.sql,
                    }),
                    reconcile:
                      readinessCompanies.reconcileMarketplaceReadinessAsSystem,
                    logger,
                  },
                ),
                {
                  registry,
                  sql: database.sql,
                  notices: createCounterpartNotices(database.sql),
                  logger,
                },
              ),
            ),
            {
              registry,
              sql: database.sql,
              notices: createCounterpartNotices(database.sql),
              logger,
            },
          ),
          // 2026-10-04: each commitment step, told to the other side.
          {
            registry,
            sql: database.sql,
            notices: createCounterpartNotices(database.sql),
            logger,
          },
        ),
        {
          registry,
          channel: Q_WORK_WAKE_CHANNEL,
          notify: async (channel, payload) => {
            await database.sql`select pg_notify(${channel}, ${payload})`;
          },
          logger,
        },
      ),
      {
        registry,
        channel: Q_INSTRUCTION_WAKE_CHANNEL,
        notify: async (channel, payload) => {
          await database.sql`select pg_notify(${channel}, ${payload})`;
        },
        // QA run 8a1d57b9: the recipient is told, one notice per conversation.
        notices: createChatMessageNotices(database.sql),
        logger,
      },
    ),
    { registry, projector: relationshipProjector, logger },
  ),
  batchSize: config.documents.batchSize,
  pollIntervalMs: config.documents.pollIntervalMs,
  visibilityTimeoutSeconds: 60,
  maxAttempts: 5,
  backoff: { initialDelaySeconds: 5, maxDelaySeconds: 300, jitter: true },
  logger,
});

/**
 * Storage authority is required for processing, and its absence closes the
 * pipeline rather than degrading it: a worker that cannot read a document
 * must not report that it processed one.
 */
const storage =
  config.public.supabaseUrl !== undefined &&
  config.secrets.supabaseSecretKey !== undefined
    ? createSupabaseDocumentStorageProvider({
        supabaseUrl: config.public.supabaseUrl,
        secretKey: config.secrets.supabaseSecretKey,
      })
    : undefined;

const documents =
  storage === undefined
    ? undefined
    : createQueueRunner({
        queue: DOCUMENTS_QUEUE,
        deadLetterQueue: DOCUMENTS_DEAD_LETTER_QUEUE,
        client: queues,
        handle: createDocumentProcessingPipeline({
          evidence: createDocumentProcessingService({
            sql: database.sql,
            transactions: database.transactions,
            outbox: createOutboxWriter({ registry }),
            storage,
          }),
          storage,
          // Derived chunks are written by the same worker, after the
          // extraction is recorded and before the run completes.
          knowledge: createQKnowledgeService({
            sql: database.sql,
            transactions: database.transactions,
            storage,
          }),
          // No scanner exists yet. Under the default policy this blocks
          // processing; it never reports a document clean.
          scanner: createUnavailableMalwareScanner(),
          malwarePolicy: config.documents.malwarePolicy,
          sandbox: createParserSandbox({
            timeoutMs: config.documents.parserTimeoutMs,
            maxOutputBytes: config.documents.parserMaxOutputBytes,
            maxOldSpaceMb: config.documents.parserMaxOldSpaceMb,
            limits: EXTRACTION_PARSER_LIMITS,
          }),
          pipelineVersion: config.documents.pipelineVersion,
          maxDocumentBytes: config.documents.maxDocumentBytes,
          metrics: createPipelineMetrics(),
          logger,
        }),
        batchSize: config.documents.batchSize,
        pollIntervalMs: config.documents.pollIntervalMs,
        visibilityTimeoutSeconds:
          ProcessDocumentJob.retryPolicy.visibilityTimeoutSeconds,
        maxAttempts: ProcessDocumentJob.retryPolicy.maxAttempts,
        backoff: {
          initialDelaySeconds:
            ProcessDocumentJob.retryPolicy.backoff.initialDelaySeconds,
          maxDelaySeconds:
            ProcessDocumentJob.retryPolicy.backoff.maxDelaySeconds ?? 900,
          jitter: ProcessDocumentJob.retryPolicy.backoff.jitter ?? true,
        },
        logger,
      });

if (documents === undefined) {
  logger.warn(
    {},
    "document processing disabled: no private storage credential configured",
  );
}

// Gmail reply tracking (BIZ-007): the 5-minute history poll per connected
// mailbox, beside the push endpoint on the API. Absent configuration, the
// integration is unavailable and the poller does not start.
const googleWorkspace = loadGoogleWorkspaceConfig(process.env);
const gmailIntegrations = composeGoogleIntegrations({
  sql: database.sql,
  transactions: database.transactions,
  oauth: googleWorkspace.oauth,
  tokenEncryptionKey: googleWorkspace.tokenEncryptionKey,
  pushTopic: googleWorkspace.push?.topic,
  logger,
});
if (!gmailIntegrations.available) {
  logger.info(
    { missing: googleWorkspace.missing },
    "gmail reply poller disabled: Google workspace not configured",
  );
}

// Reminders and prep briefs (BIZ-008): in-app always; email over the
// SMTP relay in the setup contract when SMTP_* are set.
const appEmail = loadAppEmailConfig(process.env);
if (appEmail.brevoApi !== undefined) {
  logger.info({}, "reminder email enabled: Brevo API configured");
} else if (appEmail.smtp === undefined) {
  logger.error(
    { missing: appEmail.missing },
    "reminder email disabled: SMTP not configured (in-app delivery continues)",
  );
} else {
  logger.info({}, "reminder email enabled: SMTP configured");
}
const schedule = composeSchedule({
  sql: database.sql,
  transactions: database.transactions,
  // DOCS: links in reminder emails go to the web app.
  appOrigin: googleWorkspace.webOrigin ?? null,
  // The worker acts for nobody: it only delivers and briefs from rows a
  // person's authorised request created. No party check can pass here.
  interests: { relationshipById: () => Promise.resolve(null) },
  calendars: (userId) => gmailIntegrations.calendarOf(userId),
  calendarState: (userId) => gmailIntegrations.calendarState(userId),
  // HTTPS first: the deployment's network blocks outbound SMTP.
  // ADMIN block: each send's outcome feeds the console's Email panel.
  email:
    appEmail.brevoApi !== undefined
      ? recordingEmailSender(createBrevoApiEmailSender(appEmail.brevoApi), {
          sql: database.sql,
          source: "workers.reminders",
          provider: "BREVO_API",
        })
      : appEmail.smtp === undefined
        ? unavailableAppEmailSender
        : recordingEmailSender(createSmtpAppEmailSender(appEmail.smtp), {
            sql: database.sql,
            source: "workers.reminders",
            provider: "SMTP",
          }),
  logger,
});

// AUTO block (founder report 2026-10-02): every participant of a booked
// call gets one Capital Q email with the time in their zone, the Meet link
// and an invite file; once per meeting, person and version.
const meetingMail = createMeetingMailer({
  sql: database.sql,
  email:
    appEmail.brevoApi !== undefined
      ? recordingEmailSender(createBrevoApiEmailSender(appEmail.brevoApi), {
          sql: database.sql,
          source: "workers.meetings",
          provider: "BREVO_API",
        })
      : appEmail.smtp === undefined
        ? unavailableAppEmailSender
        : recordingEmailSender(createSmtpAppEmailSender(appEmail.smtp), {
            sql: database.sql,
            source: "workers.meetings",
            provider: "SMTP",
          }),
  appOrigin: googleWorkspace.webOrigin ?? null,
  logger,
});

// AUTO block (ADR 0030): notices beyond the app -- Web Push to the
// person's devices (VAPID, free) and email for "Needs you" left unread.
const webPush = loadWebPushConfig(process.env);
if (webPush.vapid === undefined) {
  logger.info(
    { missing: webPush.missing },
    "web push disabled: VAPID not configured (in-app and email continue)",
  );
}
const noticeEmailDirectory = createPostgresMeetingDirectory({
  sql: database.sql,
});
const noticeDelivery = createNotificationDelivery({
  sql: database.sql,
  push:
    webPush.vapid === undefined
      ? unavailableWebPushSender
      : createWebPushSender({
          publicKey: webPush.vapid.publicKey,
          privateKey: webPush.vapid.privateKey.reveal(),
          subject: webPush.vapid.subject,
        }),
  // ADMIN block: each notice email's outcome feeds the console's Email
  // panel too (audit 2026-10-01: notices were emailed but never recorded).
  email:
    appEmail.brevoApi !== undefined
      ? recordingEmailSender(createBrevoApiEmailSender(appEmail.brevoApi), {
          sql: database.sql,
          source: "workers.notices",
          provider: "BREVO_API",
        })
      : appEmail.smtp === undefined
        ? unavailableAppEmailSender
        : recordingEmailSender(createSmtpAppEmailSender(appEmail.smtp), {
            sql: database.sql,
            source: "workers.notices",
            provider: "SMTP",
          }),
  emailOf: async (userId) =>
    (await noticeEmailDirectory.person(userId))?.email ?? null,
  appOrigin: googleWorkspace.webOrigin ?? null,
  logger,
});
// end AUTO block

// DAILY block: The Q Daily (docs/specs/2026-10/daily.md). Editions are
// prepared here only, within the package's hard budget caps.
const daily =
  process.env["Q_DAILY_DISABLED"] === "1"
    ? undefined
    : composeWorkerDaily({
        sql: database.sql,
        gateway: modelGateway,
        modelsAvailable: modelProviders.length > 0,
        dataPosture: demoDataPosture,
        researchSecrets: researchProviderSecrets,
        // ADMIN block: each send's outcome feeds the console's Email panel.
        email:
          appEmail.brevoApi !== undefined
            ? recordingEmailSender(
                createBrevoApiEmailSender(appEmail.brevoApi),
                {
                  sql: database.sql,
                  source: "workers.daily",
                  provider: "BREVO_API",
                },
              )
            : appEmail.smtp === undefined
              ? unavailableAppEmailSender
              : recordingEmailSender(createSmtpAppEmailSender(appEmail.smtp), {
                  sql: database.sql,
                  source: "workers.daily",
                  provider: "SMTP",
                }),
        env: process.env,
        logger,
      });
// end DAILY block

// Q room W5 (R8): documents Q is making (decks, one-pagers, memos).
const documentJobs = composeDocumentJobs({
  sql: database.sql,
  transactions: database.transactions,
  gateway: modelGateway,
  modelsAvailable: modelProviders.length > 0,
  providerSecrets,
  supabaseUrl: config.public.supabaseUrl,
  supabaseSecretKey: config.secrets.supabaseSecretKey,
  env: process.env,
  logger,
});

const shutdownController = new AbortController();

function shutdown(signal: NodeJS.Signals): void {
  logger.info({ signal }, "worker runtime stopping");
  shutdownController.abort();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

logger.info({ contracts: CONTRACTS_VERSION }, "worker runtime started");

// A deploy that bumps a generator, the ranker, its config, the eligibility
// policy or the feature schema asks for NORMAL rebuilds of the slates built
// by the old pipeline; the feed keeps serving them until superseded. Never
// fatal: an expiry still refreshes a slate this misses.
// Q.02: company vectors first (bounded; embeds only what is missing or
// changed), so the rebuilds below can use semantic fit.
const COMPANY_EMBEDDING_REFRESH_LIMIT = 500;
void (
  recommendationEmbedder.missing.length > 0
    ? Promise.resolve(false)
    : refreshCompanyEmbeddings({
        semantic: recommendations.semantic,
        logger,
        limit: COMPANY_EMBEDDING_REFRESH_LIMIT,
      })
)
  .then(() =>
    requestRebuildsForVersionDrift({
      slates: recommendations.slates,
      requester: refreshRequester,
      logger,
    }),
  )
  .catch((error: unknown) => {
    logger.warn(
      { error: error instanceof Error ? error.name : "UNKNOWN" },
      "discovery.slates.version_drift_failed",
    );
  });

// relationship-state.v2 (2026-10-02): caches folded by an older projector
// version, or behind their history, are re-folded from history in the
// background. Compare-and-set, bounded, idempotent; never fatal.
void rebuildRelationshipStatesAtStart({
  projector: relationshipProjector,
  logger,
});

// ADR 0042: documents blocked for want of a scanner are re-driven once in
// the background, only under ALLOW_UNSCANNED_WITH_WARNING. Idempotent,
// bounded, one log line; the CLI (redrive-documents) does the same by hand.
void redriveBlockedDocumentsAtStart({
  sql: database.sql,
  queues,
  pipelineVersion: config.documents.pipelineVersion,
  malwarePolicy: config.documents.malwarePolicy,
  logger,
});

// F26: readings stored before the deck figure check get it once at start:
// deterministic, no model; a corrected copy is appended, never a rewrite.
const deckChunks = {
  listActiveByVersion: (
    executor: Parameters<
      ReturnType<typeof createPostgresChunkRepository>["listActiveByVersion"]
    >[0],
    tenantId: string,
    documentVersionId: string,
  ) =>
    createPostgresChunkRepository().listActiveByVersion(
      executor,
      tenantId as never,
      documentVersionId as never,
    ),
};
void checkStoredDeckReadings({
  sql: database.sql,
  chunks: deckChunks,
  store: createPostgresDataRoom(),
  logger,
  limit: 100,
})
  .then((healed) => {
    if (healed > 0) logger.info({ healed }, "deck figure check at start");
  })
  .catch((error: unknown) => {
    logger.warn({ err: error }, "deck figure check at start failed");
  });

// Q room W3 (R3): paged documents processed before page text existed get
// their pages from their private artifacts. Bounded, idempotent, never fatal.
if (storage !== undefined) {
  void backfillDocumentPagesAtStart({
    backfill: createDocumentProcessingService({
      sql: database.sql,
      transactions: database.transactions,
      outbox: createOutboxWriter({ registry }),
      storage,
    }).backfillDocumentPages,
    logger,
  });
}

// The loops hold the process resident; they return only after abort, at which
// point the pool is drained and telemetry flushed before exit.
await Promise.all([
  runner.run(shutdownController.signal),
  documentEvents.run(shutdownController.signal),
  recommendationRefresh.run(shutdownController.signal),
  ...(documents === undefined
    ? []
    : [documents.run(shutdownController.signal)]),
  ...(gmailIntegrations.available
    ? [
        runGmailReplyPoller({
          integrations: gmailIntegrations,
          signal: shutdownController.signal,
          logger,
        }),
      ]
    : []),
  runScheduleTicker({
    schedule,
    meetingMail,
    signal: shutdownController.signal,
    logger,
  }),
  runNoticeDeliveryTicker({
    delivery: noticeDelivery,
    signal: shutdownController.signal,
    logger,
  }),
  runDocumentJobTicker({
    runner: documentJobs,
    signal: shutdownController.signal,
    logger,
  }),
  // DAILY block
  ...(daily === undefined
    ? []
    : [runDailyTicker({ daily, signal: shutdownController.signal, logger })]),
  ...(recommendationEmbedder.missing.length > 0
    ? []
    : [
        runCompanyEmbeddingRefresh({
          semantic: recommendations.semantic,
          logger,
          limit: COMPANY_EMBEDDING_REFRESH_LIMIT,
          intervalMs: 30 * 60 * 1000,
          signal: shutdownController.signal,
        }),
      ]),
  // Q.08: a ready deck unread after 10 minutes is an error line
  // (alert DECK_READING_MISSING), only where decks can be read at all.
  ...(deckReader === undefined
    ? []
    : [
        // F26: the founder's "Read again" (two per deck version, held by the
        // database), one a minute, at most 20 a day platform-wide.
        runReadAgainLoop({
          reading: {
            sql: database.sql,
            reader: deckReader,
            store: createPostgresDataRoom(),
            chunks: deckChunks,
            logger,
          },
          queue: createPostgresDataRoom(),
          intervalMs: 60 * 1000,
          perSweep: 1,
          dailyMax: 20,
          signal: shutdownController.signal,
        }),
        // …and re-reads up to 10 of them per sweep (each once per process,
        // at most $0.25 a sweep), so a missed reading heals itself.
        runDeckReadingHeal({
          sql: database.sql,
          logger,
          reading: {
            sql: database.sql,
            reader: deckReader,
            store: createPostgresDataRoom(),
            chunks: {
              listActiveByVersion: (executor, tenantId, documentVersionId) =>
                createPostgresChunkRepository().listActiveByVersion(
                  executor,
                  tenantId as never,
                  documentVersionId as never,
                ),
            },
            logger,
          },
          intervalMs: 15 * 60 * 1000,
          perSweep: 10,
          maxUsdPerSweep: 0.25,
          signal: shutdownController.signal,
        }),
      ]),
  // ADMIN-4 block
  runAutoVerificationRequests({
    sweep: autoVerificationSweep,
    intervalMs: 10 * 60 * 1000,
    signal: shutdownController.signal,
    logger,
  }),
  // end ADMIN-4 block
  ...(syntheticAutoVerifySweep === undefined
    ? []
    : [
        runSyntheticAutoVerifySweeps({
          sweep: syntheticAutoVerifySweep,
          intervalMs: 10 * 60 * 1000,
          signal: shutdownController.signal,
          logger,
        }),
      ]),
]);
await database.close();
await telemetry.shutdown();
logger.info({}, "worker runtime stopped");
