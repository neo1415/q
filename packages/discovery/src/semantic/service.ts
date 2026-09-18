import { getMeter, type Logger } from "@capital-q/observability";
import {
  EMBEDDING_DOCUMENT_INSTRUCTION_VERSION,
  EmbeddingProviderFailure,
  instructionFor,
  type EmbeddingResult,
} from "@capital-q/q-embeddings";
import type { ActorContext } from "@capital-q/security";

import { deriveStructuredIntent } from "../candidates/structured.js";
import { ELIGIBILITY_POLICY_VERSION } from "../eligibility/contracts.js";
import type { EligibilityPorts } from "../eligibility/ports.js";
import type { EligibilityService } from "../eligibility/service.js";
import {
  COMPANY_REPRESENTATION_VERSION,
  INVESTOR_REPRESENTATION_VERSION,
  REPRESENTATION_PURPOSE,
  REPRESENTATION_REFRESH_LIMIT,
  SEMANTIC_GENERATOR_ID,
  SEMANTIC_GENERATOR_VERSION,
  SEMANTIC_SIMILARITY_METRIC,
  SEMANTIC_TOP_K,
  type RepresentationRefreshReport,
  type SemanticCandidate,
  type SemanticCandidateResult,
} from "./contracts.js";
import type {
  CompanyInvestmentFactsPort,
  InvestorMandateNarrativePort,
  SemanticEmbedder,
  SemanticRepresentationStore,
  VectorIdentity,
  VocabularyDescriptionPort,
} from "./ports.js";
import {
  buildCompanyInvestmentRepresentation,
  buildInvestorMandateRepresentation,
  type RepresentationClassification,
} from "./representation.js";

/**
 * The semantic mandate candidate generator (doc 19 §24), and the refresh
 * that keeps company representations and vectors current.
 *
 *   refresh:  discoverable company facts → deterministic representation
 *             → compare hash with CURRENT row → (supersede + insert)
 *             → reuse or compute the vector → store
 *
 *   generate: resolve investor + ACTIVE mandate
 *             → deterministic mandate representation (same compare/write)
 *             → reuse or compute the query vector
 *             → pgvector top-K over CURRENT, currently discoverable companies
 *             → REC-001 eligibility, in one batch
 *             → ELIGIBLE candidates only, in canonical id order
 *
 * No representation is embedded during a query except the investor's own,
 * and that only when it changed. The local embedding runtime being down is
 * a typed UNAVAILABLE result, never a substitute vector. The investor
 * organisation and mandate come from the trusted actor through the ports
 * REC-001 defines; nothing a client sends names a tenant, a mandate, a
 * vector, a model or a score.
 */

export type GenerateSemanticCandidatesQuery = {
  readonly actor: ActorContext;
  /** Pins one of the actor's own mandates; otherwise the single ACTIVE one. */
  readonly mandateId?: string | null | undefined;
  /** Nearest-neighbour budget; bounded above by SEMANTIC_TOP_K. */
  readonly topK?: number | undefined;
};

export type RefreshCompanyRepresentationsInput = {
  /** The companies to refresh, or null for a bounded slice of every discoverable company. */
  readonly companyIds?: readonly string[] | null | undefined;
  readonly limit?: number | undefined;
};

export type SemanticCandidateService = {
  readonly generate: (
    query: GenerateSemanticCandidatesQuery,
  ) => Promise<SemanticCandidateResult>;
  /**
   * The smallest correct V1 freshness mechanism: rebuild what is stale or
   * missing, embed what has no vector, leave the rest alone. Rejects with
   * EmbeddingProviderFailure when the runtime cannot answer; nothing is
   * half-written for a company whose vector failed.
   */
  readonly refreshCompanyRepresentations: (
    input?: RefreshCompanyRepresentationsInput,
  ) => Promise<RepresentationRefreshReport>;
};

export type SemanticCandidateServiceDependencies = {
  /** The investor subject and ACTIVE mandate resolution REC-001 already defines. */
  readonly ports: Pick<
    EligibilityPorts,
    "investorSubject" | "mandates" | "taxonomyVersions"
  >;
  readonly facts: CompanyInvestmentFactsPort;
  readonly narratives: InvestorMandateNarrativePort;
  readonly vocabulary: VocabularyDescriptionPort;
  readonly store: SemanticRepresentationStore;
  readonly embeddings: SemanticEmbedder;
  /** REC-001, the single eligibility authority. */
  readonly eligibility: EligibilityService;
  readonly logger?: Logger | undefined;
};

