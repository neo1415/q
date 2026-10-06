import {
  FIT_BAND_LABELS,
  FIT_CONFIDENCE_LABELS,
  FIT_OUTCOME_LABELS,
  FIT_PARAMETER_LABELS,
  FIT_PARAMETERS,
  fitScoreOutOf10,
  FitComparisonDtoSchema,
  type FitCandidateSource,
  type FitComparisonDto,
  type FitOutcome,
  type FitParameter,
  type FitProfileDto,
} from "@capital-q/contracts";
import type { Logger } from "@capital-q/observability";
import type { ActorContext } from "@capital-q/security";

import type { EligibilityReasonCode } from "../eligibility/contracts.js";
import type { EligibilityService } from "../eligibility/service.js";
import type { RecommendationFeatureSnapshot } from "../features/contracts.js";

import { FIT_CONFIG_CURRENT, type FitConfig } from "./config.js";
import { assessFit, compareAssessments, type FitAssessment } from "./model.js";
import { observeFit, type DeclaredFitFacts } from "./observe.js";

/**
 * Fit with your mandate, for one investor (B1-B3; ADR 0052).
 *
 * Off the swipe path by construction: Discover's feed route never calls
 * this. Profiles are a read-time projection over the feature snapshots
 * the slate builder already persisted plus declared facts, through a pure
 * model — one indexed read per company and no model call — so a card or
 * a profile reads it cheaply when it is opened.
 *
 * Authorisation, before anything is read (Context Firewall):
 *  1. the actor's own investor organisation, or nothing;
 *  2. eligibility for VIEW, under the actor's own viewpoint: a company the
 *     actor may not see is simply absent (no difference between "private"
 *     and "does not exist"); a declared hard rule becomes OUTSIDE_MANDATE,
 *     named, never weighted;
 *  3. only then are inputs read, for admitted companies only.
 * Top N ranks only the actor's own candidates (their relationships, the
 * requests sent to them, their feed), never the network.
 */

export type FitCandidate = {
  readonly companyId: string;
  readonly source: FitCandidateSource;
};

export type FitCompanyInputs = {
  readonly snapshot: RecommendationFeatureSnapshot | null;
  readonly declared: DeclaredFitFacts;
  readonly name: string;
  /** "Seed · Clean energy · Nairobi", or null. */
  readonly line: string | null;
};

export type FitInputSource = {
  /**
   * Inputs for companies eligibility already admitted for THIS actor.
   * Must return only what the actor may see; absent means no inputs.
   */
  readonly read: (query: {
    readonly actor: ActorContext;
    readonly investorOrganisationId: string;
    readonly mandateId: string;
    readonly companyIds: readonly string[];
  }) => Promise<ReadonlyMap<string, FitCompanyInputs>>;
};

export type FitServiceDependencies = {
  readonly investorSubject: {
    readonly investorOrganisationFor: (
      actor: ActorContext,
    ) => Promise<{ readonly investorOrganisationId: string } | null>;
  };
  readonly eligibility: Pick<EligibilityService, "evaluate">;
  readonly inputs: FitInputSource;
  /** The actor's own candidates: relationships, requests to them, their feed. */
  readonly candidates: (
    actor: ActorContext,
  ) => Promise<readonly FitCandidate[]>;
  readonly config?: FitConfig | undefined;
  readonly clock?: (() => Date) | undefined;
  readonly logger?: Logger | undefined;
};

export type FitProfileItem = {
  readonly assessment: FitAssessment;
  readonly name: string;
  readonly line: string | null;
};

export type FitProfilesResult =
  | { readonly kind: "OK"; readonly items: readonly FitProfileItem[] }
  | { readonly kind: "NOT_INVESTOR" }
  | { readonly kind: "NO_MANDATE" };

export type FitTopResult =
  | { readonly kind: "OK"; readonly comparison: FitComparisonDto }
  | { readonly kind: "NOT_INVESTOR" }
  | { readonly kind: "NO_MANDATE" };

