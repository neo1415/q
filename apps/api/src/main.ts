/**
 * Capital Q application API — deployable composition root (doc 23, 8; ERA-002).
 *
 * Composition only: configuration, the database pool, the Supabase-backed
 * authenticator and the PostgreSQL-backed security adapters are built here
 * and handed to the application. Domain routes arrive with their packets and
 * import business logic from domain packages rather than defining it here.
 */

import {
  createCompanyClaims,
  createPlatformCompanyPublishing,
} from "@capital-q/companies";
import {
  createApplicationMaterials,
  createApplicationRelationshipJoin,
} from "./gateq/application-materials.js";
import { sharedDocumentsPort } from "./gateq/inbox.js";
import { loadApiConfig } from "@capital-q/config/api";
import { loadDatabaseConfig } from "@capital-q/config/database";
import { loadGoogleWorkspaceConfig } from "@capital-q/config/google-workspace";
import {
  composeGoogleIntegrations,
  createBrevoApiEmailSender,
  createInboundEmailService,
  createSmtpAppEmailSender,
  unavailableAppEmailSender,
  createGoogleKeySource,
  platformGoogleHttp,
} from "@capital-q/integrations";
import { requireSupabaseAuthConfig } from "@capital-q/config/supabase-auth";
import { loadWebPushConfig } from "@capital-q/config/web-push";
import {
  createPostgresMaterialActionAuditWriter,
  createPostgresSecurityEventWriter,
} from "@capital-q/audit";
import {
  checkDatabaseReadiness,
  createRequestDatabaseClient,
} from "@capital-q/database";
import {
  CorrelationIdSchema,
  type AdminUsageDto,
  NO_RAISE_VIEW,
  PolicyExtractionDtoSchema,
} from "@capital-q/contracts";
import {
  createBrandThemeStore,
  createEtiquetteGuideAdminStore,
  createPlatformAdmin,
  recordingEmailSender,
} from "@capital-q/platform-admin";
import { houseEtiquetteOf } from "@capital-q/q-core";
import { createPostgresEtiquetteGuideStore } from "@capital-q/q-runtime";
import { loadAppEmailConfig } from "@capital-q/config/app-email";
import { loadInboundEmailConfig } from "@capital-q/config/inbound-email";
import { createOutboxWriter } from "@capital-q/eventing";
import { connectedCompanies } from "./http/your-companies.js";
import { createInvestorAnswers } from "./investor-answers.js";
import { createProfileMaterial } from "./profile-material.js";
import {
  createCorrelationId,
  createLogger,
  createTelemetryRuntime,
} from "@capital-q/observability";
import {
  createFounderOnboardingIntegration,
  FOUNDER_INTERVIEW_CUES,
  FOUNDER_REVISABLE_STEPS,
  FOUNDER_UTTERANCE_ALIASES,
} from "@capital-q/founder-onboarding";
import {
  createInvestorOnboardingIntegration,
  INVESTOR_INTERVIEW_CUES,
  INVESTOR_REVISABLE_STEPS,
  INVESTOR_UTTERANCE_ALIASES,
} from "@capital-q/investor-onboarding";
import {
  createDiscoveryService,
  createPostgresDiscoveryRepository,
  createPostgresRefreshQueue,
  createInteractionSignalService,
  createPostgresInteractionRepository,
  createPostgresCompanySectorsPort,
  createMaterialChanges,
  createSlateReadPipeline,
  createExploreService,
} from "@capital-q/discovery";
import {
  CapitalObjectiveNotFoundError,
  createCapitalRoundService,
  createCapitalService,
  createPostgresCapitalObjectiveQueryPort,
  createPostgresCapitalObjectiveTimes,
} from "@capital-q/capital";
import { createResultsReader } from "@capital-q/results";
import {
  createPostgresReadinessStore,
  createReadinessService,
  readinessDataRoomFrom,
  readinessDeckFrom,
  readinessFollowUps,
  readinessRaiseFrom,
} from "@capital-q/readiness";
import {
  CompanyIdSchema,
  createCompanyService,
  createPostgresCompanyMarketplaceQueryPort,
  createPostgresCompanyQueryPort,
  createPostgresCompanyTeamProjection,
} from "@capital-q/companies";
import {
  createInvestorService,
  createPostgresInvestorMandateQueryPort,
  createPostgresInvestorOrganisationQueryPort,
  createPostgresInvestorProfileQueryPort,
  InvestorOrganisationIdSchema,
} from "@capital-q/investors";
import {
  createCommitmentService,
  createDealCloseService,
  createRelationshipOutcomeService,
  createConnectionService,
  createInterestService,
  createNetworkService,
  createRelationshipEventAppender,
  createPostgresDiligenceRequests,
  createPostgresDiligenceQuestions,
  createRelationshipEventRegistry,
  RELATIONSHIP_EVENT_DEFINITIONS,
  createPostgresRelationshipEventRepository,
  createPostgresRelationshipRepository,
  type RelationshipQueryPort,
} from "@capital-q/network";
import {
  actorPrincipal,
  createDefaultDisclosureResolvers,
  createDisclosureAccessService,
  createDisclosureResourceResolverRegistry,
  createPermissionsService,
  createPostgresDisclosurePolicyRepository,
  createRelationshipPartyResolver,
  createDiligenceService,
  createVisibilityCentre,
  systemDisclosureClock,
} from "@capital-q/permissions";
import {
  createInvitationMailer,
  createOrganisationService,
  createPostgresTeamJournal,
  createPostgresTeamStore,
  createTeamService,
  createPostgresOrganisationQueryPort,
} from "@capital-q/organisations";
import {
  GatewayIdSchema,
  createGateQService,
  createInvestorGateFits,
  createPolicyExtractionService,
  createPostgresPolicyExtractionRepository,
  createPostgresGatewayPolicyPort,
  createPostgresGatewayRepository,
  createPostgresGatewayVersionRepository,
} from "@capital-q/gateq";
import {
  createConversationService,
  createGateQInterviewer,
  createGuestThrottle,
  createIntakeService,
  createPostgresApplicationDocumentRepository,
  createPostgresApplicationFactRepository,
  createPostgresApplicationRepository,
  createPostgresApplicationSessionRepository,
  createPostgresApplicationSubmissionRepository,
  createPostgresSubmissionInbox,
  createGateqInbox,
  renderClaimCodeEmail,
  sendGateqEmailLogged,
  type GateqEmailEvent,
  createPostgresInboxRepository,
  createStartupAlerts,
  createPostgresApplicationFounders,
  gateqInboxActionsPort,
  ownGatewayIdFrom,
} from "@capital-q/gateq-intake";
import {
  createDailySpendCap,
  createModelGateway,
  createPostgresDailySpendReader,
  parseDailySpendCapUsd,
  createModelProviderRegistry,
  createPostgresModelCatalog,
  createPostgresModelUsageRepository,
  createProcessLocalProviderHealth,
  createSyntheticDemoRoutingAllowance,
  type ModelProvider,
  createPostgresUsageReader,
  monthOf,
} from "@capital-q/model-gateway";
import { createGoogleModelProvider } from "@capital-q/model-gateway/providers/google";
import { createWordsReaders } from "@capital-q/model-gateway/q";
import { createGroqModelProvider } from "@capital-q/model-gateway/providers/groq";
import { createOpenAIModelProvider } from "@capital-q/model-gateway/providers/openai";

import {
  createGateQCompanyProjectionPort,
  createGateQOrganisationDisplayPort,
} from "./gateq/company-projection.js";
import { mandateVocabularyFrom } from "./gateq/mandate-vocabulary.js";
import {
  createIntakeBoundPolicyPort,
  createIntakeTaxonomyPort,
} from "./gateq/intake-ports.js";
import {
  CapabilitySchema,
  createAuthorizationService,
  OrganisationIdSchema,
  TenantIdSchema,
} from "@capital-q/security";
// BILLING block (ADR 0034)
import {
  createBillingAccounts,
  createEntitlementService,
  createFeeLedger,
  createStripeBillingProvider,
  createWebhookApplier,
  billingAccountOf,
  FEATURE_GATEWAYS,
  stripeConfigFromEnv,
  VALUE_RECOMMENDATION_VOLUME,
} from "@capital-q/billing";
// end BILLING block
import {
  createNamedImageReader,
  createPostgresNamedImageStore,
  createPostgresProfileImageRepository,
  createPostgresPublicIdentityRepository,
  createProfileImageService,
  createPublicIdentityService,
  createSharpImageProcessor,
  createSubjectDirectory,
  namedImageKey,
} from "@capital-q/public-identity";
import {
  createCompanyVerificationService,
  closeKybForClaim,
  createDecideByOperator,
  createKybService,
  createPostgresVerificationClaimRepository,
  createPublicVerificationReader,
  createVerificationClaimsReadinessPort,
} from "@capital-q/verification";
import {
  createCompanyOnboardingSubjectResolver,
  createInvestorOrganisationOnboardingSubjectResolver,
  createOnboardingNudges,
  createOnboardingService,
} from "@capital-q/onboarding";
import {
  createEvidenceSubjectResolverRegistry,
  createCompanyEvidenceSubjectResolver,
  createEvidenceService,
  createSupabaseDocumentStorageProvider,
  DOCUMENT_STORAGE_BUCKET,
  DOCUMENT_UPLOAD_MAX_OPEN_SESSIONS,
  DOCUMENT_UPLOAD_SESSION_TTL_SECONDS,
  createSharedDocumentDownloads,
  findActiveDocumentById,
  DocumentNotFoundError,
  DocumentIdSchema,
} from "@capital-q/evidence";
import {
  composeChat,
  composeChatSafety,
  composeSchedule,
  createCounterpartNotices,
  createPushSubscriptionStore,
} from "@capital-q/communication";
import {
  createCloudflareStreamVideoProvider,
  createCompanyMediaOwnerResolver,
  createMediaOwnerResolverRegistry,
  createMediaService,
  createPostgresDiscoverablePitchQueryPort,
  createPostgresNetworkPitchQueryPort,
  createUnconfiguredVideoProvider,
  MediaAssetIdSchema,
} from "@capital-q/media";
import {
  createPostgresTaxonomyAssignmentRepository,
  createPostgresTaxonomyReferenceRepository,
  createTaxonomyService,
} from "@capital-q/taxonomy";
import {
  createPostgresActiveOrganisationContextStore,
  createPostgresActorContextResolver,
  createPostgresApplicationIdentityLookup,
  createPostgresAuthorizationPolicySource,
  createPostgresPersonProfileStore,
  createPostgresSessionLiveness,
} from "@capital-q/security/postgres";
import {
  createLocalJwtAccessTokenAuthenticator,
  createSupabaseAccessTokenAuthenticator,
} from "@capital-q/security/supabase";

import { apiServiceIdentity, createApp } from "./app.js";
import { createChatSafetyAudit } from "./chat-safety-audit.js";
import { createDiscoverFilterFacts } from "./discover-filter-facts.js";
import { createApiCompanyRaiseReader } from "./company-raise.js";
import { createRaiseSharing } from "./pitch-claims.js";
import { createQWorkPagePort, createWorkforceJobPort } from "./q-work-port.js";
import { createProductionEventRegistry } from "./event-registry.js";
import { createInvestorCardFacts } from "./investor-card-facts.js";
import { createSupabaseRequestAuthenticator } from "./security/supabase-authenticator.js";
import {
  withSuspendedIdentity,
  withSuspension,
} from "./security/suspension.js";

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
const databaseConfig = loadDatabaseConfig();
const database = createRequestDatabaseClient(databaseConfig);

