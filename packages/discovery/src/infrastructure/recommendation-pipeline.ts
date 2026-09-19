import { createPostgresCompanyMarketplaceQueryPort } from "@capital-q/companies";
import type { DatabaseExecutor, TransactionManager } from "@capital-q/database";
import {
  createPostgresInvestorMandateQueryPort,
  createPostgresInvestorMandateRepository,
  createPostgresInvestorOrganisationRepository,
} from "@capital-q/investors";
import {
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
import type { EligibilityPorts } from "../eligibility/ports.js";
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
import { RANKING_CONFIG_V1 } from "../ranking/config.js";
import { createDeterministicRanker } from "../ranking/ranker.js";
import {
  createRankingService,
  type RankingService,
} from "../ranking/service.js";
import type { SemanticEmbedder } from "../semantic/ports.js";
import {
  createSemanticCandidateService,
  type SemanticCandidateService,
} from "../semantic/service.js";
import { createSlateBuilder, type SlateBuilder } from "../slates/builder.js";
import type { SlatePolicy } from "../slates/contracts.js";
import type { RefreshRequestStore, SlateRepository } from "../slates/ports.js";
import { createDomainCandidatePorts } from "./domain-port-candidate-sources.js";
import { createDomainEligibilityPorts } from "./domain-port-eligibility-sources.js";
import { createDomainFeaturePorts } from "./domain-port-feature-sources.js";
import { createDomainSemanticPorts } from "./domain-port-semantic-sources.js";
import { createPostgresFeatureSnapshotStore } from "./postgres-feature-snapshot-store.js";
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
  readonly builder: SlateBuilder;
};

export function createRecommendationPipeline(
  dependencies: RecommendationPipelineDependencies,
): RecommendationPipeline {
  const { sql, transactions, disclosure, embedder, policy, clock, logger } =
    dependencies;

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
  });
  const eligibility = createEligibilityService({
    ports: eligibilityPorts,
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
      config: RANKING_CONFIG_V1,
      registry: createFeatureRegistry(),
    }),
    logger,
  });

  const slates = createPostgresSlateRepository({ sql });
  const refreshRequests = createPostgresRefreshRequestStore({ sql });
  const builder = createSlateBuilder({
    ports: eligibilityPorts,
    hybrid,
    ranking,
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
    builder,
  };
}
