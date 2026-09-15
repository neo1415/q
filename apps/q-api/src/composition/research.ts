import {
  createPostgresMaterialActionAuditWriter,
  createPostgresSecurityEventWriter,
} from "@capital-q/audit";
import { createPostgresCompanyQueryPort } from "@capital-q/companies";
import type { ResearchProviderSecrets } from "@capital-q/config/research-providers";
import { createEventRegistry } from "@capital-q/contracts";
import type { DatabaseExecutor, TransactionManager } from "@capital-q/database";
import { createOutboxWriter } from "@capital-q/eventing";
import {
  createCompanyEvidenceSubjectResolver,
  createEvidenceService,
  createEvidenceSubjectResolverRegistry,
  createPostgresEvidenceRepositories,
  EVIDENCE_EVENTS,
  EvidenceSourceIdSchema,
  type EvidenceService,
} from "@capital-q/evidence";
import type { QUserStatementRecorder } from "@capital-q/model-gateway/q";
import type { Logger } from "@capital-q/observability";
import {
  createConversationStatementRecorder,
  createKnowledgeWriteGate,
  createPostgresContradictionRepository,
  createPostgresKnowledgeRepository,
  type StatementEvidencePort,
} from "@capital-q/q-knowledge";
import {
  createPublicWebResearchService,
  type PublicWebResearchProvider,
  type PublicProfileLookupProvider,
  type PublicWebResearchService,
  type ResearchEvidenceRecorder,
} from "@capital-q/q-research";
import {
  createBrightDataProfileLookup,
  createBrightDataResearchProvider,
} from "@capital-q/q-research/providers/brightdata";
import { createTavilyResearchProvider } from "@capital-q/q-research/providers/tavily";
import type { AuthorizationService } from "@capital-q/security";

/**
 * Controlled public-web research and conversational clarification, composed
 * (CQ-Q-RESEARCH-001).
 *
 * The research provider exists only when its key is configured; the key is
 * revealed here once and handed to the adapter. Sources a founder's Q reads
 * about their own company are recorded through the Evidence service — the
 * same use cases the API uses, with the actor's own capability — and a
 * person's statement about their own company goes through the Knowledge
 * Write Gate. Nothing here writes canonical company or investor state.
 */

export type ResearchComposition = {
  /** Absent when no provider is configured: the research tools do not exist. */
  readonly research: PublicWebResearchService | undefined;
  /** Public LinkedIn pages by URL; absent without a Bright Data key. */
  readonly profiles: PublicProfileLookupProvider | undefined;
  readonly statements: QUserStatementRecorder;
  readonly providerStatus: "configured" | "unconfigured";
};

export type ResearchCompositionDependencies = {
  readonly sql: DatabaseExecutor;
  readonly transactions: TransactionManager;
  readonly authorization: AuthorizationService;
  readonly secrets: ResearchProviderSecrets;
  readonly logger?: Logger | undefined;
  /** Test seam: a provider instead of the configured vendor. */
  readonly provider?: PublicWebResearchProvider | undefined;
};

const COMPANY = "COMPANY" as const;

/** The Evidence owner, as the research capability needs it (§13-§15). */
export function createResearchEvidenceRecorder(
  evidence: EvidenceService,
): ResearchEvidenceRecorder {
  return {
    listSources: async (actor, companyId) => {
      const sources = await evidence.listEvidenceSources({
        actor,
        subject: { subjectType: COMPANY, subjectId: companyId },
      });
      return sources
        .filter((source) => source.sourceType === "PUBLIC_WEB")
        .map((source) => ({ id: source.id, sourceUrl: source.sourceUrl }));
    },
    registerSource: async (actor, input, correlationId) => {
      const source = await evidence.registerEvidenceSource({
        actor,
        correlationId,
        input: {
          sourceType: "PUBLIC_WEB",
          subject: { subjectType: COMPANY, subjectId: input.companyId },
          provider: input.provider,
          ...(input.title === null ? {} : { title: input.title.slice(0, 200) }),
          sourceUrl: input.sourceUrl,
          retrievedAt: input.retrievedAt,
          ...(input.publishedAt === null ||
          Number.isNaN(Date.parse(input.publishedAt))
            ? {}
            : { publishedAt: new Date(input.publishedAt).toISOString() }),
          // A page's own account of a company is secondary external material;
          // credibility is never inferred from the fact that it is online.
          reliabilityClass: "SECONDARY_EXTERNAL",
          // The page is public; the fact that this organisation read it is
          // organisation-private (§14). The source itself is not confidential.
          visibilityScope: "organisation_private",
          sensitivityClass: "INTERNAL",
          metadata: input.metadata,
        },
      });
      return { id: source.id };
    },
    listItems: async (actor, sourceId) => {
      const parsed = EvidenceSourceIdSchema.parse(sourceId);
      const source = await evidence.getEvidenceSource({
        actor,
        sourceId: parsed,
      });
      const items = await evidence.listEvidenceItems({
        actor,
        subject: { subjectType: COMPANY, subjectId: source.subjectId },
      });
      return items
        .filter((item) => item.sourceId === parsed)
        .map((item) => ({
          id: item.id,
          structuredValue: item.structuredValue,
        }));
    },
    createItem: async (actor, input, correlationId) => {
      const item = await evidence.createEvidenceItem({
        actor,
        correlationId,
        input: {
          sourceId: EvidenceSourceIdSchema.parse(input.sourceId),
          evidenceType: "public_web.excerpt",
          summary: input.summary,
          structuredValue: input.structuredValue,
          locator: { kind: "statement" },
          // What the page says; nothing has verified it.
          evidenceStatus: "SELF_REPORTED",
        },
      });
      return { id: item.id };
    },
  };
}

