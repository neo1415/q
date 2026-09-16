import { getMeter, type Logger } from "@capital-q/observability";
import type { ActorContext } from "@capital-q/security";

import {
  DISCOVERY_CANDIDATE_MAX,
  DISCOVERY_LIMIT_DEFAULT,
  DISCOVERY_LIMIT_MAX,
  DISCOVERY_RANKING_VERSION,
  type DiscoveredCompany,
  type DiscoveredInvestor,
  type DiscoveryCompanySlate,
  type DiscoveryInvestorSlate,
  type DiscoveryNote,
} from "../contracts.js";
import { declaredProfileFit, explicitFit, isExcluded } from "../domain/fit.js";
import { rankCompanies, rankInvestors } from "../domain/ranking.js";
import type {
  DiscoveryDisclosurePort,
  DiscoveryRepository,
  DiscoverySide,
} from "../ports.js";

/**
 * Discovery, in the order doc 19 fixes:
 *
 *   hard eligibility → candidate generation → declared hard exclusions
 *   → explicit fit → deterministic rank
 *
 * Semantic fit, evidence weighting and exploration are later steps in that
 * same order and are deliberately absent rather than approximated: a
 * pretend relevance score is worse than an honest gap, and the order above
 * is the part that has to be right first.
 *
 * No model is called. Nothing here reads behaviour. The slate is
 * reproducible from the rows alone.
 */

export type DiscoveryServiceDependencies = {
  readonly repository: DiscoveryRepository;
  readonly disclosure?: DiscoveryDisclosurePort | undefined;
  readonly logger?: Logger | undefined;
};

export type DiscoverQuery = {
  readonly actor: ActorContext;
  readonly limit?: number | undefined;
  /** Keyset: the last id of the previous page. Never an offset. */
  readonly cursor?: string | null | undefined;
};

export type DiscoveryService = {
  readonly discoverCompanies: (
    query: DiscoverQuery,
  ) => Promise<DiscoveryCompanySlate>;
  readonly discoverInvestors: (
    query: DiscoverQuery,
  ) => Promise<DiscoveryInvestorSlate>;
  /** Which slate this person's own organisation should be shown. */
  readonly sideFor: (actor: ActorContext) => Promise<DiscoverySide>;
};

function boundedLimit(limit: number | undefined): number {
  if (limit === undefined) return DISCOVERY_LIMIT_DEFAULT;
  return Math.max(1, Math.min(DISCOVERY_LIMIT_MAX, Math.trunc(limit)));
}