export type FitService = {
  readonly profiles: (
    actor: ActorContext,
    companyIds: readonly string[],
  ) => Promise<FitProfilesResult>;
  readonly top: (actor: ActorContext, limit: number) => Promise<FitTopResult>;
};

/** The reader may not see the company at all: it is absent, not "poor". */
const NOT_VISIBLE: ReadonlySet<EligibilityReasonCode> = new Set([
  "COMPANY_NOT_ACTIVE",
  "COMPANY_NOT_MARKETPLACE_ELIGIBLE",
  "COMPANY_IS_INVESTORS_OWN",
  "COMPANY_NOT_DISCOVERABLE_BY_INVESTOR",
]);
const NO_MANDATE: ReadonlySet<EligibilityReasonCode> = new Set([
  "NO_ACTIVE_MANDATE",
  "ACTIVE_MANDATE_AMBIGUOUS",
  "MANDATE_NOT_ACTIVE",
]);

export const FIT_TOP_CANDIDATES_MAX = 200;

export function createFitService(
  dependencies: FitServiceDependencies,
): FitService {
  const config = dependencies.config ?? FIT_CONFIG_CURRENT;
  const clock = dependencies.clock ?? (() => new Date());

  const profiles = async (
    actor: ActorContext,
    companyIds: readonly string[],
  ): Promise<FitProfilesResult> => {
    const subject =
      await dependencies.investorSubject.investorOrganisationFor(actor);
    if (subject === null) return { kind: "NOT_INVESTOR" };
    const ids = [...new Set(companyIds)];
    if (ids.length === 0) return { kind: "OK", items: [] };

    const evaluation = await dependencies.eligibility.evaluate({
      actor,
      purpose: "VIEW",
      viewpoint: "ACTOR",
      companyIds: ids,
    });
    const admitted = evaluation.results.filter(
      (r) => !r.reasonCodes.some((code) => NOT_VISIBLE.has(code)),
    );
    if (
      admitted.length > 0 &&
      admitted.every(
        (r) =>
          r.mandateId === null || r.reasonCodes.some((c) => NO_MANDATE.has(c)),
      )
    ) {
      return { kind: "NO_MANDATE" };
    }
    const mandateId = admitted.find((r) => r.mandateId !== null)?.mandateId;
    if (mandateId === undefined || mandateId === null) {
      return admitted.length === 0
        ? { kind: "OK", items: [] }
        : { kind: "NO_MANDATE" };
    }

    const inputs = await dependencies.inputs.read({
      actor,
      investorOrganisationId: subject.investorOrganisationId,
      mandateId,
      companyIds: admitted.map((r) => r.companyId),
    });
    const now = clock();
    const computedAt = now.toISOString();
    const items: FitProfileItem[] = [];
    for (const result of admitted) {
      const input = inputs.get(result.companyId);
      if (input === undefined) continue;
      const observed = observeFit({
        companyId: result.companyId,
        snapshot: input.snapshot,
        declared: input.declared,
        eligibilityReasons: result.reasonCodes,
        config,
        now,
      });
      items.push({
        assessment: assessFit(observed, config, computedAt),
        name: input.name,
        line: input.line,
      });
    }
    // Request order, as eligibility returned it.
    return { kind: "OK", items };
  };

  return {
    profiles,
    top: async (actor, limit) => {
      const listed = await dependencies.candidates(actor);
      const sources = new Map<string, Set<FitCandidateSource>>();
      for (const c of listed.slice(0, FIT_TOP_CANDIDATES_MAX)) {
        const set = sources.get(c.companyId) ?? new Set();
        set.add(c.source);
        sources.set(c.companyId, set);
      }
      const result = await profiles(actor, [...sources.keys()]);
      if (result.kind !== "OK") return result;
      return {
        kind: "OK",
        comparison: buildFitComparison({
          items: result.items,
          sources,
          limit,
          config,
          computedAt: clock().toISOString(),
        }),
      };
    },
  };
}