/** The Evidence owner, as the statement recorder needs it (§21). */
export function createStatementEvidencePort(
  evidence: EvidenceService,
): StatementEvidencePort {
  return {
    registerStatementSource: async (actor, input, correlationId) => {
      const source = await evidence.registerEvidenceSource({
        actor,
        correlationId,
        input: {
          sourceType: "USER_STATEMENT",
          subject: { subjectType: COMPANY, subjectId: input.companyId },
          title: input.title,
          externalReference: input.externalReference,
          reliabilityClass: "USER_STATEMENT",
          visibilityScope: "founder_private",
          sensitivityClass: "CONFIDENTIAL",
        },
      });
      return { id: source.id };
    },
    createStatementItem: async (actor, input, correlationId) => {
      const item = await evidence.createEvidenceItem({
        actor,
        correlationId,
        input: {
          sourceId: EvidenceSourceIdSchema.parse(input.sourceId),
          evidenceType: input.evidenceType,
          summary: input.summary,
          locator: { kind: "statement" },
          evidenceStatus: "SELF_REPORTED",
          ...(input.validFrom === null ? {} : { validFrom: input.validFrom }),
        },
      });
      return { id: item.id };
    },
  };
}

export function composeResearch(
  dependencies: ResearchCompositionDependencies,
): ResearchComposition {
  const { sql, transactions, authorization, logger } = dependencies;
  const repositories = createPostgresEvidenceRepositories();
  const evidence = createEvidenceService({
    sql,
    transactions,
    authorization,
    subjects: createEvidenceSubjectResolverRegistry([
      createCompanyEvidenceSubjectResolver(
        createPostgresCompanyQueryPort({ sql }),
      ),
    ]),
    outbox: createOutboxWriter({
      registry: createEventRegistry(EVIDENCE_EVENTS),
    }),
    audit: createPostgresMaterialActionAuditWriter(),
    repositories,
    securityEvents: createPostgresSecurityEventWriter({ sql }),
  });

  // Search and extraction: Bright Data when its zones are named (a Google
  // index and an unlocker), else Tavily. Profiles: Bright Data's LinkedIn
  // datasets need only the key.
  const brightData = dependencies.secrets.brightData;
  const provider =
    dependencies.provider ??
    (brightData !== undefined &&
    brightData.serpZone !== undefined &&
    brightData.unlockerZone !== undefined
      ? createBrightDataResearchProvider({
          apiKey: brightData.apiKey.reveal(),
          serpZone: brightData.serpZone,
          unlockerZone: brightData.unlockerZone,
        })
      : dependencies.secrets.tavily === undefined
        ? undefined
        : createTavilyResearchProvider({
            apiKey: dependencies.secrets.tavily.reveal(),
          }));
  const profiles =
    brightData === undefined
      ? undefined
      : createBrightDataProfileLookup({ apiKey: brightData.apiKey.reveal() });
  const research =
    provider === undefined
      ? undefined
      : createPublicWebResearchService({
          provider,
          evidence: createResearchEvidenceRecorder(evidence),
          ...(logger === undefined ? {} : { logger }),
        });

  const gate = createKnowledgeWriteGate({
    sql,
    transactions,
    knowledge: createPostgresKnowledgeRepository(),
    contradictions: createPostgresContradictionRepository(),
    evidence: repositories,
    ...(logger === undefined ? {} : { logger }),
  });
  const recorder = createConversationStatementRecorder({
    evidence: createStatementEvidencePort(evidence),
    gate,
    ...(logger === undefined ? {} : { logger }),
  });
  const statements: QUserStatementRecorder = {
    record: async (command) => {
      const outcome = await recorder.record(command);
      return { recorded: outcome.recorded };
    },
  };

  return {
    research,
    profiles,
    statements,
    providerStatus: provider === undefined ? "unconfigured" : "configured",
  };
}
