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
import {
  createFounderOnboardingIntegration,
  FOUNDER_INTERVIEW_CUES,
  FOUNDER_UTTERANCE_ALIASES,
} from "@capital-q/founder-onboarding";
import {
  createInvestorOnboardingIntegration,
  INVESTOR_INTERVIEW_CUES,
  INVESTOR_UTTERANCE_ALIASES,
} from "@capital-q/investor-onboarding";
import {
  createDiscoveryService,
  createPostgresDiscoveryRepository,
  createPostgresRefreshQueue,
  createInteractionSignalService,
  createPostgresInteractionRepository,
  createSlateReadPipeline,
} from "@capital-q/discovery";
import {
  createCapitalService,
  createPostgresCapitalObjectiveQueryPort,
} from "@capital-q/capital";
import {
  createCompanyService,
  createPostgresCompanyMarketplaceQueryPort,
  createPostgresCompanyQueryPort,
} from "@capital-q/companies";
import {
  createInvestorService,
  createPostgresInvestorMandateQueryPort,
  createPostgresInvestorOrganisationQueryPort,
} from "@capital-q/investors";
import {
  createPostgresRelationshipEventRepository,
  createPostgresRelationshipRepository,
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
  createOrganisationService,
  createPostgresOrganisationQueryPort,
} from "@capital-q/organisations";
import {
  createGateQService,
  createPostgresGatewayPolicyPort,
  createPostgresGatewayRepository,
  createPostgresGatewayVersionRepository,
} from "@capital-q/gateq";

import {
  createGateQCompanyProjectionPort,
  createGateQOrganisationDisplayPort,
} from "./gateq/company-projection.js";
import { createAuthorizationService } from "@capital-q/security";
import {
  createCompanyOnboardingSubjectResolver,
  createInvestorOrganisationOnboardingSubjectResolver,
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
} from "@capital-q/evidence";
import {
  createCompanyMediaOwnerResolver,
  createMediaOwnerResolverRegistry,
  createMediaService,
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

// GateQ (CQ-GATE-001): the investor organisation's inbound gateway. It owns
// gateways, versions and criteria and nothing else -- the company
// projection it qualifies against is assembled here, from the owning
// contexts' own query ports, and carries three declared facts and one
// declared raise. No document, no conversation, no Q inference reaches it.
const gateq = createGateQService({
  gateways: createPostgresGatewayRepository({ sql: database.sql }),
  versions: createPostgresGatewayVersionRepository({ sql: database.sql }),
  policies: createPostgresGatewayPolicyPort({ sql: database.sql }),
  companies: createGateQCompanyProjectionPort({
    sql: database.sql,
    companies: createPostgresCompanyMarketplaceQueryPort({
      sql: database.sql,
    }),
    assignments: createPostgresTaxonomyAssignmentRepository(),
    reference: createPostgresTaxonomyReferenceRepository(),
    capital: createPostgresCapitalObjectiveQueryPort({ sql: database.sql }),
  }),
  organisations: createGateQOrganisationDisplayPort({
    investors: createPostgresInvestorOrganisationQueryPort({
      sql: database.sql,
    }),
  }),
  authorization,
  transactions: database.transactions,
  audit,
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
  // Plain-language names for options in the conversational interview
  // (CQ-PRE-REC-001 §19). Recognition only; each journey definition still
  // validates the answer it produces.
  utteranceAliases: {
    ...FOUNDER_UTTERANCE_ALIASES,
    ...INVESTOR_UTTERANCE_ALIASES,
  },
  // Where each journey's figures and exclusions live in a sentence, and
  // Capital Q's own taxonomy classifier for category phrases
  // (CQ-Q-VOICE-001 A): one sentence may answer many questions, each
  // proposal validated by the definition and confirmed by the person.
  interviewCues: { ...FOUNDER_INTERVIEW_CUES, ...INVESTOR_INTERVIEW_CUES },
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

// Pitch media. No provider is configured or needed: this composes the
// record-keeping domain only, and holds no video credential of any kind.
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
const slates = createSlateReadPipeline({
  sql: database.sql,
  disclosure: createDisclosureAccessService({
    sql: database.sql,
    policies: createPostgresDisclosurePolicyRepository(),
    resolvers: createDisclosureResourceResolverRegistry(
      createDefaultDisclosureResolvers(disclosurePorts),
    ),
    relationshipParties: createRelationshipPartyResolver(disclosurePorts),
    clock: systemDisclosureClock,
  }),
  queue: createPostgresRefreshQueue({ sql: database.sql }),
});

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

const { app, logger } = createApp(config, security, {
  organisations,
  companies,
  investors,
  discovery: { discovery, slates: slates.reader, interactions },
  gateq,
  capital,
  taxonomy: {
    query: taxonomy.query,
    candidates: taxonomy.classification.candidates,
  },
  onboarding: onboarding.runtime,
  evidence,
  media,
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