export function createDiscoveryService(
  dependencies: DiscoveryServiceDependencies,
): DiscoveryService {
  const { repository, disclosure, logger } = dependencies;
  const meter = getMeter("@capital-q/discovery");
  const metrics = {
    slates: meter.createCounter("discovery.slates"),
    candidates: meter.createHistogram("discovery.candidates_considered"),
    returned: meter.createHistogram("discovery.items_returned"),
  };

  /** Classification chose them; disclosure decides each one. */
  const permitted = async <T>(
    actor: ActorContext,
    items: readonly T[],
    type: "company" | "investor_organisation",
    idOf: (item: T) => string,
  ): Promise<readonly T[]> => {
    if (disclosure === undefined || items.length === 0) return items;
    const decisions = await disclosure.permitted(
      actor,
      items.map((item) => ({ type, id: idOf(item) })),
    );
    return items.filter((_item, index) => decisions[index] === true);
  };

  return {
    sideFor: (actor) => repository.ownSide(actor),

    discoverCompanies: async (query) => {
      const limit = boundedLimit(query.limit);
      const notes: DiscoveryNote[] = [];

      const [candidates, mandate] = await Promise.all([
        repository.discoverableCompanies(query.actor, {
          limit: DISCOVERY_CANDIDATE_MAX,
          afterId: query.cursor ?? null,
        }),
        repository.ownActiveMandate(query.actor),
      ]);
      metrics.candidates.record(candidates.length, { direction: "companies" });

      if (candidates.length === 0) {
        notes.push("NO_DISCOVERABLE_COUNTERPARTS");
        metrics.slates.add(1, { direction: "companies" });
        return {
          rankingVersion: DISCOVERY_RANKING_VERSION,
          items: [],
          notes,
          nextCursor: null,
        };
      }
      if (mandate === null) {
        notes.push("NO_ACTIVE_MANDATE");
      } else if (
        mandate.preferences.length === 0 &&
        mandate.minStageCode === null &&
        mandate.maxStageCode === null
      ) {
        notes.push("MANDATE_HAS_NO_PREFERENCES");
      }

      const preferences = mandate?.preferences ?? [];
      const eligible = candidates.filter(
        (candidate) => !isExcluded(preferences, candidate.classifications),
      );
      const visible = await permitted(
        query.actor,
        eligible,
        "company",
        (item) => item.companyId,
      );

      const scored = visible.map((candidate) => {
        const fit = explicitFit({
          preferences,
          classifications: candidate.classifications,
          companyStage: candidate.currentStageCode,
          minStage: mandate?.minStageCode ?? null,
          maxStage: mandate?.maxStageCode ?? null,
        });
        return {
          companyId: candidate.companyId,
          canonicalName: candidate.canonicalName,
          websiteUrl: candidate.websiteUrl,
          headquartersCountry: candidate.headquartersCountry,
          currentStageCode: candidate.currentStageCode,
          shortDescription: candidate.shortDescription,
          reasons: [...fit.reasons],
          rank: fit.score,
        } satisfies DiscoveredCompany;
      });

      const ranked = rankCompanies(scored);
      const page = ranked.slice(0, limit);
      metrics.returned.record(page.length, { direction: "companies" });
      metrics.slates.add(1, { direction: "companies" });
      logger?.debug(
        {
          direction: "companies",
          candidates: candidates.length,
          eligible: eligible.length,
          returned: page.length,
          rankingVersion: DISCOVERY_RANKING_VERSION,
        },
        "discovery slate built",
      );
      return {
        rankingVersion: DISCOVERY_RANKING_VERSION,
        items: page,
        notes,
        nextCursor:
          ranked.length > limit ? (page.at(-1)?.companyId ?? null) : null,
      };
    },

    discoverInvestors: async (query) => {
      const limit = boundedLimit(query.limit);
      // Said every time, because it is the honest description of this
      // slate: a founder is not matched against anybody's private mandate.
      const notes: DiscoveryNote[] = ["RANKED_ON_DECLARED_PROFILE_ONLY"];

      const candidates = await repository.discoverableInvestors(query.actor, {
        limit: DISCOVERY_CANDIDATE_MAX,
        afterId: query.cursor ?? null,
      });
      metrics.candidates.record(candidates.length, { direction: "investors" });
      if (candidates.length === 0) {
        notes.push("NO_DISCOVERABLE_COUNTERPARTS");
        metrics.slates.add(1, { direction: "investors" });
        return {
          rankingVersion: DISCOVERY_RANKING_VERSION,
          items: [],
          notes,
          nextCursor: null,
        };
      }

      const visible = await permitted(
        query.actor,
        candidates,
        "investor_organisation",
        (item) => item.investorOrganisationId,
      );
      const scored = visible.map((candidate) => {
        const fit = declaredProfileFit(candidate);
        return {
          investorOrganisationId: candidate.investorOrganisationId,
          displayName: candidate.displayName,
          investorType: candidate.investorType,
          websiteUrl: candidate.websiteUrl,
          hqCountry: candidate.hqCountry,
          publicDescription: candidate.publicDescription,
          deploymentState: candidate.deploymentState,
          reasons: [...fit.reasons],
          rank: fit.score,
        } satisfies DiscoveredInvestor;
      });

      const ranked = rankInvestors(scored);
      const page = ranked.slice(0, limit);
      metrics.returned.record(page.length, { direction: "investors" });
      metrics.slates.add(1, { direction: "investors" });
      return {
        rankingVersion: DISCOVERY_RANKING_VERSION,
        items: page,
        notes,
        nextCursor:
          ranked.length > limit
            ? (page.at(-1)?.investorOrganisationId ?? null)
            : null,
      };
    },
  };
}