const MANDATE_TASK = "MANDATE_MATCHING" as const;

function identityOf(
  result: Pick<
    EmbeddingResult,
    | "providerCode"
    | "modelCode"
    | "modelRevision"
    | "configurationVersion"
    | "instructionVersion"
    | "dimension"
  >,
): VectorIdentity {
  return {
    providerCode: result.providerCode,
    modelCode: result.modelCode,
    modelRevision: result.modelRevision,
    configurationVersion: result.configurationVersion,
    instructionVersion: result.instructionVersion,
    dimension: result.dimension,
  };
}

export function createSemanticCandidateService(
  dependencies: SemanticCandidateServiceDependencies,
): SemanticCandidateService {
  const {
    ports,
    facts,
    narratives,
    vocabulary,
    store,
    embeddings,
    eligibility,
    logger,
  } = dependencies;
  const meter = getMeter("@capital-q/discovery");
  const metrics = {
    runs: meter.createCounter("discovery.candidates.semantic.runs"),
    hits: meter.createHistogram("discovery.candidates.semantic.raw_hits"),
    eligible: meter.createHistogram("discovery.candidates.semantic.eligible"),
    duration: meter.createHistogram(
      "discovery.candidates.semantic.duration_ms",
    ),
    refreshed: meter.createCounter(
      "discovery.candidates.semantic.representations_built",
    ),
    embedded: meter.createCounter("discovery.candidates.semantic.embedded"),
  };

  const descriptor = embeddings.describe();
  const configuration = descriptor.configuration;
  /** The identity every company (document) vector is stored and searched under. */
  const documentIdentity: VectorIdentity = {
    providerCode: descriptor.providerCode,
    modelCode: configuration.modelCode,
    modelRevision: configuration.modelRevision,
    configurationVersion: configuration.configurationVersion,
    instructionVersion: EMBEDDING_DOCUMENT_INSTRUCTION_VERSION,
    dimension: configuration.dimension,
  };
  const queryInstructionVersion =
    instructionFor(MANDATE_TASK).instructionVersion;

  async function describeClassifications(
    nodeIds: readonly string[],
  ): Promise<ReadonlyMap<string, RepresentationClassification>> {
    const unique = [...new Set(nodeIds)].sort();
    if (unique.length === 0) return new Map();
    const nodes = await vocabulary.describeNodes(unique);
    return new Map(
      nodes.map((n) => [
        n.nodeId,
        {
          vocabularyCode: n.vocabularyCode,
          canonicalCode: n.canonicalCode,
          displayName: n.displayName,
        },
      ]),
    );
  }

  return {
    refreshCompanyRepresentations: async (input = {}) => {
      const started = performance.now();
      const limit = Math.max(
        1,
        Math.min(
          REPRESENTATION_REFRESH_LIMIT,
          Math.trunc(input.limit ?? REPRESENTATION_REFRESH_LIMIT),
        ),
      );
      const companies = await facts.listDiscoverable({
        companyIds: input.companyIds ?? null,
        limit,
      });
      const named = await describeClassifications(
        companies.flatMap((c) => c.classifications.map((k) => k.nodeId)),
      );

      let built = 0;
      let unchanged = 0;
      let embedded = 0;
      let reused = 0;
      // Companies whose current representation has no vector yet, in the
      // order they will be embedded; results come back in the same order.
      const pending: {
        readonly company: (typeof companies)[number];
        readonly representationId: string;
        readonly contentSha256: string;
        readonly text: string;
      }[] = [];

      for (const company of companies) {
        const representation = buildCompanyInvestmentRepresentation({
          companyId: company.companyId,
          sourceVersion: company.sourceVersion,
          canonicalName: company.canonicalName,
          shortDescription: company.shortDescription,
          currentStageCode: company.currentStageCode,
          headquartersCountry: company.headquartersCountry,
          classifications: company.classifications.flatMap((k) => {
            const described = named.get(k.nodeId);
            // A node the reference data cannot name is still a canonical
            // code; it is rendered as its code, never dropped silently.
            return [
              described ?? {
                vocabularyCode: k.vocabularyCode,
                canonicalCode: k.canonicalCode,
                displayName: k.canonicalCode,
              },
            ];
          }),
        });
        const current = await store.currentCompanyRepresentation({
          companyId: company.companyId,
          purpose: REPRESENTATION_PURPOSE,
          representationVersion: COMPANY_REPRESENTATION_VERSION,
        });
        let row = current;
        if (
          current === null ||
          current.contentSha256 !== representation.contentSha256
        ) {
          if (current !== null) {
            await store.supersedeCompanyRepresentation(current.id);
          }
          row = await store.insertCompanyRepresentation({
            tenantId: company.tenantId,
            companyId: company.companyId,
            purpose: REPRESENTATION_PURPOSE,
            representationVersion: COMPANY_REPRESENTATION_VERSION,
            sourceFingerprint: representation.sourceFingerprint,
            contentSha256: representation.contentSha256,
            content: representation.text,
          });
          built += 1;
        } else {
          unchanged += 1;
        }
        if (row === null) continue;
        if (
          await store.hasCompanyEmbedding({
            representationId: row.id,
            identity: documentIdentity,
          })
        ) {
          reused += 1;
          continue;
        }
        // Identical content this company embedded before (a rebuild that
        // came back to an earlier text) is the same work: reuse the vector.
        const reusable = await store.findReusableCompanyVector({
          companyId: company.companyId,
          contentSha256: representation.contentSha256,
          identity: documentIdentity,
        });
        if (reusable !== null) {
          await store.insertCompanyEmbedding({
            tenantId: company.tenantId,
            representationId: row.id,
            companyId: company.companyId,
            contentSha256: representation.contentSha256,
            identity: documentIdentity,
            vector: reusable,
          });
          reused += 1;
          continue;
        }
        pending.push({
          company,
          representationId: row.id,
          contentSha256: representation.contentSha256,
          text: representation.text,
        });
      }

      if (pending.length > 0) {
        // One bounded, ordered call; a failure here leaves representations
        // current and vectorless, which the next refresh completes.
        const result = await embeddings.embedDocuments(
          pending.map((p) => p.text),
        );
        for (const [index, item] of pending.entries()) {
          const vector = result.embeddings[index];
          if (vector === undefined) {
            throw new EmbeddingProviderFailure(
              "the embedding runtime returned fewer vectors than inputs",
              {
                failureClass: "INVALID_RESPONSE",
                providerCode: descriptor.providerCode,
              },
            );
          }
          await store.insertCompanyEmbedding({
            tenantId: item.company.tenantId,
            representationId: item.representationId,
            companyId: item.company.companyId,
            contentSha256: item.contentSha256,
            identity: identityOf(vector),
            vector: vector.vector,
          });
          embedded += 1;
        }
      }

      const durationMs = Math.round(performance.now() - started);
      metrics.refreshed.add(built, { generator: SEMANTIC_GENERATOR_ID });
      metrics.embedded.add(embedded, { generator: SEMANTIC_GENERATOR_ID });
      const report: RepresentationRefreshReport = {
        representationVersion: COMPANY_REPRESENTATION_VERSION,
        configurationVersion: configuration.configurationVersion,
        considered: companies.length,
        built,
        unchanged,
        embedded,
        reused,
        durationMs,
      };
      // Counts and versions only.
      logger?.debug(report, "company representations refreshed");
      return report;
    },

    generate: async (query) => {
      const started = performance.now();
      const topK = Math.max(
        1,
        Math.min(SEMANTIC_TOP_K, Math.trunc(query.topK ?? SEMANTIC_TOP_K)),
      );

      const subject = await ports.investorSubject.investorOrganisationFor(
        query.actor,
      );
      if (subject === null) {
        throw new Error(
          "the acting organisation has no canonical investor organisation",
        );
      }
      const investorOrganisationId = subject.investorOrganisationId;
      const [lookup, taxonomyVersion] = await Promise.all([
        ports.mandates.activeMandate({
          tenantId: query.actor.tenantId,
          investorOrganisationId,
          mandateId: query.mandateId ?? null,
        }),
        ports.taxonomyVersions?.currentVersions() ?? Promise.resolve(null),
      ]);
      const context = (mandateId: string | null) => ({
        tenantId: query.actor.tenantId,
        investorOrganisationId,
        mode: "INVESTOR_DISCOVER" as const,
        mandateId,
        taxonomyVersion,
        eligibilityPolicyVersion: ELIGIBILITY_POLICY_VERSION,
      });

      // ACTIVE only; never a DRAFT, never the newest, never a guess.
      if (
        lookup.kind !== "FOUND" ||
        lookup.mandate.status !== "ACTIVE" ||
        lookup.mandate.investorOrganisationId !== investorOrganisationId
      ) {
        return {
          kind: "NO_ACTIVE_MANDATE",
          generatorId: SEMANTIC_GENERATOR_ID,
          generatorVersion: SEMANTIC_GENERATOR_VERSION,
          context: context(null),
        };
      }
      const mandate = lookup.mandate;
      const narrative = await narratives.narrativeFor({
        tenantId: query.actor.tenantId,
        investorOrganisationId,
        mandateId: mandate.mandateId,
      });
      if (narrative === null) {
        return {
          kind: "NO_ACTIVE_MANDATE",
          generatorId: SEMANTIC_GENERATOR_ID,
          generatorVersion: SEMANTIC_GENERATOR_VERSION,
          context: context(null),
        };
      }

      // Positive intent only, exactly as the structured generator reads it.
      const intent = deriveStructuredIntent(mandate);
      const named = await describeClassifications(intent.taxonomyNodeIds);
      const representation = buildInvestorMandateRepresentation({
        mandateId: mandate.mandateId,
        mandateVersion: narrative.version,
        name: narrative.name,
        rawMandateText: narrative.rawMandateText,
        stageCodes: intent.stageCodes,
        countryCodes: intent.countryCodes,
        preferences: intent.taxonomyNodeIds.flatMap((nodeId) => {
          const described = named.get(nodeId);
          return described === undefined ? [] : [described];
        }),
      });

      const current = await store.currentMandateRepresentation({
        mandateId: mandate.mandateId,
        purpose: REPRESENTATION_PURPOSE,
        representationVersion: INVESTOR_REPRESENTATION_VERSION,
      });
      let row = current;
      let investorRepresentation: "BUILT" | "UNCHANGED" = "UNCHANGED";
      if (
        current === null ||
        current.contentSha256 !== representation.contentSha256
      ) {
        if (current !== null) {
          await store.supersedeMandateRepresentation(current.id);
        }
        row = await store.insertMandateRepresentation({
          tenantId: query.actor.tenantId,
          investorOrganisationId,
          mandateId: mandate.mandateId,
          mandateVersion: narrative.version,
          purpose: REPRESENTATION_PURPOSE,
          representationVersion: INVESTOR_REPRESENTATION_VERSION,
          sourceFingerprint: representation.sourceFingerprint,
          contentSha256: representation.contentSha256,
          content: representation.text,
        });
        investorRepresentation = "BUILT";
      }
      if (row === null) throw new Error("mandate representation not stored");

      const queryIdentity: VectorIdentity = {
        ...documentIdentity,
        instructionVersion: queryInstructionVersion,
      };
      const queryStarted = performance.now();
      let queryVector = await store.findMandateVector({
        representationId: row.id,
        identity: queryIdentity,
      });
      let queryVectorSource: "COMPUTED" | "REUSED" = "REUSED";
      if (queryVector === null) {
        try {
          const result = await embeddings.embedQuery(
            representation.text,
            MANDATE_TASK,
          );
          queryVector = result.vector;
          await store.insertMandateEmbedding({
            tenantId: query.actor.tenantId,
            representationId: row.id,
            investorOrganisationId,
            contentSha256: representation.contentSha256,
            identity: identityOf(result),
            vector: result.vector,
          });
          queryVectorSource = "COMPUTED";
        } catch (error: unknown) {
          if (error instanceof EmbeddingProviderFailure) {
            logger?.warn(
              {
                generatorVersion: SEMANTIC_GENERATOR_VERSION,
                failureClass: error.failureClass,
                retryable: error.retryable,
              },
              "semantic candidates unavailable",
            );
            return {
              kind: "UNAVAILABLE",
              generatorId: SEMANTIC_GENERATOR_ID,
              generatorVersion: SEMANTIC_GENERATOR_VERSION,
              context: context(mandate.mandateId),
              failureClass: error.failureClass,
              retryable: error.retryable,
            };
          }
          throw error;
        }
      }
      const queryDurationMs = Math.round(performance.now() - queryStarted);

      const hits = await store.nearestCompanies({
        queryVector,
        purpose: REPRESENTATION_PURPOSE,
        representationVersion: COMPANY_REPRESENTATION_VERSION,
        configurationVersion: configuration.configurationVersion,
        documentInstructionVersion: EMBEDDING_DOCUMENT_INSTRUCTION_VERSION,
        limit: topK,
      });

      // REC-001 in one batch. Only ELIGIBLE is rankable; UNDETERMINED is
      // not promoted and INELIGIBLE never leaves this function.
      const evaluation =
        hits.length === 0
          ? { results: [] as const }
          : await eligibility.evaluate({
              actor: query.actor,
              mode: "INVESTOR_DISCOVER",
              mandateId: mandate.mandateId,
              companyIds: hits.map((h) => h.companyId),
            });
      const byCompany = new Map(
        evaluation.results.map((r) => [r.companyId, r] as const),
      );
      let ineligible = 0;
      let undetermined = 0;
      const candidates: SemanticCandidate[] = [];
      for (const hit of hits) {
        const result = byCompany.get(hit.companyId);
        if (result === undefined || result.decision === "INELIGIBLE") {
          ineligible += 1;
          continue;
        }
        if (result.decision === "UNDETERMINED") {
          undetermined += 1;
          continue;
        }
        const similarity = 1 - hit.distance;
        if (!Number.isFinite(similarity) || similarity < -1 || similarity > 1) {
          throw new RangeError(
            "the vector store returned a cosine distance outside its range",
          );
        }
        candidates.push({
          companyId: hit.companyId,
          provenance: {
            generatorId: SEMANTIC_GENERATOR_ID,
            generatorVersion: SEMANTIC_GENERATOR_VERSION,
            metric: SEMANTIC_SIMILARITY_METRIC,
            similarity,
            companyRepresentationVersion: COMPANY_REPRESENTATION_VERSION,
            investorRepresentationVersion: INVESTOR_REPRESENTATION_VERSION,
            configurationVersion: configuration.configurationVersion,
            documentInstructionVersion: EMBEDDING_DOCUMENT_INSTRUCTION_VERSION,
            queryInstructionVersion,
          },
          eligibility: result,
        });
      }
      // Canonical id order: reproducibility, not desirability. Similarity
      // is provenance for the ranker, never this generator's order.
      candidates.sort((a, b) => a.companyId.localeCompare(b.companyId));

      const durationMs = Math.round(performance.now() - started);
      const diagnostics = {
        topK,
        queryVector: queryVectorSource,
        investorRepresentation,
        rawHits: hits.length,
        eligible: candidates.length,
        ineligible,
        undetermined,
        queryDurationMs,
        durationMs,
      };
      metrics.runs.add(1, { generator: SEMANTIC_GENERATOR_ID });
      metrics.hits.record(hits.length, { generator: SEMANTIC_GENERATOR_ID });
      metrics.eligible.record(candidates.length, {
        generator: SEMANTIC_GENERATOR_ID,
      });
      metrics.duration.record(durationMs, { generator: SEMANTIC_GENERATOR_ID });
      logger?.debug(
        {
          generatorVersion: SEMANTIC_GENERATOR_VERSION,
          eligibilityPolicyVersion: ELIGIBILITY_POLICY_VERSION,
          configurationVersion: configuration.configurationVersion,
          mandateVersion: mandate.version,
          ...diagnostics,
        },
        "semantic candidates generated",
      );

      return {
        kind: "GENERATED",
        generatorId: SEMANTIC_GENERATOR_ID,
        generatorVersion: SEMANTIC_GENERATOR_VERSION,
        eligibilityPolicyVersion: ELIGIBILITY_POLICY_VERSION,
        context: context(mandate.mandateId),
        candidates,
        diagnostics,
      };
    },
  };
}
