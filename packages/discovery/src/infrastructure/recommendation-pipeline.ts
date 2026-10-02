import { createPostgresCompanyMarketplaceQueryPort } from "@capital-q/companies";
import type { DatabaseExecutor, TransactionManager } from "@capital-q/database";
import {
  createPostgresInvestorMandateQueryPort,
  createPostgresInvestorMandateRepository,
  createPostgresInvestorOrganisationRepository,
} from "@capital-q/investors";
import {
  createPostgresPassStandingReader,
  createPostgresRelationshipEventRepository,
  createPostgresRelationshipRepository,
  type RelationshipQueryPort,
} from "@capital-q/network";
import type { Logger } from "@capital-q/observability";
import type { DisclosureAccessService } from "@capital-q/permissions";
import {
  createPostgresTaxonomyAssignmentRepository,
  createPostgresTaxonomyReferenceRepository,
  createTaxonomyQueryPort,
  normalizeTaxonomyAlias,
} from "@capital-q/taxonomy";

import {
  createStructuredCandidateService,
  type StructuredCandidateService,
} from "../candidates/service.js";
import type {
  EligibilityPorts,
  MaterialChangePort,
} from "../eligibility/ports.js";
import {
  createEligibilityService,
  type EligibilityService,
} from "../eligibility/service.js";
import { createFeatureRegistry } from "../features/policy.js";
import type { FeatureSnapshotStore } from "../features/ports.js";
import {
  createFeatureService,
  type FeatureService,
} from "../features/service.js";
import {
  createHybridCandidateService,
  type HybridCandidateService,
} from "../hybrid/service.js";
import { RANKING_CONFIG_CURRENT } from "../ranking/config.js";
import { createDeterministicRanker } from "../ranking/ranker.js";
import {
  createRankingService,
  type RankingService,
} from "../ranking/service.js";
import { createReranker } from "../rerank/reranker.js";
import { createRerankService, type RerankService } from "../rerank/service.js";
import {
  createProactiveSuppression,
  type ProactiveSuppressionPort,
} from "../rerank/suppression.js";
import {
  createPitchReintroductions,
  type PublishablePitchTimesPort,
} from "../rerank/pitch-reintroductions.js";
import type { SemanticEmbedder } from "../semantic/ports.js";
import {
  createSemanticCandidateService,
  type SemanticCandidateService,
} from "../semantic/service.js";
import { createSlateBuilder, type SlateBuilder } from "../slates/builder.js";
import type { SlatePolicy } from "../slates/contracts.js";
import type { RefreshRequestStore, SlateRepository } from "../slates/ports.js";
import {
  createSlateReadService,
  type SlateReadServiceDependencies,
  type SlateReadService,
} from "../slates/reader.js";
import {
  createRefreshRequester,
  type RefreshQueue,
  type RefreshRequester,
} from "../slates/refresh.js";
import { createDomainCandidatePorts } from "./domain-port-candidate-sources.js";
import { createDomainEligibilityPorts } from "./domain-port-eligibility-sources.js";
import { createDomainFeaturePorts } from "./domain-port-feature-sources.js";
import { createDomainSemanticPorts } from "./domain-port-semantic-sources.js";
import {
  createPostgresCompanyCardPort,
  createPostgresDiscoverablePoolPort,
} from "./postgres-discovery-repository.js";
import type { DiscoverFilterFactsPort } from "../slates/filters.js";
import { createInteractionRerankSignals } from "./interaction-rerank-signals.js";
import { createPostgresFeatureSnapshotStore } from "./postgres-feature-snapshot-store.js";
import { createPostgresInteractionRepository } from "./postgres-interaction-repository.js";
import { createPostgresCompanySectorsPort } from "./postgres-filter-facts.js";
import { createPostgresSemanticRepresentationStore } from "./postgres-semantic-store.js";
import {
  createPostgresRefreshRequestStore,
  createPostgresSlateRepository,
} from "./postgres-slate-repository.js";

/**
 * The whole V1 recommendation pipeline over one database executor: REC-001
 * eligibility, REC-002 structured and REC-003 semantic candidates, the
 * hybrid pool, REC-004 features, the REC-005 ranker bound to the server's
 * ranking config, and the REC-006 slate store and builder.
 *
 * One composition for every process that runs recommendations, so the
 * worker that builds a slate and the API that serves it cannot disagree
 * on a port, a policy version or a config. The caller supplies what is
 * process-specific: the executor, the disclosure evaluator it already
 * composed, and the embedding boundary.
 */

export type RecommendationPipelineDependencies = {
  readonly sql: DatabaseExecutor;
  readonly transactions: TransactionManager;
  readonly disclosure: DisclosureAccessService;
  readonly embedder: SemanticEmbedder;
  readonly policy?: SlatePolicy | undefined;
  /** Re-approach after a post-meeting pass (doc 19 §67). Absent: it stays closed. */
  readonly materialChanges?: MaterialChangePort | undefined;
  readonly clock?: (() => Date) | undefined;
  readonly logger?: Logger | undefined;
};

