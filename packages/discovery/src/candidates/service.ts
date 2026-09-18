import { getMeter, type Logger } from "@capital-q/observability";
import type { ActorContext } from "@capital-q/security";

import { ELIGIBILITY_POLICY_VERSION } from "../eligibility/contracts.js";
import type { EligibilityPorts } from "../eligibility/ports.js";
import type { EligibilityService } from "../eligibility/service.js";
import {
  CANDIDATE_DIMENSION_LIMIT,
  CANDIDATE_POOL_MAX,
  STRUCTURED_GENERATOR_ID,
  STRUCTURED_GENERATOR_VERSION,
  type CandidateDimension,
  type StructuredCandidate,
  type StructuredCandidateResult,
} from "./contracts.js";
import type { StructuredRetrievalPorts } from "./ports.js";
import {
  deriveStructuredIntent,
  GEOGRAPHY_VOCABULARY,
  mergeDimensionHits,
  type DimensionHit,
} from "./structured.js";

/**
 * The structured mandate candidate generator (doc 19 §23), as a service
 * REC-005's ranker and REC-003's merge will call.
 *
 *   resolve investor + ACTIVE mandate
 *   → derive positive structured intent
 *   → run each dimension retrieval independently (bounded, id-ordered)
 *   → merge by canonical company id, keep every reason
 *   → REC-001 eligibility, in one batch
 *   → ELIGIBLE candidates only, in canonical id order
 *
 * The investor organisation and mandate come from the trusted actor
 * through the same ports REC-001 uses; nothing a client sends names a
 * tenant, an organisation or a mandate. Companies from any tenant enter
 * only through discovery-classified retrieval and leave only if the
 * eligibility policy, which reads disclosure, says ELIGIBLE.
 */

export type GenerateStructuredCandidatesQuery = {
  readonly actor: ActorContext;
  /** Pins one of the actor's own mandates; otherwise the single ACTIVE one. */
  readonly mandateId?: string | null | undefined;
  /** Pool cap; bounded above by CANDIDATE_POOL_MAX. */
  readonly limit?: number | undefined;
};

export type StructuredCandidateService = {
  readonly generate: (
    query: GenerateStructuredCandidatesQuery,
  ) => Promise<StructuredCandidateResult>;
};

export type StructuredCandidateServiceDependencies = {
  /** The investor subject and ACTIVE mandate resolution REC-001 already defines. */
  readonly ports: Pick<
    EligibilityPorts,
    "investorSubject" | "mandates" | "taxonomyVersions"
  >;
  readonly retrieval: StructuredRetrievalPorts;
  /** REC-001, the single eligibility authority. */
  readonly eligibility: EligibilityService;
  readonly logger?: Logger | undefined;
};