// Lead 2026-10-03: what Q cost this month, for the admin console. Names
// are read for display only; the ledger itself is read-only.
const usageReader = createPostgresUsageReader(database.sql);
async function adminUsage(at: Date): Promise<AdminUsageDto> {
  const month = await usageReader.adminMonth(at, 25);
  const tenantIds = [...new Set(month.tenants.map((row) => row.tenantId))];
  const userIds = month.users
    .map((row) => row.userId)
    .filter((id): id is string => id !== null);
  const [tenants, people] = await Promise.all([
    database.sql<{ id: string; name: string }[]>`
      select id, name from identity.tenants where id = any(${tenantIds}::uuid[])`,
    database.sql<{ id: string; name: string | null }[]>`
      select id, display_name as name from identity.user_profiles
       where id = any(${userIds}::uuid[])`,
  ]);
  const tenantName = new Map(tenants.map((row) => [row.id, row.name]));
  const personName = new Map(people.map((row) => [row.id, row.name]));
  return {
    month: monthOf(at).label,
    totalUsd: month.totalUsd,
    tenants: month.tenants.map((row) => ({
      ...row,
      name: tenantName.get(row.tenantId) ?? null,
    })),
    users: month.users.map((row) => ({
      ...row,
      name:
        row.userId === null
          ? "Guest (GateQ)"
          : (personName.get(row.userId) ?? null),
    })),
    drivers: month.drivers.map((row) => ({ ...row })),
  };
}

// ADMIN block: the console's email panel reads which sender this
// deployment uses (never the key itself).
function adminEmailConfig() {
  const email = loadAppEmailConfig(process.env);
  if (email.brevoApi !== undefined) {
    return { sender: email.brevoApi.sender, provider: "BREVO_API" as const };
  }
  if (email.smtp !== undefined) {
    return { sender: email.smtp.sender, provider: "SMTP" as const };
  }
  return {
    sender: process.env["SMTP_SENDER"] ?? null,
    provider: "NONE" as const,
  };
}
// end ADMIN block

// ADMIN block (ADR 0033): Capital Q's operations console, and the
// suspension check every actor resolution passes through.
const platformAdmin = createPlatformAdmin({
  sql: database.sql,
  transactions: database.transactions,
  email: adminEmailConfig(),
});
// end ADMIN block

// SUB-SECOND Phase 4: access tokens are verified here against the
// project's published ES256 key, and the session is checked in the
// database (fresh for writes, at most 15 s old for reads), instead of
// asking the Auth server on every request (~208 ms median, 2-6 s tail).
// CQ_AUTH_LOCAL_JWT=off restores the Auth-server check.
const accessTokens =
  process.env["CQ_AUTH_LOCAL_JWT"]?.trim().toLowerCase() === "off"
    ? createSupabaseAccessTokenAuthenticator(supabaseAuth)
    : createLocalJwtAccessTokenAuthenticator({
        url: supabaseAuth.url,
        sessions: createPostgresSessionLiveness({ sql: database.sql }),
        fallback: createSupabaseAccessTokenAuthenticator(supabaseAuth),
      });