export type RecommendationPipeline = {
  readonly eligibilityPorts: EligibilityPorts;
  readonly eligibility: EligibilityService;
  readonly structured: StructuredCandidateService;
  readonly semantic: SemanticCandidateService;
  readonly hybrid: HybridCandidateService;
  readonly features: FeatureService;
  readonly ranking: RankingService;
  readonly snapshots: FeatureSnapshotStore;
  readonly slates: SlateRepository;
  readonly refreshRequests: RefreshRequestStore;
  readonly rerank: RerankService;
  readonly suppression: ProactiveSuppressionPort;
  readonly builder: SlateBuilder;
};

/** The REC-001 half every process needs: ports and the eligibility service. */
function composeEligibility(input: {
  readonly sql: DatabaseExecutor;
  readonly disclosure: DisclosureAccessService;
  readonly materialChanges?: MaterialChangePort | undefined;
  readonly clock?: (() => Date) | undefined;
  readonly logger?: Logger | undefined;
}) {
  const { sql, disclosure, clock, logger } = input;
  const marketplace = createPostgresCompanyMarketplaceQueryPort({ sql });
  const mandates = createPostgresInvestorMandateQueryPort({ sql });
  const assignments = createPostgresTaxonomyAssignmentRepository();
  const taxonomy = createTaxonomyQueryPort({
    sql,
    reference: createPostgresTaxonomyReferenceRepository(),
    normalizeAlias: normalizeTaxonomyAlias,
  });
  const relationshipRepository = createPostgresRelationshipRepository();
  const relationshipEventRepository =
    createPostgresRelationshipEventRepository();
  const relationships: RelationshipQueryPort = {
    getById: (id) => relationshipRepository.findById(sql, id),
    findByParties: (companyId, investorOrganisationId) =>
      relationshipRepository.findByParties(
        sql,
        companyId,
        investorOrganisationId,
      ),
    listEvents: (id, page = {}) =>
      relationshipEventRepository.listByRelationship(sql, id, {
        afterSequence: page.afterSequence,
        limit: page.limit ?? 100,
      }),
    getEventById: (id) => relationshipEventRepository.findById(sql, id),
    passStanding: createPostgresPassStandingReader(sql),
  };
  const eligibilityPorts = createDomainEligibilityPorts({
    sql,
    companies: marketplace,
    assignments,
    mandates,
    investorOrganisations: createPostgresInvestorOrganisationRepository(),
    relationships,
    disclosure,
    taxonomy,
    materialChanges: input.materialChanges,
  });
  const eligibility = createEligibilityService({
    ports: eligibilityPorts,
    clock,
    logger,
  });
  return { marketplace, assignments, taxonomy, eligibilityPorts, eligibility };
}

export type SlateReadPipelineDependencies = {
  readonly sql: DatabaseExecutor;
  readonly disclosure: DisclosureAccessService;
  /** When present, a page with no servable slate asks the queue for a rebuild. */
  readonly queue?: RefreshQueue | undefined;
  /**
   * Discover filter facts other contexts own (a raise shared with the
   * reader, verification, a pitch), composed by the app. Sectors are read
   * here, from declared taxonomy assignments.
   */
  readonly filterFacts?: Omit<DiscoverFilterFactsPort, "sectors"> | undefined;
  readonly policy?: SlatePolicy | undefined;
  /** BILLING-2 (ADR 0036): the reader's plan volume; see the slate reader. */
  readonly volume?: SlateReadServiceDependencies["volume"];
  /**
   * Each company's newest publishable pitch's READY time (the media
   * context's), so a passed company with a new pitch is offered again
   * (doc 19 §67). Absent: a passed company stays withheld.
   */
  readonly pitchTimes?: PublishablePitchTimesPort | undefined;
  /** Re-approach after a post-meeting pass (doc 19 §67). Absent: it stays closed. */
  readonly materialChanges?: MaterialChangePort | undefined;
  readonly clock?: (() => Date) | undefined;
  readonly logger?: Logger | undefined;
};

export type SlateReadPipeline = {
  readonly eligibilityPorts: EligibilityPorts;
  readonly eligibility: EligibilityService;
  readonly slates: SlateRepository;
  readonly refreshRequests: RefreshRequestStore;
  readonly requester: RefreshRequester | undefined;
  readonly suppression: ProactiveSuppressionPort;
  readonly reader: SlateReadService;
};

/**
 * What a process that only serves slates needs: REC-001 for the read-time
 * guard, the slate store and the reader. No generator, no ranker, no
 * embedding boundary: the API never builds.
 */