export function createStructuredCandidateService(
  dependencies: StructuredCandidateServiceDependencies,
): StructuredCandidateService {
  const { ports, retrieval, eligibility, logger } = dependencies;
  const meter = getMeter("@capital-q/discovery");
  const metrics = {
    runs: meter.createCounter("discovery.candidates.structured.runs"),
    hits: meter.createHistogram("discovery.candidates.structured.raw_hits"),
    eligible: meter.createHistogram("discovery.candidates.structured.eligible"),
    duration: meter.createHistogram(
      "discovery.candidates.structured.duration_ms",
    ),
  };

  return {
    generate: async (query) => {
      const started = performance.now();
      const poolMax = Math.max(
        1,
        Math.min(
          CANDIDATE_POOL_MAX,
          Math.trunc(query.limit ?? CANDIDATE_POOL_MAX),
        ),
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

      // ACTIVE only. NONE and AMBIGUOUS both mean "nothing to retrieve
      // against"; a DRAFT can never be FOUND, and there is no newest-by-date
      // fallback because a stale mandate is not the investor's intent.
      if (
        lookup.kind !== "FOUND" ||
        lookup.mandate.status !== "ACTIVE" ||
        lookup.mandate.investorOrganisationId !== investorOrganisationId
      ) {
        return {
          kind: "NO_ACTIVE_MANDATE",
          generatorId: STRUCTURED_GENERATOR_ID,
          generatorVersion: STRUCTURED_GENERATOR_VERSION,
          context: {
            tenantId: query.actor.tenantId,
            investorOrganisationId,
            mode: "INVESTOR_DISCOVER",
            mandateId: null,
            taxonomyVersion,
            eligibilityPolicyVersion: ELIGIBILITY_POLICY_VERSION,
          },
        };
      }
      const mandate = lookup.mandate;
      const intent = deriveStructuredIntent(mandate);

      // Each dimension runs on its own; an empty intent for one dimension
      // is simply no hits from it, never a veto over the others.
      const hits: DimensionHit[] = [];
      const rawHitsByDimension: Record<CandidateDimension, number> = {
        STAGE: 0,
        GEOGRAPHY: 0,
        TAXONOMY: 0,
        CHEQUE: 0,
      };

      const stageWork =
        intent.stageCodes.length === 0
          ? Promise.resolve()
          : retrieval.companies
              .byStageCodes(intent.stageCodes, CANDIDATE_DIMENSION_LIMIT)
              .then((refs) => {
                for (const ref of refs) {
                  hits.push({
                    ...ref,
                    dimension: "STAGE",
                    reasonCode: "STAGE_OVERLAP",
                  });
                }
                rawHitsByDimension.STAGE += refs.length;
              });

      const countryWork =
        intent.countryCodes.length === 0
          ? Promise.resolve()
          : retrieval.companies
              .byHeadquartersCountries(
                intent.countryCodes,
                CANDIDATE_DIMENSION_LIMIT,
              )
              .then((refs) => {
                for (const ref of refs) {
                  hits.push({
                    ...ref,
                    dimension: "GEOGRAPHY",
                    reasonCode: "GEOGRAPHY_OVERLAP",
                  });
                }
                rawHitsByDimension.GEOGRAPHY += refs.length;
              });

      const taxonomyWork = (async () => {
        if (intent.taxonomyNodeIds.length === 0) return;
        const expansions = await Promise.all(
          intent.taxonomyNodeIds.map((nodeId) =>
            retrieval.taxonomy.expandPreference(nodeId),
          ),
        );
        // node id asked about → (preferred node, vocabulary, exact?)
        const asked = new Map<
          string,
          {
            readonly preferredNodeId: string;
            readonly vocabularyCode: string;
            readonly exact: boolean;
          }
        >();
        for (const expansion of expansions) {
          if (expansion === null || expansion.unrestricted) continue;
          asked.set(expansion.preferredNodeId, {
            preferredNodeId: expansion.preferredNodeId,
            vocabularyCode: expansion.vocabularyCode,
            exact: true,
          });
          for (const descendant of expansion.descendantNodeIds) {
            // An exact ask wins over being some other node's descendant.
            if (!asked.has(descendant)) {
              asked.set(descendant, {
                preferredNodeId: expansion.preferredNodeId,
                vocabularyCode: expansion.vocabularyCode,
                exact: false,
              });
            }
          }
        }
        if (asked.size === 0) return;
        const found = await retrieval.taxonomy.subjectsByNodes(
          [...asked.keys()].sort(),
          CANDIDATE_DIMENSION_LIMIT,
        );
        for (const hit of found) {
          const ask = asked.get(hit.nodeId);
          if (ask === undefined) continue;
          const geography = ask.vocabularyCode === GEOGRAPHY_VOCABULARY;
          hits.push({
            companyId: hit.companyId,
            tenantId: hit.tenantId,
            dimension: geography ? "GEOGRAPHY" : "TAXONOMY",
            reasonCode: geography
              ? "GEOGRAPHY_REGION_OVERLAP"
              : ask.exact
                ? "TAXONOMY_OVERLAP"
                : "TAXONOMY_DESCENDANT_OVERLAP",
            matchedNode: {
              preferredNodeId: ask.preferredNodeId,
              matchedNodeId: hit.nodeId,
              vocabularyCode: hit.vocabularyCode,
              exact: ask.exact,
            },
          });
          if (geography) rawHitsByDimension.GEOGRAPHY += 1;
          else rawHitsByDimension.TAXONOMY += 1;
        }
      })();

      const chequeWork = retrieval.cheque
        .signal({ ...intent.cheque, limit: CANDIDATE_DIMENSION_LIMIT })
        .then((result) => {
          for (const ref of result.hits) {
            hits.push({
              ...ref,
              dimension: "CHEQUE",
              reasonCode: "CHEQUE_OVERLAP",
            });
          }
          rawHitsByDimension.CHEQUE += result.hits.length;
          return result.status;
        });

      const [, , , chequeSignal] = await Promise.all([
        stageWork,
        countryWork,
        taxonomyWork,
        chequeWork,
      ]);

      const merged = mergeDimensionHits(hits, { taxonomyVersion, poolMax });

      // REC-001 in one batch: the pool is bounded to its batch size by
      // construction. Only ELIGIBLE is rankable; UNDETERMINED is not
      // quietly promoted and INELIGIBLE never leaves this function.
      const evaluation =
        merged.candidates.length === 0
          ? { results: [] as const }
          : await eligibility.evaluate({
              actor: query.actor,
              mode: "INVESTOR_DISCOVER",
              mandateId: mandate.mandateId,
              companyIds: merged.candidates.map((c) => c.companyId),
            });
      const byCompany = new Map(
        evaluation.results.map((r) => [r.companyId, r] as const),
      );
      let ineligible = 0;
      let undetermined = 0;
      const candidates: StructuredCandidate[] = [];
      for (const candidate of merged.candidates) {
        const result = byCompany.get(candidate.companyId);
        if (result === undefined || result.decision === "INELIGIBLE") {
          ineligible += 1;
          continue;
        }
        if (result.decision === "UNDETERMINED") {
          undetermined += 1;
          continue;
        }
        candidates.push({
          companyId: candidate.companyId,
          provenance: candidate.provenance,
          eligibility: result,
        });
      }

      const durationMs = Math.round(performance.now() - started);
      const diagnostics = {
        rawHitsByDimension,
        rawHits: hits.length,
        deduped: merged.candidates.length,
        truncated: merged.truncated,
        eligible: candidates.length,
        ineligible,
        undetermined,
        chequeSignal,
        durationMs,
      };
      metrics.runs.add(1, { generator: STRUCTURED_GENERATOR_ID });
      metrics.hits.record(hits.length, { generator: STRUCTURED_GENERATOR_ID });
      metrics.eligible.record(candidates.length, {
        generator: STRUCTURED_GENERATOR_ID,
      });
      metrics.duration.record(durationMs, {
        generator: STRUCTURED_GENERATOR_ID,
      });
      // Counts and versions only.
      logger?.debug(
        {
          generatorVersion: STRUCTURED_GENERATOR_VERSION,
          eligibilityPolicyVersion: ELIGIBILITY_POLICY_VERSION,
          mandateVersion: mandate.version,
          ...diagnostics,
        },
        "structured candidates generated",
      );

      return {
        kind: "GENERATED",
        generatorId: STRUCTURED_GENERATOR_ID,
        generatorVersion: STRUCTURED_GENERATOR_VERSION,
        eligibilityPolicyVersion: ELIGIBILITY_POLICY_VERSION,
        context: {
          tenantId: query.actor.tenantId,
          investorOrganisationId,
          mode: "INVESTOR_DISCOVER",
          mandateId: mandate.mandateId,
          taxonomyVersion,
          eligibilityPolicyVersion: ELIGIBILITY_POLICY_VERSION,
        },
        candidates,
        diagnostics,
      };
    },
  };
}