const OUTCOME_RANK: Readonly<Record<FitOutcome, number>> = {
  STRONG: 3,
  PARTIAL: 2,
  MISMATCH: 1,
  UNKNOWN: 0,
};

/**
 * Top N, side by side. Q does not choose: this orders by the config's
 * tie-break, leaves out what a declared rule excludes and what is too
 * unknown to band, and marks a row's best only where one entry is
 * strictly better than every other (never on unknown).
 */
export function buildFitComparison(input: {
  readonly items: readonly FitProfileItem[];
  readonly sources: ReadonlyMap<string, ReadonlySet<FitCandidateSource>>;
  readonly limit: number;
  readonly config: FitConfig;
  readonly computedAt: string;
}): FitComparisonDto {
  const outside = input.items.filter(
    (i) => i.assessment.profile.band === "OUTSIDE_MANDATE",
  ).length;
  const thin = input.items.filter(
    (i) => i.assessment.profile.band === "NOT_ENOUGH_INFORMATION",
  ).length;
  const ranked = input.items
    .filter(
      (i) =>
        i.assessment.profile.band !== "OUTSIDE_MANDATE" &&
        i.assessment.profile.band !== "NOT_ENOUGH_INFORMATION",
    )
    .sort((a, b) => compareAssessments(a.assessment, b.assessment))
    .slice(0, input.limit);

  const bestOn = (index: number): FitParameter[] =>
    ranked.length < 2
      ? []
      : FIT_PARAMETERS.filter((parameter) => {
          const rank = (i: number) => {
            const r = ranked[i]?.assessment.profile.parameters.find(
              (p) => p.parameter === parameter,
            );
            return r === undefined || !r.applicable
              ? 0
              : OUTCOME_RANK[r.outcome];
          };
          const mine = rank(index);
          return (
            mine > OUTCOME_RANK.MISMATCH &&
            ranked.every((_r, j) => j === index || rank(j) < mine)
          );
        });

  return FitComparisonDtoSchema.parse({
    configVersion: input.config.version,
    configLabel: input.config.label,
    parameters: [...FIT_PARAMETERS],
    entries: ranked.map((item, index) => ({
      position: index + 1,
      companyId: item.assessment.profile.companyId,
      name: item.name,
      line: item.line,
      sources: [
        ...(input.sources.get(item.assessment.profile.companyId) ?? ["FEED"]),
      ].sort(),
      profile: item.assessment.profile,
      bestOn: bestOn(index),
    })),
    considered: input.items.length,
    leftOut: { outsideMandate: outside, notEnoughInformation: thin },
    computedAt: input.computedAt,
  });
}

/** One profile, as plain text (Q's fallback where cards are not rendered). */
export function fitProfileText(name: string, profile: FitProfileDto): string {
  // ADR 0059: the score out of 10 beside the words, computed here from the
  // rows below (never by a model); none when too little is known.
  const score = fitScoreOutOf10(profile);
  const head = `${name}: ${score === null ? "" : `${score}/10 · `}${FIT_BAND_LABELS[profile.band]}, ${FIT_CONFIDENCE_LABELS[profile.confidence].toLowerCase()}.`;
  const rows = profile.parameters.map(
    (p) =>
      `- ${FIT_PARAMETER_LABELS[p.parameter]}: ${p.applicable ? FIT_OUTCOME_LABELS[p.outcome] : "No preference"}. ${p.reason}`,
  );
  return [head, ...rows].join("\n");
}

/** The comparison as plain text, best first. */
export function fitComparisonText(comparison: FitComparisonDto): string {
  if (comparison.entries.length === 0) {
    return `None of the ${comparison.considered} companies you can compare has enough known to rank yet.`;
  }
  const parts = comparison.entries.map(
    (e) => `${e.position}. ${fitProfileText(e.name, e.profile)}`,
  );
  return [
    ...parts,
    `Ranked by fit with your mandate only (fit rules version ${comparison.configLabel}). Unknown never counts against a company.`,
  ].join("\n\n");
}