export function createSlateReadPipeline(
  dependencies: SlateReadPipelineDependencies,
): SlateReadPipeline {
  const { sql, disclosure, queue, policy, clock, logger } = dependencies;
  const { eligibilityPorts, eligibility } = composeEligibility({
    sql,
    disclosure,
    materialChanges: dependencies.materialChanges,
    clock,
    logger,
  });
  const slates = createPostgresSlateRepository({ sql });
  const refreshRequests = createPostgresRefreshRequestStore({ sql });
  const requester =
    queue === undefined
      ? undefined
      : createRefreshRequester({
          requests: refreshRequests,
          queue,
          clock,
          logger,
        });
  // REC-009R: what this organisation passed on is checked when the page is
  // served, not when the slate was built, because a pass can happen at any
  // point in between. A passed company comes back only with evidence of
  // something new: a pitch that became playable after the pass.
  const interactions = createPostgresInteractionRepository({ sql });
  const suppression = createProactiveSuppression({
    signals: createInteractionRerankSignals({ repository: interactions }),
    ...(dependencies.pitchTimes === undefined
      ? {}
      : {
          reintroductions: createPitchReintroductions({
            repository: interactions,
            pitches: dependencies.pitchTimes,
          }),
        }),
  });
  const reader = createSlateReadService({
    ports: eligibilityPorts,
    eligibility,
    suppression,
    slates,
    cards: createPostgresCompanyCardPort({ sql }),
    pool: createPostgresDiscoverablePoolPort({ sql }),
    filterFacts: {
      ...dependencies.filterFacts,
      ...createPostgresCompanySectorsPort({ sql }),
    },
    requester,
    policy,
    volume: dependencies.volume,
    clock,
    logger,
  });
  return {
    eligibilityPorts,
    eligibility,
    slates,
    refreshRequests,
    requester,
    suppression,
    reader,
  };
}

export function createRecommendationPipeline(
  dependencies: RecommendationPipelineDependencies,
): RecommendationPipeline {
  const { sql, transactions, disclosure, embedder, policy, clock, logger } =
    dependencies;

  const { marketplace, assignments, taxonomy, eligibilityPorts, eligibility } =
    composeEligibility({
      sql,
      disclosure,
      materialChanges: dependencies.materialChanges,
      clock,
      logger,
    });

  const semanticPorts = createDomainSemanticPorts({
    sql,
    companies: marketplace,
    assignments,
    taxonomy,
    mandates: createPostgresInvestorMandateRepository(),
  });
  const semantic = createSemanticCandidateService({
    ports: eligibilityPorts,
    facts: semanticPorts.facts,
    narratives: semanticPorts.narratives,
    vocabulary: semanticPorts.vocabulary,
    store: createPostgresSemanticRepresentationStore({ sql }),
    embeddings: embedder,
    eligibility,
    logger,
  });
  const structured = createStructuredCandidateService({
    ports: eligibilityPorts,
    retrieval: createDomainCandidatePorts({
      sql,
      companies: marketplace,
      assignments,
      taxonomy,
    }),
    eligibility,
    logger,
  });
  const hybrid = createHybridCandidateService({ structured, semantic, logger });

  const featurePorts = createDomainFeaturePorts({
    sql,
    companies: marketplace,
    assignments,
    taxonomy,
  });
  const snapshots = createPostgresFeatureSnapshotStore({ sql });
  const features = createFeatureService({
    registry: createFeatureRegistry(),
    ports: eligibilityPorts,
    companies: featurePorts.companies,
    hierarchy: featurePorts.hierarchy,
    store: snapshots,
    clock,
    logger,
  });
  const ranking = createRankingService({
    features,
    ranker: createDeterministicRanker({
      config: RANKING_CONFIG_CURRENT,
      registry: createFeatureRegistry(),
    }),
    logger,
  });

  const slates = createPostgresSlateRepository({ sql });
  const refreshRequests = createPostgresRefreshRequestStore({ sql });
  // REC-009 reorders what REC-005 ranked. Its only new read is this
  // organisation's own bounded interaction signals, narrowed by the
  // adapter to three facts; no reintroduction source exists yet, so a
  // passed company stays suppressed (CQ-REC-009 §12).
  const signals = createInteractionRerankSignals({
    repository: createPostgresInteractionRepository({ sql }),
  });
  const rerank = createRerankService({
    reranker: createReranker(),
    signals,
    logger,
  });
  // REC-009R: the same state, asked at serving time. Demotion to the tail
  // orders a slate; only this keeps a passed company out of a page.
  const suppression = createProactiveSuppression({ signals });
  const builder = createSlateBuilder({
    ports: eligibilityPorts,
    pool: createPostgresDiscoverablePoolPort({ sql }),
    hybrid,
    ranking,
    rerank,
    snapshots,
    slates,
    transactions,
    policy,
    clock,
    logger,
  });

  return {
    eligibilityPorts,
    eligibility,
    structured,
    semantic,
    hybrid,
    features,
    ranking,
    snapshots,
    slates,
    refreshRequests,
    rerank,
    suppression,
    builder,
  };
}