const security = {
  authenticator: createSupabaseRequestAuthenticator(accessTokens),
  resolver: withSuspension(
    createPostgresActorContextResolver({ sql: database.sql }),
    platformAdmin.isSuspended,
  ),
  identities: withSuspendedIdentity(
    createPostgresApplicationIdentityLookup({ sql: database.sql }),
    platformAdmin.isSuspended,
  ),
  // The person's own profile (BIZ-002); q-api composes the same store for
  // Q's approved person.profile.update.
  people: createPostgresPersonProfileStore({ sql: database.sql }),
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

// G1/G2: the company or firm as a team. Invitation email goes through
// Capital Q's outbound email adapter (Brevo API or SMTP), recorded like
// every app email; with neither configured, invitations are still made and
// the screen offers Resend.
const teamEmailConfig = loadAppEmailConfig(process.env);
const teamEmail =
  teamEmailConfig.brevoApi !== undefined
    ? recordingEmailSender(
        createBrevoApiEmailSender(teamEmailConfig.brevoApi),
        {
          sql: database.sql,
          source: "api.team_invitation",
          provider: "BREVO_API",
        },
      )
    : teamEmailConfig.smtp === undefined
      ? unavailableAppEmailSender
      : recordingEmailSender(createSmtpAppEmailSender(teamEmailConfig.smtp), {
          sql: database.sql,
          source: "api.team_invitation",
          provider: "SMTP",
        });
const teamLogger = createLogger(apiServiceIdentity(config), {
  level: config.observability.logLevel,
});
const team = createTeamService({
  store: createPostgresTeamStore({
    sql: database.sql,
    transactions: database.transactions,
  }),
  journal: createPostgresTeamJournal({ audit, outbox }),
  mailer: createInvitationMailer(teamEmail),
  // P15: every team email's outcome in the service log, with the
  // recipient's domain only; a provider error is named, never echoed (it
  // can carry the address).
  onEmail: (event) => {
    const fields = {
      event: "team.email",
      kind: event.kind,
      outcome: event.outcome,
      recipientDomain: event.recipientDomain,
      provider:
        teamEmailConfig.brevoApi !== undefined
          ? "BREVO_API"
          : teamEmailConfig.smtp !== undefined
            ? "SMTP"
            : "NONE",
      ...(event.error instanceof Error ? { errorName: event.error.name } : {}),
    };
    if (event.outcome === "SENT") {
      teamLogger.info(fields, "team email sent");
    } else {
      teamLogger.warn(fields, "team email not sent");
    }
  },
  webOrigin:
    process.env["CQ_WEB_ORIGIN"] ??
    "https://capital-qweb-production.up.railway.app",
});

// Companies reach organisations only through the public query port.
const companies = createCompanyService({
  sql: database.sql,
  transactions: database.transactions,
  authorization,
  organisations: createPostgresOrganisationQueryPort({ sql: database.sql }),
  outbox,
  audit,
  // CQ-VERIFY-001: readiness reads Capital Q's own verification claims.
  verification: createVerificationClaimsReadinessPort({ sql: database.sql }),
});

// The founder asks for verification and reads where it stands; nothing in
// this process can decide a claim (that is the worker's, under attestation).
const verification = createCompanyVerificationService({
  sql: database.sql,
  transactions: database.transactions,
  authorization,
  companies: createPostgresCompanyQueryPort({ sql: database.sql }),
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

// GateQ (CQ-GATE-001): the investor organisation's inbound gateway. It owns
// gateways, versions and criteria and nothing else -- the company
// projection it qualifies against is assembled here, from the owning
// contexts' own query ports, and carries three declared facts and one
// declared raise. No document, no conversation, no Q inference reaches it.
const gateqGateways = createPostgresGatewayRepository({ sql: database.sql });
const gateqVersions = createPostgresGatewayVersionRepository({
  sql: database.sql,
});
// The policy an application is frozen to, which is not always the one
// published now. Shared by intake and the conversation above it.
const gateqIntakePolicies = createIntakeBoundPolicyPort({
  gateways: gateqGateways,
  versions: gateqVersions,
});

const gateqCompanyProjection = createGateQCompanyProjectionPort({
  sql: database.sql,
  companies: createPostgresCompanyMarketplaceQueryPort({
    sql: database.sql,
  }),
  assignments: createPostgresTaxonomyAssignmentRepository(),
  reference: createPostgresTaxonomyReferenceRepository(),
  capital: createPostgresCapitalObjectiveQueryPort({ sql: database.sql }),
});
const gateq = createGateQService({
  gateways: gateqGateways,
  versions: gateqVersions,
  policies: createPostgresGatewayPolicyPort({ sql: database.sql }),
  companies: gateqCompanyProjection,
  organisations: createGateQOrganisationDisplayPort({
    investors: createPostgresInvestorOrganisationQueryPort({
      sql: database.sql,
    }),
  }),
  authorization,
  transactions: database.transactions,
  audit,
});

/**
 * GateQ intake (CQ-GATE-002): the applicant side of the same front door.
 *
 * A stranger with no Capital Q account opens an application at a published
 * gateway, is interviewed by Q, leaves, comes back and submits. Nothing
 * below hands that stranger an actor, an organisation or a capability —
 * their whole authority is a bearer credential naming one application.
 *
 * The interview needs a model, so the applicant surface registers only
 * when a provider is configured. With none, the front door is closed
 * rather than broken: gateway configuration still works, and an applicant
 * gets a 404 instead of a half-working conversation.
 */
const gateqProviderSecrets = config.secrets.modelProviders;
const gateqModelProviders: ModelProvider[] = [];
if (gateqProviderSecrets.google !== undefined) {
  gateqModelProviders.push(
    createGoogleModelProvider({
      apiKey: gateqProviderSecrets.google.reveal(),
    }),
  );
}
if (gateqProviderSecrets.groq !== undefined) {
  gateqModelProviders.push(
    createGroqModelProvider({
      apiKey: gateqProviderSecrets.groq.reveal(),
      additionalApiKeys: gateqProviderSecrets.groqKeys
        .slice(1)
        .map((key) => key.reveal()),
    }),
  );
}
// The routing policies name gpt-5.6-luna first (20261008130000); a
// provider routed to but never registered is PROVIDER_UNCONFIGURED on
// every call.
if (gateqProviderSecrets.openai !== undefined) {
  gateqModelProviders.push(
    createOpenAIModelProvider({
      apiKey: gateqProviderSecrets.openai.reveal(),
    }),
  );
}

/**
 * Founder brief J7: people's words read by meaning (a setup reply's move,
 * whether a mandate wants or rules out a term), through the same gateway
 * and providers, on the cheap FAST_CLASSIFICATION class. Without a provider
 * nothing is read, and each caller keeps its safe default.
 */
/**
 * F-D8 (RECOVERY F5): the same daily ceiling q-api and the workers use, on
 * the ledger every gateway writes to, so GateQ's calls count against it
 * too (they bypassed it). Unset means no cap.
 */
const gateqSpendCap = (() => {
  const capUsd = parseDailySpendCapUsd(process.env);
  if (capUsd === undefined) return undefined;
  const logger = createLogger(apiServiceIdentity(config), {
    level: config.observability.logLevel,
  });
  return createDailySpendCap({
    capUsd,
    readSpentSinceUsd: createPostgresDailySpendReader({ sql: database.sql }),
    onReadFailure: (error) => {
      logger.warn(
        { err: error, spendCap: "DAILY_AGGREGATE" },
        "daily spend cap could not read the ledger; using the last total",
      );
    },
  });
})();

const wordsReaders =
  gateqModelProviders.length === 0
    ? undefined
    : createWordsReaders({
        gateway: createModelGateway({
          catalog: createPostgresModelCatalog({ sql: database.sql }),
          registry: createModelProviderRegistry(gateqModelProviders),
          usage: createPostgresModelUsageRepository({ sql: database.sql }),
          health: createProcessLocalProviderHealth(),
          spendCap: gateqSpendCap,
          syntheticDemo: createSyntheticDemoRoutingAllowance({
            operatorEnabled: gateqProviderSecrets.syntheticDemoRouting,
            environment: config.runtime.deploymentEnvironment,
            databaseUrl: databaseConfig.secrets.url,
          }),
          logger: createLogger(apiServiceIdentity(config), {
            level: config.observability.logLevel,
          }),
        }),
      });

const gateqApply =
  gateqModelProviders.length === 0
    ? undefined
    : (() => {
        const intake = createIntakeService({
          applications: createPostgresApplicationRepository({
            sql: database.sql,
          }),
          sessions: createPostgresApplicationSessionRepository({
            sql: database.sql,
          }),
          facts: createPostgresApplicationFactRepository({
            sql: database.sql,
          }),
          submissions: createPostgresApplicationSubmissionRepository({
            sql: database.sql,
          }),
          documents: createPostgresApplicationDocumentRepository({
            sql: database.sql,
          }),
          policies: gateqIntakePolicies,
          taxonomy: createIntakeTaxonomyPort({
            sql: database.sql,
            candidates: taxonomy.classification.candidates,
            reference: createPostgresTaxonomyReferenceRepository(),
          }),
          transactions: database.transactions,
          logger: createLogger(apiServiceIdentity(config), {
            level: config.observability.logLevel,
          }),
        });
        const conversation = createConversationService({
          intake,
          interviewer: createGateQInterviewer({
            gateway: createModelGateway({
              catalog: createPostgresModelCatalog({ sql: database.sql }),
              registry: createModelProviderRegistry(gateqModelProviders),
              usage: createPostgresModelUsageRepository({ sql: database.sql }),
              health: createProcessLocalProviderHealth(),
              spendCap: gateqSpendCap,
              // Doc 15 §62: an attestation about the whole deployment,
              // re-checked against environment and database. Never
              // something a request, a header or a hostname can claim.
              syntheticDemo: createSyntheticDemoRoutingAllowance({
                operatorEnabled: gateqProviderSecrets.syntheticDemoRouting,
                environment: config.runtime.deploymentEnvironment,
                databaseUrl: databaseConfig.secrets.url,
              }),
              logger: createLogger(apiServiceIdentity(config), {
                level: config.observability.logLevel,
              }),
            }),
          }),
          policies: gateqIntakePolicies,
          publicGatewayFor: async (gatewayId) => {
            const gateway = await gateqGateways.findById(
              gatewayId as Parameters<typeof gateqGateways.findById>[0],
            );
            return gateway === null
              ? null
              : gateq.publicGateway(gateway.publicId);
          },
          turnMemory: createPostgresApplicationSessionRepository({
            sql: database.sql,
          }),
          logger: createLogger(apiServiceIdentity(config), {
            level: config.observability.logLevel,
          }),
        });
        // One instance's counters (CQ-GATE-002S §8). Weaker than a shared
        // limiter and far stronger than none; a distributed one is a real
        // thing to want and not this packet.
        return { intake, conversation, throttle: createGuestThrottle() };
      })();

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
  // Plain-language names for options in the conversational interview
  // (CQ-PRE-REC-001 §19). Recognition only; each journey definition still
  // validates the answer it produces.
  utteranceAliases: {
    ...FOUNDER_UTTERANCE_ALIASES,
    ...INVESTOR_UTTERANCE_ALIASES,
  },
  // J7: a short reply's move (skip, why, a plain yes), read by meaning.
  moveReader:
    wordsReaders === undefined
      ? undefined
      : (input) =>
          wordsReaders.onboardingMove(
            { tenantId: input.tenantId, userId: input.userId },
            input,
          ),
  // Where each journey's figures and exclusions live in a sentence, and
  // Capital Q's own taxonomy classifier for category phrases
  // (CQ-Q-VOICE-001 A): one sentence may answer many questions, each
  // proposal validated by the definition and confirmed by the person.
  interviewCues: { ...FOUNDER_INTERVIEW_CUES, ...INVESTOR_INTERVIEW_CUES },
  // ADR 0024: the profile facts a completed onboarding may still revise.
  revisableSteps: {
    founder: FOUNDER_REVISABLE_STEPS,
    investor: INVESTOR_REVISABLE_STEPS,
  },
  taxonomy: {
    findCandidates: async (input) => {
      const result = await taxonomy.classification.candidates.findCandidates({
        text: input.text,
        vocabularyCodes: input.vocabularyCodes,
        limit: input.limit,
      });
      return result.candidates.map((candidate) => ({
        nodeId: String(candidate.nodeId),
        displayName: candidate.displayName,
        vocabularyCode: String(candidate.vocabularyCode),
        confidence: String(candidate.confidence),
        exact: candidate.matchTypes.some((type) => type !== "LEXICAL"),
      }));
    },
  },
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

// Evidence. The storage adapter is composed only when a privileged
// storage credential is configured: without it the document upload
// boundary refuses rather than opening, and the rest of the API still
// serves. The credential never leaves this process.
const storage =
  config.secrets.supabaseSecretKey === undefined
    ? undefined
    : createSupabaseDocumentStorageProvider({
        supabaseUrl: supabaseAuth.url,
        secretKey: config.secrets.supabaseSecretKey,
      });

const evidence = createEvidenceService({
  sql: database.sql,
  transactions: database.transactions,
  authorization,
  subjects: createEvidenceSubjectResolverRegistry([
    createCompanyEvidenceSubjectResolver(
      createPostgresCompanyQueryPort({ sql: database.sql }),
    ),
  ]),
  outbox,
  audit,
  securityEvents: createPostgresSecurityEventWriter({ sql: database.sql }),
  ...(storage === undefined
    ? {}
    : {
        storage,
        uploads: {
          bucket: DOCUMENT_STORAGE_BUCKET,
          maxBytes: config.public.documentUploadMaxBytes,
          sessionTtlSeconds: DOCUMENT_UPLOAD_SESSION_TTL_SECONDS,
          maxOpenSessions: DOCUMENT_UPLOAD_MAX_OPEN_SESSIONS,
        },
      }),
});

// Pitch media. The Cloudflare Stream adapter is composed only when its
// credential is configured (CQ-MEDIA-010); the token is revealed here and
// nowhere else. Without it the Media context holds an explicit unconfigured
// provider that refuses every upload and playback by naming what is missing.
const cloudflareStream = config.secrets.videoProviders.cloudflareStream;
const videoProvider =
  cloudflareStream === undefined
    ? createUnconfiguredVideoProvider({
        missing: config.public.videoProviders.missing,
      })
    : createCloudflareStreamVideoProvider({
        accountId: cloudflareStream.accountId,
        apiToken: cloudflareStream.apiToken.reveal(),
        customerSubdomain: cloudflareStream.customerSubdomain,
        signingKey:
          cloudflareStream.signingKey === undefined
            ? undefined
            : {
                keyId: cloudflareStream.signingKey.keyId,
                pem: cloudflareStream.signingKey.pem.reveal(),
              },
      });
// Discovery (doc 19): the founder side still reads the deterministic
// visibility slate; the investor side is served from persisted
// recommendation slates (CQ-REC-006) behind a read-time REC-001 guard over
// the same disclosure evaluator the Q service uses. The API never builds a
// slate: a page with nothing servable asks the refresh queue for one.
const discovery = createDiscoveryService({
  repository: createPostgresDiscoveryRepository({ sql: database.sql }),
});
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
  findManyByInvestor: (investorOrganisationId, companyIds) =>
    relationshipRepository.findByInvestorAndCompanies(
      database.sql,
      investorOrganisationId,
      companyIds,
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
// A company's own document, for the disclosure layer (diligence): tenant,
// company, title; read permission-neutrally from Evidence's own table.
const diligenceDocumentLookup = (documentId: string) =>
  findActiveDocumentById(database.sql, documentId);
const disclosurePorts = {
  companies: createPostgresCompanyQueryPort({ sql: database.sql }),
  investors: createPostgresInvestorOrganisationQueryPort({ sql: database.sql }),
  mandates: createPostgresInvestorMandateQueryPort({ sql: database.sql }),
  capital: createPostgresCapitalObjectiveQueryPort({ sql: database.sql }),
  relationships,
  // Diligence: a company's own document as a disclosure resource.
  documents: {
    findCanonicalDocument: async (documentId: string) =>
      (await diligenceDocumentLookup(documentId)) ?? null,
  },
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
// BILLING-2 block (ADR 0036): how far down the ranked slate the reader's
// plan lets the feed page. Today every plan carries the slate policy's
// own number, so nothing changes; ranking never reads a plan.
const recommendationVolume = createEntitlementService({ sql: database.sql });
// end BILLING-2 block
const companySectors = createPostgresCompanySectorsPort({ sql: database.sql });
// ADR 0041: the investor-facing team projection (allow-listed fields).
const companyTeamProjection = createPostgresCompanyTeamProjection({
  sql: database.sql,
});
// One composition of the filter facts: Discover's filters read them, and a
// company's profile reads the same raise and verification answers, so the
// two can never disagree about what this reader may know.
const discoverFilterFacts = createDiscoverFilterFacts({
  companies: disclosurePorts.companies,
  capital: disclosurePorts.capital,
  disclosure,
  verification: () => cardVerification,
  pitches: () => discoverablePitches,
});
// F4: the investor's GateQ inbox, under GateQ's own gateway authority.
// P14: a founder's GateQ application joins the canonical company-investor
// relationship through Network's own command (never a parallel record).
const gateqNetwork = createNetworkService({
  sql: database.sql,
  transactions: database.transactions,
  companies: createPostgresCompanyQueryPort({ sql: database.sql }),
  investors: createPostgresInvestorOrganisationQueryPort({ sql: database.sql }),
  outbox,
  audit,
});
const gateqFounders = createPostgresApplicationFounders({ sql: database.sql });
const gateqLogger = createLogger(apiServiceIdentity(config), {
  level: config.observability.logLevel,
});
// P14/F27: a founder's application joins the ONE canonical company-investor
// relationship through Network's own command (source GATEQ), never a
// parallel record. Discovery is the founder's own side (founder_private).
const joinGateqRelationship = createApplicationRelationshipJoin({
  link: (input) => gateqFounders.link(input),
  setRelationship: (input) => gateqFounders.setRelationship(input),
  ensureRelationship: async (command) => {
    const ensured = await gateqNetwork.ensureRelationship({
      actor: command.actor,
      companyId: CompanyIdSchema.parse(command.companyId),
      investorOrganisationId: InvestorOrganisationIdSchema.parse(
        command.investorOrganisationId,
      ),
      source: { type: "GATEQ", id: command.applicationId },
      visibilityScope: command.visibilityScope,
      correlationId: CorrelationIdSchema.parse(`cor_${crypto.randomUUID()}`),
    });
    return { relationshipId: ensured.relationship.id };
  },
});
// F27 backfill: applications whose share 500'd before the fix (none
// linked) join their relationship at start. Bounded, idempotent, never
// fatal; acts only as a founder who still holds an active membership.
void (async () => {
  try {
    const pending = await gateqFounders.unlinked(100);
    let linked = 0;
    for (const row of pending) {
      try {
        if ((await joinGateqRelationship(row)) !== null) linked += 1;
      } catch (error: unknown) {
        gateqLogger.warn(
          { err: error },
          "gateq relationship backfill: one skipped",
        );
      }
    }
    if (pending.length > 0) {
      gateqLogger.info(
        { pending: pending.length, linked },
        "gateq relationship backfill done",
      );
    }
  } catch (error: unknown) {
    gateqLogger.warn({ err: error }, "gateq relationship backfill failed");
  }
})();

// P14: a founder hears a pass or a reply by email, through the same app
// sender as team email, recorded like every app email; outcome logged with
// the recipient's domain only.
const gateqFounderMail =
  teamEmailConfig.brevoApi !== undefined
    ? recordingEmailSender(
        createBrevoApiEmailSender(teamEmailConfig.brevoApi),
        {
          sql: database.sql,
          source: "api.gateq_answer",
          provider: "BREVO_API",
        },
      )
    : teamEmailConfig.smtp === undefined
      ? unavailableAppEmailSender
      : recordingEmailSender(createSmtpAppEmailSender(teamEmailConfig.smtp), {
          sql: database.sql,
          source: "api.gateq_answer",
          provider: "SMTP",
        });
const logGateqEmail = (event: GateqEmailEvent) => {
  const fields = {
    event: "gateq.email",
    kind: event.kind,
    outcome: event.outcome,
    recipientDomain: event.recipientDomain,
    ...(event.error instanceof Error ? { errorName: event.error.name } : {}),
  };
  if (event.outcome === "SENT") teamLogger.info(fields, "gateq email sent");
  else teamLogger.warn(fields, "gateq email not sent");
};
const gateqInboxService = createGateqInbox({
  sql: database.sql,
  transactions: database.transactions,
  gateq,
  founderMail: gateqFounderMail,
  onEmail: logGateqEmail,
  documents: sharedDocumentsPort({
    sql: database.sql,
    authorizeVersion:
      storage === undefined
        ? undefined
        : (share) =>
            createSharedDocumentDownloads({ sql: database.sql, storage })
              .authorizeSharedVersion({ ...share, disposition: "ATTACHMENT" })
              .then((link) => (link === null ? null : { url: link.url })),
  }),
});
const slates = createSlateReadPipeline({
  sql: database.sql,
  disclosure,
  // A passed company with a pitch that became playable after the pass is
  // offered again, labelled (doc 19 §67). Read per request.
  pitchTimes: {
    latestReadyAt: (companyIds) =>
      discoverablePitches.latestReadyAt?.(companyIds) ??
      Promise.resolve(new Map()),
  },
  // After a post-meeting pass, the company comes back only on a material
  // change (doc 19 §67): a new pitch, a new raise, or a changed mandate.
  materialChanges: createMaterialChanges({
    pitchReadyAt: (companyIds) =>
      discoverablePitches.latestReadyAt?.(companyIds) ??
      Promise.resolve(new Map()),
    capitalObjectiveAt: createPostgresCapitalObjectiveTimes({
      sql: database.sql,
    }).latestCreatedAt,
  }),
  // A plan value is configuration, not a gate: if it cannot be read the
  // feed serves the whole slate rather than failing.
  volume: (actor) =>
    recommendationVolume
      .valueOf(billingAccountOf(actor), VALUE_RECOMMENDATION_VOLUME)
      .catch(() => null),
  queue: createPostgresRefreshQueue({ sql: database.sql }),
  // Discover filters (ux/discover-filters). The verification reader and
  // the pitch port are composed further down; they are read per request.
  filterFacts: discoverFilterFacts,
});

/**
 * An investor opening a company from Discover: the network projection of
 * a company another organisation owns, when disclosure says it is
 * network-visible or public to this actor. The same rule Q's company tool
 * applies, so the page and Q's answer cannot disagree about who may see
 * a company.
 */
const isCompanyNetworkVisible = async (
  actor: Parameters<typeof actorPrincipal>[0],
  companyId: Parameters<
    typeof disclosurePorts.companies.findCanonicalCompanyProfile
  >[0],
): Promise<boolean> => {
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
};
const companyNetworkView = {
  findNetworkVisible: async (
    actor: Parameters<typeof actorPrincipal>[0],
    companyId: Parameters<
      typeof disclosurePorts.companies.findCanonicalCompanyProfile
    >[0],
  ) =>
    (await isCompanyNetworkVisible(actor, companyId))
      ? disclosurePorts.companies.findCanonicalCompanyProfile(companyId)
      : null,
};

/**
 * What an investor did with a recommendation (CQ-REC-008).
 *
 * It borrows the read pipeline's own eligibility ports and slate
 * repository, deliberately: the check that decides whether a company may
 * still be acted on is the same REC-001 evaluation the feed runs on every
 * page, and a second copy of that rule would be a second answer to the
 * same question.
 */
const interactions = createInteractionSignalService({
  ports: slates.eligibilityPorts,
  eligibility: slates.eligibility,
  slates: slates.slates,
  repository: createPostgresInteractionRepository({ sql: database.sql }),
});

/**
 * Explore (E1-E5, ADR 0055): every network pitch this viewer may see,
 * lightly personalised. The pool is the founders' network videos, each
 * company through the network preview's disclosure rule; sectors through
 * the company-sectors port only for companies already allowed. Signals are
 * declared or explicit: the Discover slate (mandate fit), saves, and for a
 * founder their own company's sectors. Views are never read.
 */
const exploreCompanyQuery = createPostgresCompanyQueryPort({
  sql: database.sql,
});
const explore = createExploreService({
  findNetworkPitches: createPostgresNetworkPitchQueryPort({ sql: database.sql })
    .findNetworkPitches,
  company: async (actor, companyId) => {
    const parsed = CompanyIdSchema.safeParse(companyId);
    if (!parsed.success) return null;
    const company = await companyNetworkView.findNetworkVisible(
      actor,
      parsed.data,
    );
    return company === null
      ? null
      : {
          canonicalName: company.canonicalName,
          shortDescription: company.shortDescription,
          headquartersCountry: company.headquartersCountry,
          currentStageCode: company.currentStageCode,
          companyStatus: company.companyStatus,
        };
  },
  sectors: async (_actor, companyIds) =>
    companySectors.sectors === undefined
      ? new Map<string, readonly string[]>()
      : companySectors.sectors(companyIds),
  signals: async (actor) => {
    const mandate = new Set<string>();
    const adjacent = new Set<string>();
    let cursor: string | null = null;
    for (let page = 0; page < 3; page++) {
      const served: Awaited<
        ReturnType<typeof slates.reader.pageCompanies>
      > | null = await slates.reader
        .pageCompanies({ actor, limit: 20, cursor })
        .catch(() => null);
      if (served === null) break;
      for (const item of served.items) {
        mandate.add(item.companyId);
        if (!item.reasonCodes.includes("STAGE_ALIGNED")) {
          adjacent.add(item.companyId);
        }
      }
      cursor = served.nextCursor;
      if (cursor === null) break;
    }
    const saved = await interactions
      .savedCompanyIds({ actor, limit: 100 })
      .catch(() => [] as readonly string[]);
    // A founder's own company, for peers: only their own organisation's.
    const own =
      actor.organisationId === undefined
        ? []
        : (
            await exploreCompanyQuery
              .searchCompanies({
                viewer: {
                  tenantId: actor.tenantId,
                  organisationId: actor.organisationId,
                },
                limit: 5,
              })
              .catch(() => ({ items: [] }))
          ).items
            .filter((item) => item.ownedByViewer)
            .map((item) => item.id);
    const ownSectors =
      own.length === 0 || companySectors.sectors === undefined
        ? new Map<string, readonly string[]>()
        : await companySectors
            .sectors(own)
            .catch(() => new Map<string, readonly string[]>());
    return {
      mandateCompanyIds: mandate,
      adjacentCompanyIds: adjacent,
      savedCompanyIds: new Set(saved),
      ownSectorNodeIds: new Set([...ownSectors.values()].flat()),
    };
  },
});

/**
 * Express Interest (CQ-NET-010). Two rules it borrows rather than restates:
 * "which investor organisation is this person acting for" is the feed's
 * own investor subject, and "may they see this company" is the network
 * preview's disclosure rule above. The command itself — capability,
 * idempotency, the one canonical relationship, the history event and the
 * outbox — is the Network context's.
 */
const interests = createInterestService({
  sql: database.sql,
  transactions: database.transactions,
  companies: createPostgresCompanyQueryPort({ sql: database.sql }),
  investors: createPostgresInvestorOrganisationQueryPort({ sql: database.sql }),
  outbox,
  audit,
  authorization,
  investorSubject: slates.eligibilityPorts.investorSubject,
  companyVisibility: { isVisibleToInvestor: isCompanyNetworkVisible },
});

/**
 * Commitments (spec 6.6.14-6.6.15): stated by one side, confirmed by the
 * other, each relationship counted once; history through Network's own
 * appender.
 */
const commitments = createCommitmentService({
  sql: database.sql,
  transactions: database.transactions,
  interests,
  appender: createRelationshipEventAppender({
    registry: createRelationshipEventRegistry(RELATIONSHIP_EVENT_DEFINITIONS),
    repositories: {
      relationships: createPostgresRelationshipRepository(),
      events: createPostgresRelationshipEventRepository(),
    },
  }),
  newCorrelationId: () => CorrelationIdSchema.parse(createCorrelationId()),
  // 2026-10-04: each step is announced, so the other side is told.
  outbox,
});
/** Capital rounds (2026-10-04): under the raise's own capabilities. */
const capitalRounds = createCapitalRoundService({
  sql: database.sql,
  transactions: database.transactions,
  authorization,
  companies: createPostgresCompanyQueryPort({ sql: database.sql }),
  audit,
  // P8: a round with RECEIVED money is final-closed, never cancelled; the
  // received money is Network's to say, through its own ledger.
  moneyReceivedInRound: async ({ actor, companyId, roundId }) =>
    (await commitments.ledger({ actor, side: "COMPANY", companyId })).sums.some(
      (sum) => sum.roundId === roundId && sum.received !== "0",
    ),
});
/**
 * Post-meeting outcomes (2026-10-02): the investor's Pass, Pause and Resume
 * and a confirmed meeting outcome, through Network's own appender and
 * outbox. A pass records the mandate it was made under (doc 19 §67).
 */
const outcomes = createRelationshipOutcomeService({
  sql: database.sql,
  transactions: database.transactions,
  interests,
  appender: createRelationshipEventAppender({
    registry: createRelationshipEventRegistry(RELATIONSHIP_EVENT_DEFINITIONS),
    repositories: {
      relationships: createPostgresRelationshipRepository(),
      events: createPostgresRelationshipEventRepository(),
    },
  }),
  outbox,
  activeMandate: async (actor, investorOrganisationId) => {
    const found = await slates.eligibilityPorts.mandates.activeMandate({
      tenantId: actor.tenantId,
      investorOrganisationId,
      mandateId: null,
    });
    return found.kind === "FOUND"
      ? { mandateId: found.mandate.mandateId, version: found.mandate.version }
      : null;
  },
  newCorrelationId: () => CorrelationIdSchema.parse(createCorrelationId()),
});
// ADMIN block (spec §5): a person's own results. The raise is the same
// view Capital shows: the current objective's target and the commitments
// both sides stated or confirmed, authorised by the company's own listing.
const results = createResultsReader({
  sql: database.sql,
  raise: async (actor, companyId) => {
    let target: { amount: string; currencyCode: string } | null = null;
    try {
      const objective = await capital.getCurrentCapitalObjective({
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
    const view = await commitments.fundraising({ actor, companyId, target });
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

/**
 * Founder Connection Requests (ADR 0023). The founder's company is their
 * active organisation's one canonical company; the investor is the one
 * discovery would show this founder (network-visible, admitted by
 * disclosure), with the preference the investor declared; QUALIFIED is the
 * investor's own ACTIVE mandate's hard rules over the company's facts.
 */
const companyQuery = createPostgresCompanyQueryPort({ sql: database.sql });
const investorQuery = createPostgresInvestorOrganisationQueryPort({
  sql: database.sql,
});
const connections = createConnectionService({
  sql: database.sql,
  transactions: database.transactions,
  companies: companyQuery,
  investors: investorQuery,
  outbox,
  audit,
  authorization,
  investorSubject: slates.eligibilityPorts.investorSubject,
  companyVisibility: { isVisibleToInvestor: isCompanyNetworkVisible },
  founderSubject: {
    companyFor: async (actor) => {
      if (actor.organisationId === undefined) return null;
      const company = await companyQuery.findOrganisationCompany?.(
        actor.tenantId,
        actor.organisationId,
      );
      return company == null ? null : { companyId: company.id };
    },
  },
  investorReach: {
    visibleInvestor: async (actor, investorOrganisationId) => {
      const investor = await discovery.findInvestor(
        actor,
        investorOrganisationId,
      );
      if (investor === null) return null;
      const preference = investor.inboundPreference;
      return {
        inboundPreference:
          preference === "OPEN" ||
          preference === "QUALIFIED" ||
          preference === "CLOSED"
            ? preference
            : null,
      };
    },
    companyQualifies: async (companyId, investorOrganisationId) => {
      const parsed = InvestorOrganisationIdSchema.safeParse(
        investorOrganisationId,
      );
      if (!parsed.success) return false;
      const investor = await investorQuery.findCanonicalInvestorOrganisation(
        parsed.data,
      );
      if (investor === null) return false;
      return slates.eligibility.qualifiesForInvestor({
        tenantId: investor.tenantId,
        investorOrganisationId,
        companyId,
      });
    },
  },
});

// Pitch media. Composed after discovery because a viewer's right to play
// a pitch (CQ-MEDIA-011) is the same REC-001 evaluation the feed runs on
// every page and the interaction service runs on every save: the actor's
// own investor organisation, its ACTIVE mandate, and the company eligible
// for it now. The company's tenant comes from the marketplace facts, never
// from the request. Media itself decides nothing about discoverability.
const marketplaceFacts = createPostgresCompanyMarketplaceQueryPort({
  sql: database.sql,
});
/**
 * Whether an investor may view a company's pitch (CQ-MEDIA-011): the
 * actor's own investor organisation, its ACTIVE mandate, and the company
 * eligible for it now. Named because ADR 0041 reuses it as-is for the
 * deck an owner opened to investors and for the team.
 */
const resolveViewableCompany = async (
  actor: Parameters<typeof actorPrincipal>[0],
  companyId: string,
) => {
  const investor =
    await slates.eligibilityPorts.investorSubject.investorOrganisationFor(
      actor,
    );
  if (investor === null) return null;
  const mandate = await slates.eligibilityPorts.mandates.activeMandate({
    tenantId: actor.tenantId,
    investorOrganisationId: investor.investorOrganisationId,
    mandateId: null,
  });
  if (mandate.kind !== "FOUND" || mandate.mandate.status !== "ACTIVE") {
    return null;
  }
  const parsedCompanyId = CompanyIdSchema.safeParse(companyId);
  if (!parsedCompanyId.success) return null;
  const evaluation = await slates.eligibility.evaluate({
    actor,
    mode: "INVESTOR_DISCOVER",
    // Viewing material is mandate fit, not "not yet known": a connected or
    // in-diligence investor whose mandate fits keeps the pitch and deck.
    purpose: "VIEW",
    mandateId: mandate.mandate.mandateId,
    companyIds: [parsedCompanyId.data],
  });
  const eligible = evaluation.results.some(
    (result) =>
      result.companyId === parsedCompanyId.data &&
      result.decision === "ELIGIBLE",
  );
  if (!eligible) return null;
  const [facts] = await marketplaceFacts.findCanonicalMarketplaceFacts([
    parsedCompanyId.data,
  ]);
  return facts === undefined
    ? null
    : {
        tenantId: facts.tenantId,
        ownerOrganisationId: facts.organisationId,
      };
};

const media = createMediaService({
  sql: database.sql,
  transactions: database.transactions,
  authorization,
  owners: createMediaOwnerResolverRegistry([
    createCompanyMediaOwnerResolver(
      createPostgresCompanyQueryPort({ sql: database.sql }),
    ),
  ]),
  outbox,
  audit,
  videoProvider,
  viewers: {
    resolveViewableCompany,
    // A video its owner opened to everyone on Capital Q (ADR 0021): the
    // same disclosure decision the network preview uses, for any signed-in
    // participant, and only while the company is active.
    resolveNetworkCompany: async (actor, companyId) => {
      const parsedCompanyId = CompanyIdSchema.safeParse(companyId);
      if (!parsedCompanyId.success) return null;
      if (!(await isCompanyNetworkVisible(actor, parsedCompanyId.data))) {
        return null;
      }
      const [facts] = await marketplaceFacts.findCanonicalMarketplaceFacts([
        parsedCompanyId.data,
      ]);
      return facts === undefined || facts.companyStatus !== "active"
        ? null
        : {
            tenantId: facts.tenantId,
            ownerOrganisationId: facts.organisationId,
          };
    },
  },
});

const discoverablePitches = createPostgresDiscoverablePitchQueryPort({
  sql: database.sql,
});

// R2: the one company read for the raise. The Discover card and the
// profile both render this, so one reader is told one thing on both.
const companyRaise = createApiCompanyRaiseReader({
  sql: database.sql,
  companies: disclosurePorts.companies,
  capital: disclosurePorts.capital,
  disclosure,
  policies: createPostgresDisclosurePolicyRepository(),
  isInvestor: async (actor) =>
    (await slates.eligibilityPorts.investorSubject.investorOrganisationFor(
      actor,
    )) !== null,
  pitches: () => discoverablePitches,
  mayPlay: async (actor, companyId, mediaAssetId) => {
    const parsed = MediaAssetIdSchema.safeParse(mediaAssetId);
    return parsed.success
      ? media.mayPlayPitch({ actor, companyId, mediaAssetId: parsed.data })
      : false;
  },
  pitchCues: async (actor, companyId, mediaAssetId) => {
    const parsed = MediaAssetIdSchema.safeParse(mediaAssetId);
    if (!parsed.success) return null;
    const view = await media.getPitchTranscript({
      actor,
      companyId,
      mediaAssetId: parsed.data,
    });
    return view.status === "AVAILABLE" ? view.cues : null;
  },
});

/**
 * The visibility control centre (CQ-BIZ-003). The same disclosure layer
 * the reads above use, plus its policy manager for shares and revokes;
 * the company's relationships are the Network context's own list for the
 * company's side, so a private discovery is never one of them.
 */
const permissions = createPermissionsService({
  sql: database.sql,
  transactions: database.transactions,
  authorization,
  outbox,
  audit,
  resolvers: createDisclosureResourceResolverRegistry(
    createDefaultDisclosureResolvers(disclosurePorts),
  ),
  relationshipParties: createRelationshipPartyResolver(disclosurePorts),
});
/**
 * Diligence (2026-10-02): a relationship's minimal gated document area. A
 * share is the disclosure policy above (relationship_shared), revocable; a
 * download is decided by the access service, then signed straight from
 * storage; requests and their answers are Network's, append-only.
 */
// ADR 0042 (founder decision 2026-10-03): with no scanner attached, a
// NOT_SCANNED file may reach the audiences that already have access,
// flagged scanned:false. Off unless CQ_MALWARE_POLICY says so explicitly.
// Only the deck audience and diligence shares take it; chat attachments
// and admin KYB reads stay CLEAN-only.
const serveUnscanned = config.public.serveUnscannedDocuments;
const diligenceDocuments =
  storage === undefined
    ? undefined
    : createSharedDocumentDownloads({
        sql: database.sql,
        storage,
        serveUnscanned,
      });
const diligence = createDiligenceService({
  sql: database.sql,
  transactions: database.transactions,
  relationships: interests,
  policies: permissions.policies,
  policyRepository: createPostgresDisclosurePolicyRepository(),
  access: disclosure,
  documents: {
    ownDocument: async (actor, documentId) => {
      const document = await evidence
        .getDocument({ actor, documentId: DocumentIdSchema.parse(documentId) })
        .catch(() => null);
      return document === null
        ? null
        : {
            id: document.id,
            tenantId: document.tenantId,
            companyId: document.companyId,
            title: document.title,
            documentType: document.documentType,
            currentVersionId: document.currentVersionId,
          };
    },
    // Its scan state rides along (ADR 0042): the list says "Not
    // virus-scanned yet" beside a NOT_SCANNED file.
    canonical: (documentId) => diligenceDocumentLookup(documentId),
    // Upload and share in one step: the documents screen's own completion,
    // as the founder (Evidence authorises their own upload session).
    completeUpload: async (command) => {
      const completed = await evidence.completeDocumentUploadSession({
        actor: command.actor,
        uploadSessionId: command.uploadSessionId,
        input: {},
        idempotencyKey: command.idempotencyKey,
        correlationId: command.correlationId,
      });
      return { documentId: completed.document.id };
    },
    signedDownload: async (document, disposition = "ATTACHMENT") => {
      if (
        diligenceDocuments === undefined ||
        document.currentVersionId === null
      ) {
        throw new DocumentNotFoundError();
      }
      const link = await diligenceDocuments.authorizeSharedVersion({
        documentTenantId: document.tenantId,
        documentId: document.id,
        documentVersionId: document.currentVersionId,
        disposition,
      });
      return {
        url: link.url,
        expiresAt: link.expiresAt,
        scanned: link.scanned,
      };
    },
  },
  requests: createPostgresDiligenceRequests(),
  // The questions a request carried, so its state comes from their answers.
  questions: createPostgresDiligenceQuestions(),
  appender: createRelationshipEventAppender({
    registry: createRelationshipEventRegistry(RELATIONSHIP_EVENT_DEFINITIONS),
    repositories: {
      relationships: createPostgresRelationshipRepository(),
      events: createPostgresRelationshipEventRepository(),
    },
  }),
  audit,
  notify: (input) =>
    createCounterpartNotices(database.sql).notify({
      relationshipId: input.relationshipId,
      actingSide: input.actingSide,
      kind: "DILIGENCE",
      title: input.title,
      body: null,
      // A request opens the founder's inbox at it (2026-10-08); a share
      // opens the investor's Diligence tab.
      target: input.actingSide === "INVESTOR" ? "DOCUMENTS" : "DILIGENCE",
      key: input.key,
      priority: input.priority,
    }),
  newCorrelationId: () => CorrelationIdSchema.parse(createCorrelationId()),
});
// Overnight A3-A7: the profile's data room, pitch deck and founder pages,
// each through the rule that already governs it (profile-material.ts).
const profileMaterial = createProfileMaterial({
  sql: database.sql,
  transactions: database.transactions,
  storage,
  serveUnscanned,
  authorization,
  policies: permissions.policies,
  access: disclosure,
  audit,
  outbox,
  investorOrganisationFor: (actor) =>
    slates.eligibilityPorts.investorSubject.investorOrganisationFor(actor),
  investorMayFind: async (actor, companyId) =>
    (await resolveViewableCompany(actor, companyId)) !== null,
  // 2026-10-08: a request opens the founder's inbox at that request; an
  // answer opens the investor's view of the company's data room.
  notify: (input) =>
    createCounterpartNotices(database.sql).notify({
      relationshipId: input.relationshipId,
      actingSide: input.actingSide,
      kind: "DILIGENCE",
      title: input.title,
      body: null,
      target: input.actingSide === "INVESTOR" ? "DOCUMENTS" : "COMPANY_PROFILE",
      key: input.key,
      priority: input.priority,
    }),
  notifyRequests: (input) =>
    createCounterpartNotices(database.sql).notify({
      relationshipId: input.relationshipId,
      actingSide: input.actingSide,
      kind: "DILIGENCE",
      title: input.title,
      body: null,
      target:
        input.target === "REQUESTS"
          ? "DOCUMENTS"
          : input.target === "DILIGENCE"
            ? "DILIGENCE"
            : "COMPANY_PROFILE",
      key: input.key,
      priority: input.priority,
    }),
  answers: createInvestorAnswers({
    sql: database.sql,
    transactions: database.transactions,
    evidence,
  }),
});
// Q.03/Q.04/Q.01: the founder's own readiness, action plan and Q's
// follow-up questions. Founder-private (Context Firewall): the company is
// the actor's own, from the server-resolved context; every input is read
// through its own service as the founder, and nothing investor-facing
// reads the result.
const readiness = createReadinessService({
  store: createPostgresReadinessStore({ sql: database.sql }),
  ownCompanyId: async (actor) => {
    if (actor.organisationId === undefined) return null;
    const company = await companyQuery.findOrganisationCompany?.(
      actor.tenantId,
      actor.organisationId,
    );
    return company == null ? null : company.id;
  },
  deck: readinessDeckFrom(profileMaterial.companyDeck),
  dataRoom: readinessDataRoomFrom(profileMaterial.dataRoom),
  raise: readinessRaiseFrom(async (actor, companyId) => {
    try {
      return await capital.getCurrentCapitalObjective({
        actor,
        companyId: CompanyIdSchema.parse(companyId),
      });
    } catch (error: unknown) {
      if (error instanceof CapitalObjectiveNotFoundError) return null;
      throw error;
    }
  }),
  followUps: readinessFollowUps(onboarding.runtime),
});
const visibility = createVisibilityCentre({
  access: permissions.access,
  inspect: permissions.inspectResourceDisclosure,
  policies: permissions.policies,
  authorization,
  companies: disclosurePorts.companies,
  capital: disclosurePorts.capital,
  relationshipParties: createRelationshipPartyResolver(disclosurePorts),
  relationshipsOf: async (actor, companyId) =>
    (await interests.listRelationshipsForCompany({ actor, companyId })).map(
      (listing) => ({
        relationshipId: listing.relationship.id,
        investorOrganisationId: listing.relationship.investorOrganisationId,
        name: listing.counterpartName,
      }),
    ),
});
// Handles and the Q Card (BIZ-004). The public-identity context holds no
// profile data: a card's facts are read through each owning context's
// permission-neutral port and projected through the card's allowlist.
const companyFacts = createPostgresCompanyQueryPort({ sql: database.sql });
const investorFacts = createPostgresInvestorProfileQueryPort({
  sql: database.sql,
});
const cardVerification = createPublicVerificationReader({
  sql: database.sql,
});
const cardSubjects = createSubjectDirectory({
  // Founder design 2026-09-28: the active mandate's shareable facts, off
  // on every card until its owner turns one on.
  findInvestorMandateFacts: createInvestorCardFacts({
    mandates: createPostgresInvestorMandateQueryPort({ sql: database.sql }),
    tenantOf: async (investorOrganisationId) =>
      (await investorFacts.findCanonicalInvestorProfile(investorOrganisationId))
        ?.tenantId ?? null,
  }),
  findCompany: async (companyId) => {
    const id = CompanyIdSchema.safeParse(companyId);
    return id.success
      ? companyFacts.findCanonicalCompanyProfile(id.data)
      : null;
  },
  findInvestor: (investorOrganisationId) =>
    investorFacts.findCanonicalInvestorProfile(investorOrganisationId),
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

// Profile photos and covers (founder directive 2026-09-28): the same
// private-storage adapter as documents, pointed at the image bucket; the
// browser uploads straight to storage and this process only re-encodes.
const profileImages = createProfileImageService({
  sql: database.sql,
  transactions: database.transactions,
  authorization,
  audit,
  subjects: cardSubjects,
  repository: createPostgresProfileImageRepository(),
  storage,
  processor: storage === undefined ? undefined : createSharpImageProcessor(),
});

// The pictures of who a list names (founder decision 2026-10-04): a photo
// or logo has its name's scope, so a route that names someone signs their
// picture with the name, one batch per response.
const namedPhotos = createNamedImageReader({
  sql: database.sql,
  store: createPostgresNamedImageStore(),
  storage,
});

const publicIdentity = createPublicIdentityService({
  sql: database.sql,
  transactions: database.transactions,
  authorization,
  audit,
  repository: createPostgresPublicIdentityRepository(),
  subjects: cardSubjects,
  cardImages: (subject) => profileImages.cardImageUrls(subject),
});

// A person's own Gmail (BIZ-007): connect, disconnect, reply push. The
// same composition q-api (which sends) and workers (which poll) use.
const googleWorkspace = loadGoogleWorkspaceConfig(process.env);
const integrations = composeGoogleIntegrations({
  sql: database.sql,
  transactions: database.transactions,
  oauth: googleWorkspace.oauth,
  tokenEncryptionKey: googleWorkspace.tokenEncryptionKey,
  pushTopic: googleWorkspace.push?.topic,
});

// Inbound email (Postmark): each person's Q address, and the webhook that
// stores what arrives with its notice and outbox event in one transaction.
// Off, and saying so, unless both names are set.
const inboundEmailConfig = loadInboundEmailConfig(process.env);
const inboundEmail = createInboundEmailService({
  sql: database.sql,
  transactions: database.transactions,
  baseAddress: inboundEmailConfig.inbound?.address,
  outbox,
});

// Relationship chat (R34): parties through Network as the caller, shared
// documents through Evidence as the caller (their own, scanned clean).
const chat = composeChat({
  sql: database.sql,
  transactions: database.transactions,
  interests,
  ownDocument: async (actor, documentId) => {
    const parsed = DocumentIdSchema.safeParse(documentId);
    if (!parsed.success) return null;
    const { document, currentVersion } = await evidence.getDocumentWithVersion({
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
  // Opening a shared file: a one-minute signed read of the exact version,
  // straight from private storage. No storage credential, no downloads.
  downloads:
    storage === undefined
      ? undefined
      : createSharedDocumentDownloads({
          sql: database.sql,
          storage,
        }).authorizeSharedVersion,
  newCorrelationId: createCorrelationId,
  // QA run 8a1d57b9: each new message is announced (the other side is
  // told; a standing instruction wakes).
  outbox,
});

// Chat safety (R34; doc 10): block, unblock and report, each audited in
// its own transaction.
const chatSafety = composeChatSafety({
  sql: database.sql,
  transactions: database.transactions,
  interests,
  audit: createChatSafetyAudit(audit),
});

// Meetings, reminders and notifications (BIZ-008): the person's own
// calendar through the integrations context. Reminder email is the
// workers' job; the API sends none.
const schedule = composeSchedule({
  sql: database.sql,
  transactions: database.transactions,
  interests,
  calendars: (userId) => integrations.calendarOf(userId),
  calendarState: (userId) => integrations.calendarState(userId),
  email: unavailableAppEmailSender,
});

/**
 * Deal close (2026-10-08): terms, signature and close on the ONE
 * relationship, and the reports at every stage, through Network's own
 * appender, audit and outbox. Names come from the canonical query ports;
 * meetings from the schedule service, as the asking person sees them.
 */
const companyNames = createPostgresCompanyQueryPort({ sql: database.sql });
const investorNames = createPostgresInvestorOrganisationQueryPort({
  sql: database.sql,
});
const deal = createDealCloseService({
  sql: database.sql,
  transactions: database.transactions,
  interests,
  appender: createRelationshipEventAppender({
    registry: createRelationshipEventRegistry(RELATIONSHIP_EVENT_DEFINITIONS),
    repositories: {
      relationships: createPostgresRelationshipRepository(),
      events: createPostgresRelationshipEventRepository(),
    },
  }),
  outbox,
  audit,
  outcomes,
  names: async ({ companyId, investorOrganisationId }) => ({
    company:
      (
        await companyNames.findCanonicalCompany(
          CompanyIdSchema.parse(companyId),
        )
      )?.canonicalName ?? null,
    investor:
      (
        await investorNames.findCanonicalInvestorOrganisation(
          InvestorOrganisationIdSchema.parse(investorOrganisationId),
        )
      )?.displayName ?? null,
  }),
  meetings: async (actor, relationshipId) =>
    ((await schedule.listMeetings(actor, relationshipId)) ?? [])
      .filter(
        (meeting) =>
          meeting.status !== "CANCELLED" &&
          Date.parse(meeting.startsAt) <= Date.now(),
      )
      .map((meeting) => ({
        heldAt: meeting.startsAt,
        title: meeting.purpose,
        summary: null,
      })),
  newCorrelationId: () => CorrelationIdSchema.parse(createCorrelationId()),
});

// BILLING block (ADR 0034): plans and usage, the fee ledger, and Stripe
// when (and only when) the founder has configured both secrets.
const entitlements = createEntitlementService({ sql: database.sql });
const billingAccounts = createBillingAccounts({
  sql: database.sql,
  transactions: database.transactions,
  entitlements,
});
const stripeConfig = stripeConfigFromEnv(process.env);
const billingProvider =
  stripeConfig === null ? undefined : createStripeBillingProvider(stripeConfig);
const gatewayCounts = async (organisationId: string | undefined) => ({
  [FEATURE_GATEWAYS]:
    organisationId === undefined
      ? 0
      : ((await gateqGateways.countActiveForOrganisation?.(organisationId)) ??
        0),
});
const ORGANISATION_ADMIN = CapabilitySchema.parse("organisation.admin");
// end BILLING block

const { app, logger } = createApp(config, security, {
  // RECOVERY F4 (A-04): readiness answers 503 when the database is down.
  healthProbes: { database: () => checkDatabaseReadiness(database.sql) },
  organisations,
  companies,
  investors,
  discovery: {
    discovery,
    slates: slates.reader,
    interactions,
    // The feed's one batched pitch read per page (CQ-MEDIA-012), through
    // the Media context's port: discovery never touches media tables.
    pitches: discoverablePitches,
    // Discover v2: each card's sector and, only where disclosure lets this
    // reader view it, the raise (the same reads the profile and the raise
    // filter use). A raise is the founder's statement and says so; there
    // is no traction figure because nothing declared and network-visible
    // carries one, and unknown stays unknown.
    feedSummaries: async (actor, companyIds) => {
      const [raises, sectors, views] = await Promise.all([
        discoverFilterFacts.disclosedRaises === undefined
          ? new Map<string, { amount: string; currency: string }>()
          : discoverFilterFacts.disclosedRaises({ actor, companyIds }),
        companySectors.sectors === undefined
          ? new Map<string, readonly string[]>()
          : companySectors.sectors(companyIds),
        // R2: what the card says, from the same read the profile uses.
        companyRaise.raisesFor(actor, companyIds),
      ]);
      return new Map(
        companyIds.map((companyId) => {
          const raise = raises.get(companyId);
          return [
            companyId,
            {
              sectorNodeIds: [...(sectors.get(companyId) ?? [])].slice(0, 8),
              raise:
                raise === undefined
                  ? null
                  : {
                      money: { amount: raise.amount, currency: raise.currency },
                      truthClass: "USER_CLAIM" as const,
                      evidenceStatus: "SELF_REPORTED" as const,
                    },
              raiseView: views.get(companyId) ?? NO_RAISE_VIEW,
            },
          ] as const;
        }),
      );
    },
    // Founders' network videos (ADR 0021): the media read, then the same
    // disclosure-checked company read the network preview uses.
    networkPitches: createPostgresNetworkPitchQueryPort({ sql: database.sql }),
    explore,
    // ADR 0023: an investor's own photo and cover on founder-facing reads,
    // asked only for investors discovery already returned to the reader.
    investorImages: (investorOrganisationId) =>
      profileImages.cardImageUrls({
        subjectType: "INVESTOR_ORGANISATION",
        subjectId: investorOrganisationId,
      }),
    // "Your companies" (founder decision 2026-10-05): only the companies
    // the investor's organisation has established a connection with (the
    // Network context's list for their side). Interest, saves and passes
    // are not connections. Identities only; the route re-checks disclosure.
    yourCompanies: async (actor) =>
      connectedCompanies(
        await interests.listRelationshipsForInvestor({ actor }).catch(() => []),
      ),
    // The row lists only what the player will sign: the media service's
    // own playback rule, as a yes or no (live 2026-10-02).
    mayPlay: async (actor, companyId, mediaAssetId) => {
      const parsed = MediaAssetIdSchema.safeParse(mediaAssetId);
      return parsed.success
        ? media.mayPlayPitch({ actor, companyId, mediaAssetId: parsed.data })
        : false;
    },
    networkCompany: async (actor, companyId) => {
      const parsed = CompanyIdSchema.safeParse(companyId);
      if (!parsed.success) return null;
      const company = await companyNetworkView.findNetworkVisible(
        actor,
        parsed.data,
      );
      return company === null
        ? null
        : {
            canonicalName: company.canonicalName,
            shortDescription: company.shortDescription,
            headquartersCountry: company.headquartersCountry,
            currentStageCode: company.currentStageCode,
            companyStatus: company.companyStatus,
          };
    },
  },
  // The same port answers the founder's own view and network preview, so
  // "what investors will see" is what the feed shows.
  companyPitches: discoverablePitches,
  companyNetworkView,
  // A company's profile from Discover (founder request 2026-10-02): each
  // part through the rule that already governs it (http/company-profile).
  companyProfile: {
    viewerIsInvestor: async (actor) =>
      (await slates.eligibilityPorts.investorSubject.investorOrganisationFor(
        actor,
      )) !== null,
    mayPlay: async (actor, companyId, mediaAssetId) => {
      const parsed = MediaAssetIdSchema.safeParse(mediaAssetId);
      return parsed.success
        ? media.mayPlayPitch({ actor, companyId, mediaAssetId: parsed.data })
        : false;
    },
    // The route already decided this reader may see the company, and so
    // its name: the logo has the name's scope (founder decision
    // 2026-10-04), with or without a Q Card.
    photo: async (company) => {
      const subject = {
        subjectType: "COMPANY",
        subjectId: company.id,
      } as const;
      return (
        (await namedPhotos.photos([subject])).get(namedImageKey(subject)) ??
        null
      );
    },
    // The header's logo (the name's scope) and cover (the card's own
    // `cover` scope for a signed-in participant).
    images: async (company) => {
      const subject = {
        subjectType: "COMPANY",
        subjectId: company.id,
      } as const;
      return (
        (await namedPhotos.images([subject], "PARTICIPANT")).get(
          namedImageKey(subject),
        ) ?? { photo: null, cover: null }
      );
    },
    // 2026-10-08: what the pitches say, read from each transcript under
    // the same playback rule as the player (the transcript is part of the
    // pitch), and the raise's sharing for the disclosure precedence.
    pitchCues: async (actor, companyId, mediaAssetId) => {
      const parsed = MediaAssetIdSchema.safeParse(mediaAssetId);
      if (!parsed.success) return null;
      const view = await media.getPitchTranscript({
        actor,
        companyId,
        mediaAssetId: parsed.data,
      });
      return view.status === "AVAILABLE" ? view.cues : null;
    },
    raiseSharing: createRaiseSharing({
      sql: database.sql,
      companies: disclosurePorts.companies,
      capital: disclosurePorts.capital,
      policies: createPostgresDisclosurePolicyRepository(),
    }),
    // R2: the same raise read the Discover card renders.
    raiseView: (actor, companyId) => companyRaise.raiseFor(actor, companyId),
    disclosedRaise: async (actor, companyId) =>
      (
        await discoverFilterFacts.disclosedRaises?.({
          actor,
          companyIds: [companyId],
        })
      )?.get(companyId) ?? null,
    organisationVerified: async (companyId) =>
      (await discoverFilterFacts.verified?.([companyId]))?.has(companyId) ===
      true,
    sectorNodeIds: async (companyId) =>
      (await companySectors.sectors?.([companyId]))?.get(companyId) ?? [],
    // A deck reaches another organisation one way today: the company sends
    // it in the relationship chat (R34). The reader must be a party to
    // that thread (the chat decides), the message must be the company's
    // and not unsent, and Evidence must classify it as a pitch deck.
    sharedDeck: async (actor, company) => {
      if (storage === undefined) return null;
      const relationship = (
        await interests.listRelationshipsForInvestor({ actor })
      ).find((listing) => listing.relationship.companyId === company.id);
      if (relationship === undefined) return null;
      const thread = await chat.thread({
        actor,
        relationshipId: relationship.relationship.id,
        limit: 100,
      });
      const shared = createSharedDocumentDownloads({
        sql: database.sql,
        storage,
      });
      const candidates = thread.messages
        .filter(
          (message) =>
            message.side === "COMPANY" &&
            message.kind === "ATTACHMENT" &&
            !message.unsent &&
            message.attachment !== null,
        )
        .reverse();
      for (const message of candidates) {
        if (message.attachment === null) continue;
        const type = await shared.sharedDocumentType({
          documentTenantId: company.tenantId,
          documentId: message.attachment.documentId,
        });
        if (type === "PITCH_DECK") {
          return {
            relationshipId: thread.relationshipId,
            messageId: message.messageId,
            title: message.attachment.title,
            sharedAt: message.sentAt,
          };
        }
      }
      return null;
    },
    // ADR 0041: the deck's own audience and the team, for an investor the
    // pitch rule admits: the same function media uses, never a looser one.
    investorMayFind: async (actor, companyId) =>
      (await resolveViewableCompany(actor, companyId)) !== null,
    audienceDeck: async (company) => {
      if (storage === undefined) return null;
      const deck = await createSharedDocumentDownloads({
        sql: database.sql,
        storage,
        serveUnscanned,
      }).investorAudienceDeck({
        companyTenantId: company.tenantId,
        companyId: company.id,
      });
      return deck === null
        ? null
        : {
            documentId: deck.documentId,
            documentVersionId: deck.documentVersionId,
            title: deck.title,
            sharedAt: deck.updatedAt,
            scanned: deck.scanned,
          };
    },
    downloadAudienceDeck: async (company, deck) => {
      if (storage === undefined) throw new DocumentNotFoundError();
      const link = await createSharedDocumentDownloads({
        sql: database.sql,
        storage,
        serveUnscanned,
      }).authorizeSharedVersion({
        documentTenantId: company.tenantId,
        documentId: deck.documentId,
        documentVersionId: deck.documentVersionId,
        disposition: "ATTACHMENT",
      });
      return {
        url: link.url,
        expiresAt: link.expiresAt,
        scanned: link.scanned,
      };
    },
    team: (company) =>
      companyTeamProjection.teamForNetwork({
        tenantId: company.tenantId,
        companyId: company.id,
      }),
    downloadDeck: async (actor, deck) => {
      const link = await chat.attachment({
        actor,
        relationshipId: deck.relationshipId,
        messageId: deck.messageId,
      });
      return { url: link.url, expiresAt: link.expiresAt };
    },
  },
  // The readiness view's discoverability note: a declared sector, read as
  // Discover's own filter facts read it.
  companySectorDeclared: async (companyId) =>
    ((await companySectors.sectors?.([companyId]))?.get(companyId) ?? [])
      .length > 0,
  // An investor watches every publishable video of a company discoverable
  // to them; anyone else only the videos opened to the network (ADR 0021).
  watchesAsInvestor: async (actor) =>
    (await slates.eligibilityPorts.investorSubject.investorOrganisationFor(
      actor,
    )) !== null,
  interests,
  connections,
  commitments,
  capitalRounds,
  outcomes,
  deal,
  diligence,
  // Overnight A3-A7: data room, pitch deck, founder pages.
  dataRoom: profileMaterial.dataRoom,
  companyDeck: profileMaterial.companyDeck,
  founderPerson: profileMaterial.founderPerson,
  founderRequests: profileMaterial.founderRequests,
  // BILLING block (ADR 0034)
  billing: {
    entitlements,
    accounts: billingAccounts,
    provider: billingProvider,
    applyWebhook:
      billingProvider === undefined
        ? undefined
        : createWebhookApplier({ transactions: database.transactions }),
    canManage: async (actor) => {
      if (actor.organisationId === undefined) return false;
      const decision = await authorization.authorize({
        actor,
        capability: ORGANISATION_ADMIN,
        resource: {
          kind: "ORGANISATION",
          tenantId: actor.tenantId,
          organisationId: actor.organisationId,
        },
      });
      return decision.outcome === "ALLOW";
    },
    counts: (actor) => gatewayCounts(actor.organisationId),
    webOrigin:
      process.env["CQ_WEB_ORIGIN"] ??
      "https://capital-qweb-production.up.railway.app",
  },
  adminBilling: {
    accounts: billingAccounts,
    fees: createFeeLedger({
      sql: database.sql,
      transactions: database.transactions,
    }),
    countsFor: (organisationId) => gatewayCounts(organisationId),
    usage: () => adminUsage(new Date()),
  },
  // end BILLING block
  // ADMIN block (ADR 0033)
  admin: platformAdmin,
  // G1/G2: teams.
  team,
  // ADR 0050: business etiquette guides (a person's own; the console's).
  etiquette: (() => {
    const adminStore = createEtiquetteGuideAdminStore({
      sql: database.sql,
      transactions: database.transactions,
    });
    return {
      adminStore,
      guides: {
        ...createPostgresEtiquetteGuideStore({
          sql: database.sql,
          transactions: database.transactions,
        }),
        house: async () => houseEtiquetteOf(await adminStore.active()),
      },
    };
  })(),
  // P5: brand colour
  brand: createBrandThemeStore({
    sql: database.sql,
    transactions: database.transactions,
  }),
  results,
  readiness,
  adminFreshTokens: createSupabaseAccessTokenAuthenticator(supabaseAuth),
  adminVerificationDecider: createDecideByOperator({
    transactions: database.transactions,
    repository: createPostgresVerificationClaimRepository(),
    outbox,
    audit,
  }),
  // end ADMIN block
  // ADMIN-3 block: manual KYB and the console's side of it.
  kyb: createKybService({
    sql: database.sql,
    transactions: database.transactions,
    authorization,
    repository: createPostgresVerificationClaimRepository(),
    audit,
    outbox,
  }),
  adminCloseKyb: (input) => closeKybForClaim(database.transactions, input),
  adminKybDownload:
    storage === undefined
      ? undefined
      : async (document) => {
          const link = await createSharedDocumentDownloads({
            sql: database.sql,
            storage,
          }).authorizeSharedVersion({
            documentTenantId: document.tenantId,
            documentId: document.documentId,
            documentVersionId: document.versionId,
            disposition: "ATTACHMENT",
          });
          return { url: link.url, expiresAt: link.expiresAt };
        },
  // end ADMIN-3 block
  chat,
  chatSafety,
  schedule,
  // AUTO block (ADR 0030): Web Push; the key is public, the private half
  // stays with the workers that send.
  push: {
    subscriptions: createPushSubscriptionStore(database.sql),
    publicKey: loadWebPushConfig(process.env).publicKey ?? null,
  },
  gateq,
  // The public gateway page's header (founder ask 2026-10-04): the owning
  // organisation's photo and cover exactly as its Q Card shows them to
  // the public. Only a published, active gateway reaches here.
  gateqPublicImages: async (publicId) => {
    const gateway = await gateqGateways.findByPublicId(publicId);
    if (gateway === null) return { photo: null, cover: null };
    return publicIdentity.cardImagesFor({
      subject: {
        subjectType: "INVESTOR_ORGANISATION",
        subjectId: gateway.investorOrganisationId,
      },
      audience: "PUBLIC",
    });
  },
  gateqApply,
  gateqInbox: createPostgresSubmissionInbox({ sql: database.sql }),
  // F3: "Find my startup": claim requests and saved startup searches.
  // P14 item 7: a platform admin makes an unclaimed company's profile
  // public (or returns it to the network); the console authorises.
  adminPublishCompany: createPlatformCompanyPublishing({
    transactions: database.transactions,
    outbox,
    audit,
  }),
  companyClaims: createCompanyClaims({
    sql: database.sql,
    // 2026-10-08: a registry-document claim's file goes straight from the
    // browser to private storage under a server-chosen key; the operator
    // reads it through a two-minute signed URL. No storage, no evidence.
    evidenceStorage:
      storage === undefined
        ? undefined
        : {
            authorizeUpload: ({ key, contentType, maxBytes }) =>
              storage.createUploadAuthorization({
                object: { bucket: DOCUMENT_STORAGE_BUCKET, key },
                contentType,
                maxBytes,
              }),
            stat: (key) =>
              storage.statObject({ bucket: DOCUMENT_STORAGE_BUCKET, key }),
            authorizeDownload: ({ key, fileName }) =>
              storage.createDownloadAuthorization({
                object: { bucket: DOCUMENT_STORAGE_BUCKET, key },
                expiresInSeconds: 120,
                downloadFilename: fileName,
              }),
          },
    // P14: an approved claim admits the requester through the team's own
    // command (membership, roles, active context, audit, event).
    admit: (input) =>
      team.admitClaim({
        ...input,
        correlationId: CorrelationIdSchema.parse(`cor_${crypto.randomUUID()}`),
      }),
    // P14: the one-time code to the work email, through the app sender,
    // outcome logged with the domain only.
    codeMailer: async ({ to, companyName, code, expiresInMinutes }) => {
      const rendered = renderClaimCodeEmail({
        companyName,
        code,
        expiresInMinutes,
      });
      return sendGateqEmailLogged(
        gateqFounderMail,
        logGateqEmail,
        "CLAIM_CODE",
        to,
        {
          subject: rendered.subject,
          text: rendered.text,
          html: rendered.html,
          fromName: "Capital Q",
        },
      );
    },
  }),
  startupAlerts: createStartupAlerts({ sql: database.sql }),
  // F4: the investor's GateQ inbox. Reads here; writes are declared actions.
  gateqInboxService: gateqInboxService,
  gateqInboxActions: gateqInboxActionsPort(
    gateqInboxService,
    ownGatewayIdFrom({
      gateq,
      ownInvestorOrganisationId: async (actor) =>
        (
          await slates.eligibilityPorts.investorSubject.investorOrganisationFor(
            actor,
          )
        )?.investorOrganisationId ?? null,
    }),
  ),
  gateqPublicReplyPromise: async (publicId) => {
    const gateway = await gateqGateways.findByPublicId(publicId);
    return gateway === null
      ? null
      : createPostgresInboxRepository({ sql: database.sql }).replyWithinDays(
          gateway.id,
        );
  },
  // F1: a signed-in founder's own documents, shared with their application.
  gateqMaterials:
    gateqApply === undefined
      ? undefined
      : createApplicationMaterials({
          authoriseGuest: (token) => gateqApply.intake.authorise(token),
          ownDocument: (actor, documentId) => {
            const id = DocumentIdSchema.safeParse(documentId);
            return id.success
              ? evidence
                  .getDocument({ actor, documentId: id.data })
                  .then(() => true)
                  .catch(() => false)
              : Promise.resolve(false);
          },
          attach: (input) => gateqApply.intake.attachDocument(input),
          link: async ({ token, actor }) => {
            const guest = await gateqApply.intake.authorise(token);
            await joinGateqRelationship({
              applicationId: guest.application.id,
              tenantId: guest.application.tenantId,
              actor,
            });
          },
          onLinkFailed: (error) => {
            gateqLogger.warn(
              { err: error },
              "gateq application relationship link failed; repaired on next read",
            );
          },
        }),
  // F27: the founder's own unlinked applications are repaired on read.
  gateqMyApplications: async (actor) => {
    for (const row of await gateqFounders.unlinkedFor(actor)) {
      await joinGateqRelationship({ ...row, actor }).catch((error: unknown) =>
        gateqLogger.warn(
          { err: error },
          "gateq application relationship repair failed",
        ),
      );
    }
    return gateqFounders.listFor(actor);
  },
  // Q.05 (2026-10-07): published gates checked for the founder's OWN
  // company, resolved here from their organisation (never the client).
  gateqInvestorGates: async (actor, investorOrganisationIds) => {
    if (actor.organisationId === undefined) return [];
    const company = await companyQuery.findOrganisationCompany?.(
      actor.tenantId,
      actor.organisationId,
    );
    if (company == null) return [];
    return createInvestorGateFits({
      policies: createPostgresGatewayPolicyPort({ sql: database.sql }),
      companies: gateqCompanyProjection,
    }).forOwnCompany({
      tenantId: actor.tenantId,
      companyId: company.id,
      investorOrganisationIds,
    });
  },
  gateqPolicyExtraction: (() => {
    const service = createPolicyExtractionService({
      gateq,
      repository: createPostgresPolicyExtractionRepository({
        sql: database.sql,
      }),
      vocabulary: mandateVocabularyFrom(),
      // J7: wanted or ruled out, read by meaning; none: nothing proposed
      // from a mention whose meaning could not be read.
      ...(wordsReaders === undefined
        ? {}
        : {
            polarity: (who, mentions) =>
              wordsReaders.preferencePolarity(who, mentions),
          }),
    });
    return {
      extract: (command) =>
        service
          .extract({
            ...command,
            gatewayId: GatewayIdSchema.parse(command.gatewayId),
          })
          .then((out) => PolicyExtractionDtoSchema.parse(out)),
    };
  })(),
  capital,
  taxonomy: {
    query: taxonomy.query,
    candidates: taxonomy.classification.candidates,
  },
  onboarding: onboarding.runtime,
  // Setup reminders over the person's own sessions (founder directive
  // 2026-09-27): the versioned policy decides, the table remembers.
  onboardingNudges: createOnboardingNudges({ sql: database.sql }),
  evidence,
  // P3: the owner's own file from the documents page. The route has
  // already authorised the owner; Evidence checks the object (active, the
  // version belongs, scan state under ADR 0042) and signs a 60 s read.
  ...(diligenceDocuments === undefined
    ? {}
    : {
        documentFileLink: async (file: {
          readonly tenantId: string;
          readonly documentId: string;
          readonly versionId: string;
        }) => {
          const link = await diligenceDocuments.authorizeSharedVersion({
            documentTenantId: file.tenantId,
            documentId: file.documentId,
            documentVersionId: file.versionId,
            disposition: "ATTACHMENT",
          });
          return {
            url: link.url,
            expiresAt: link.expiresAt,
            scanned: link.scanned,
          };
        },
      }),
  media,
  verification,
  visibility,
  publicIdentity,
  profileImages,
  namedPhotos,
  // WORK-58: the Work page's own writes (pause, resume, Not now).
  // Scoped delegation: the switch writes its audit in the same transaction.
  qWork: createQWorkPagePort(database.sql, {
    transactions: database.transactions,
    audit,
  }),
  // Recovery D6: "Stop this job" (the same rule q-api applies for Q).
  workforceJobs: createWorkforceJobPort(database.transactions),
  inboundEmail: {
    inboundEmail,
    webhookSecret: inboundEmailConfig.inbound?.webhookSecret.reveal(),
  },
  integrations: {
    integrations,
    webOrigin: googleWorkspace.webOrigin,
    push:
      googleWorkspace.push === undefined
        ? undefined
        : {
            audience: googleWorkspace.push.audience,
            serviceAccountEmail: googleWorkspace.push.serviceAccountEmail,
            keys: createGoogleKeySource(platformGoogleHttp),
          },
  },
});

if (googleWorkspace.oauth === undefined) {
  // Names only. Outside local a missing web origin or redirect URI is one
  // of them, and the integration stays off rather than sending a person
  // to a laptop address after Google consent.
  logger.warn(
    { missing: googleWorkspace.missing },
    "Google workspace integration disabled: configuration missing",
  );
}

if (inboundEmailConfig.inbound === undefined) {
  logger.warn(
    { missing: inboundEmailConfig.missing },
    "inbound email disabled: configuration missing",
  );
}

// Every pitch gets captions (R18). A short timer asks the provider for
// captions on any READY pitch that has none and stores them once they are
// generated, so a pitch published now has captions minutes later and the
// pitches published before this existed catch up on their own. One pass
// at a time, bounded, sequential; a pass that finds nothing makes no
// provider call. Stream's generated captions carry no extra charge.
const CAPTION_SWEEP_INTERVAL_MS = 90_000;
const CAPTION_SWEEP_LIMIT = 25;
let captionSweepRunning = false;
const runCaptionSweep = async () => {
  if (captionSweepRunning || !media.provider.capabilities.captions) return;
  captionSweepRunning = true;
  try {
    const result = await media.sweepPitchCaptions({
      limit: CAPTION_SWEEP_LIMIT,
    });
    if (result.examined > 0) {
      logger.info(
        {
          examined: result.examined,
          outcomes: result.outcomes,
          errors: result.errors,
        },
        "pitch caption sweep",
      );
    }
  } catch (error) {
    logger.warn({ err: error }, "pitch caption sweep did not complete");
  } finally {
    captionSweepRunning = false;
  }
};
const captionSweepFirst = setTimeout(() => {
  void runCaptionSweep();
}, 15_000);
const captionSweepTimer = setInterval(() => {
  void runCaptionSweep();
}, CAPTION_SWEEP_INTERVAL_MS);
captionSweepFirst.unref();
captionSweepTimer.unref();

app.addHook("onClose", async () => {
  clearTimeout(captionSweepFirst);
  clearInterval(captionSweepTimer);
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
