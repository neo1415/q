import {
  UNICORN_POTENTIAL_CAVEAT,
  FIT_BAND_LABELS,
  FIT_CONFIDENCE_LABELS,
  FIT_OUTCOME_LABELS,
  FIT_PARAMETER_LABELS,
  FIT_COMPARISON_MAX,
  FIT_PARAMETERS,
  fitScoreOutOf10,
  FitComparisonDtoSchema,
  INVESTABILITY_BAND_LABELS,
  investabilityLine,
  notAssessedInvestability,
  SCORE_CONFIDENCE_LABELS,
  suitabilityFromFit,
  suitabilityLine,
  type CompanyScoresDto,
  type InvestabilityDto,
  type UnicornPotentialDto,
  type FitCandidateSource,
  type FitChequeUnknownReason,
  type FitComparisonDto,
  type FitOutcome,
  type FitParameter,
  type FitProfileDto,
} from "@capital-q/contracts";
import type { Logger } from "@capital-q/observability";
import type { ActorContext } from "@capital-q/security";

import {
  ELIGIBILITY_BATCH_MAX,
  type EligibilityReasonCode,
} from "../eligibility/contracts.js";
import type { EligibilityService } from "../eligibility/service.js";
import type { FitEvidenceLine } from "./stated.js";
import type { RecommendationFeatureSnapshot } from "../features/contracts.js";

import { FIT_CONFIG_CURRENT, type FitConfig } from "./config.js";
import {
  assessFit,
  compareAssessments,
  notApplicableObservation,
  type FitAssessment,
} from "./model.js";
import { compareFitOrder, fitOrderScore } from "./order.js";
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
  /** What the company does, in its own one line, where this reader may see it. */
  readonly about?: string | null | undefined;
  /** The current raise, only where disclosure lets this reader see it. */
  readonly raise?:
    { readonly amount: string; readonly currency: string } | null | undefined;
  /** What the company stated where this reader may see it; never scored. */
  readonly evidence?: readonly FitEvidenceLine[] | undefined;
  /** That evidence came through a grant: models read it only as CONFIDENTIAL. */
  readonly evidenceConfidential?: boolean | undefined;
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
    /**
     * RANK: only what the score reads (owner 2026-10-24, egress
     * incident); no one-liners, no stated evidence. Absent: everything.
     */
    readonly purpose?: "RANK" | undefined;
  }) => Promise<ReadonlyMap<string, FitCompanyInputs>>;
};

export type FitServiceDependencies = {
  /** Visible canonical names for company assessments before mandate setup. */
  readonly companyIdentities?:
    | ((
        ids: readonly string[],
      ) => Promise<ReadonlyMap<string, { readonly name: string }>>)
    | undefined;
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
  /**
   * F5 (2026-10-08): of these companies, the unclaimed public profiles: a
   * real company shared with the network (network_visible / public_external)
   * that nobody has joined yet. PADL marketplace activation keeps them out
   * of Discover (readiness `not_assessed`), but an investor who finds one
   * through search may read its fit, computed from its public facts only
   * (it holds no founder-private material). Absent: none are.
   */
  readonly unclaimedPublic?:
    | ((companyIds: readonly string[]) => Promise<ReadonlySet<string>>)
    | undefined;
  /**
   * 2026-10-16: each admitted company's Investability (InvestIQ, from the
   * investor-eligible projection), read only after eligibility admitted
   * it. Absent: every company reads NOT_ASSESSED.
   */
  readonly investability?:
    | ((
        companyIds: readonly string[],
      ) => Promise<ReadonlyMap<string, InvestabilityDto>>)
    | undefined;
  /** Premium read, reauthorized for this actor after company eligibility. */
  readonly unicornPotential?:
    | ((
        actor: ActorContext,
        companyIds: readonly string[],
      ) => Promise<ReadonlyMap<string, UnicornPotentialDto>>)
    | undefined;
  /** The method label a NOT_ASSESSED company is shown under. */
  readonly investabilityMethodVersion?: string | undefined;
  readonly config?: FitConfig | undefined;
  readonly clock?: (() => Date) | undefined;
  readonly logger?: Logger | undefined;
};

/** F5: how the fit line names an unclaimed public profile. */
export const UNCLAIMED_PUBLIC_PROFILE_LABEL = "Unclaimed public profile";

export type FitProfileItem = {
  readonly assessment: FitAssessment;
  readonly name: string;
  readonly line: string | null;
  readonly about?: string | null | undefined;
  readonly raise?:
    { readonly amount: string; readonly currency: string } | null | undefined;
  /** For Q's view: what the company stated where this reader may see it. */
  readonly evidence?: readonly FitEvidenceLine[] | undefined;
  readonly evidenceConfidential?: boolean | undefined;
  /** Investability and Suitability: two scores, never blended. */
  readonly scores?: CompanyScoresDto | undefined;
};

export type FitProfilesResult =
  | { readonly kind: "OK"; readonly items: readonly FitProfileItem[] }
  | { readonly kind: "NOT_INVESTOR" }
  | { readonly kind: "NO_MANDATE" };

export type FitTopResult =
  | {
      readonly kind: "OK";
      readonly comparison: FitComparisonDto;
      /** rank only: where its time went, by phase (ms), for the log. */
      readonly phasesMs?: Readonly<Record<string, number>> | undefined;
    }
  | { readonly kind: "NOT_INVESTOR" }
  | { readonly kind: "NO_MANDATE" };

export type FitService = {
  readonly profiles: (
    actor: ActorContext,
    companyIds: readonly string[],
  ) => Promise<FitProfilesResult>;
  readonly top: (actor: ActorContext, limit: number) => Promise<FitTopResult>;
  /**
   * Owner 2026-10-23: companies of a kind (the catalog's matches, already
   * through hard eligibility and disclosure), every one scored on this
   * investor's mandate and returned in fit order, the first `limit`. None
   * is left out for its band: an unscored company is listed after the
   * scored ones, never dropped. At most FIT_RANK_CANDIDATES_MAX are scored.
   */
  readonly rank?: (
    actor: ActorContext,
    companyIds: readonly string[],
    limit: number,
  ) => Promise<FitTopResult>;
  /**
   * Q.10: the companies the investor picked (2-4, from Saved), side by
   * side on the same fit as the top three. Each is re-checked for VIEW
   * eligibility first; one they may not see is absent, never named.
   * `source` says where the companies came from (Saved by default; a
   * network discovery's cards are FEED, as its rank labels them).
   */
  readonly compare: (
    actor: ActorContext,
    companyIds: readonly string[],
    source?: FitCandidateSource,
  ) => Promise<FitTopResult>;
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
/**
 * F-82 (2026-10-24): rank scores every match of a kind on the network, so
 * its bound covers the whole catalog (463 listed live), never a first page
 * by name. Eligibility, inputs and scores are each one set-based read.
 */
export const FIT_RANK_CANDIDATES_MAX = 1000;
/** Companies per inputs read; under every per-call bound it reaches. */
export const FIT_INPUTS_BATCH_MAX = 100;

export function createFitService(
  dependencies: FitServiceDependencies,
): FitService {
  const config = dependencies.config ?? FIT_CONFIG_CURRENT;
  const clock = dependencies.clock ?? (() => new Date());

  const withScores = async (
    actor: ActorContext,
    items: readonly FitProfileItem[],
  ): Promise<Extract<FitProfilesResult, { kind: "OK" }>> => {
    const investability =
      dependencies.investability === undefined || items.length === 0
        ? new Map<string, InvestabilityDto>()
        : await dependencies
            .investability(items.map((i) => i.assessment.profile.companyId))
            .catch(() => new Map<string, InvestabilityDto>());
    const unicornPotential =
      dependencies.unicornPotential === undefined || items.length === 0
        ? new Map<string, UnicornPotentialDto>()
        : await dependencies.unicornPotential(
            actor,
            items.map((i) => i.assessment.profile.companyId),
          );
    const method = dependencies.investabilityMethodVersion ?? "investiq/v1";
    return {
      kind: "OK",
      items: items.map((item) => {
        const companyId = item.assessment.profile.companyId;
        return {
          ...item,
          scores: {
            companyId,
            investability:
              investability.get(companyId) ?? notAssessedInvestability(method),
            suitability: suitabilityFromFit(item.assessment.profile),
            ...(unicornPotential.get(companyId) === undefined
              ? {}
              : { unicornPotential: unicornPotential.get(companyId) }),
          },
        };
      }),
    };
  };

  const profiles = async (
    actor: ActorContext,
    companyIds: readonly string[],
    purpose?: "RANK",
    /** Owner 2026-10-25: where a rank's time goes, by phase (ms). */
    phases?: Record<string, number>,
  ): Promise<FitProfilesResult> => {
    let mark = performance.now();
    const lap = (phase: string): void => {
      const at = performance.now();
      if (phases !== undefined) {
        phases[phase] = Math.round((phases[phase] ?? 0) + at - mark);
      }
      mark = at;
    };
    const subject =
      await dependencies.investorSubject.investorOrganisationFor(actor);
    if (subject === null) return { kind: "NOT_INVESTOR" };
    const ids = [...new Set(companyIds)];
    if (ids.length === 0) return { kind: "OK", items: [] };

    // F-82 (live 2026-10-24): eligibility takes at most
    // ELIGIBILITY_BATCH_MAX ids per call and throws past it; a rank over
    // the whole network (463 live) asks in batches, one after another.
    // Owner 2026-10-25: the batches are evaluated side by side (at most
    // five), their results kept in order.
    lap("subject");
    const chunks: string[][] = [];
    for (let start = 0; start < ids.length; start += ELIGIBILITY_BATCH_MAX) {
      chunks.push(ids.slice(start, start + ELIGIBILITY_BATCH_MAX));
    }
    const evaluation = {
      results: (
        await Promise.all(
          chunks.map((companyIds) =>
            dependencies.eligibility.evaluate({
              actor,
              purpose: "VIEW",
              viewpoint: "ACTOR",
              companyIds,
            }),
          ),
        )
      ).flatMap((batch) => batch.results),
    };
    // F5: only marketplace participation stood in the way, and the company
    // is an unclaimed public profile: its fit is readable from public facts.
    const onlyNotReady = evaluation.results
      .filter(
        (r) =>
          r.reasonCodes.includes("COMPANY_NOT_MARKETPLACE_ELIGIBLE") &&
          r.reasonCodes.every(
            (code) =>
              code === "COMPANY_NOT_MARKETPLACE_ELIGIBLE" ||
              !NOT_VISIBLE.has(code),
          ),
      )
      .map((r) => r.companyId);
    const unclaimed =
      onlyNotReady.length === 0 || dependencies.unclaimedPublic === undefined
        ? new Set<string>()
        : await dependencies
            .unclaimedPublic(onlyNotReady)
            .catch(() => new Set<string>());
    const admitted = evaluation.results.filter(
      (r) =>
        unclaimed.has(r.companyId) ||
        !r.reasonCodes.some((code) => NOT_VISIBLE.has(code)),
    );
    const mandateId = admitted.find((r) => r.mandateId !== null)?.mandateId;
    const noMandate =
      admitted.length > 0 &&
      admitted.every(
        (r) =>
          r.mandateId === null || r.reasonCodes.some((c) => NO_MANDATE.has(c)),
      );
    if (noMandate || mandateId === undefined || mandateId === null) {
      if (admitted.length === 0) return { kind: "OK", items: [] };
      if (dependencies.companyIdentities === undefined)
        return { kind: "NO_MANDATE" };
      const names = await dependencies.companyIdentities(
        admitted.map((r) => r.companyId),
      );
      const computedAt = clock().toISOString();
      // A company assessment does not require an investor mandate. Suitability
      // stays unknown with no preferences; no synthetic mandate or fit is made.
      return withScores(
        actor,
        admitted.flatMap(({ companyId }) => {
          const identity = names.get(companyId);
          if (identity === undefined) return [];
          const observations = Object.fromEntries(
            FIT_PARAMETERS.map((parameter) => [
              parameter,
              notApplicableObservation(),
            ]),
          ) as Record<
            FitParameter,
            ReturnType<typeof notApplicableObservation>
          >;
          return [
            {
              assessment: assessFit(
                { companyId, observations, hardRule: null },
                config,
                computedAt,
              ),
              name: identity.name,
              line: null,
            },
          ];
        }),
      );
    }

    // F-82 (live bbb4b6773): the raise disclosure inside the inputs read is
    // bounded per call, so over the whole network the inputs are read in
    // batches, and a rank never fails for the size of the network.
    const admittedIds = admitted.map((r) => r.companyId);
    lap("eligibility");
    const parts: string[][] = [];
    for (
      let start = 0;
      start < admittedIds.length;
      start += FIT_INPUTS_BATCH_MAX
    ) {
      parts.push(admittedIds.slice(start, start + FIT_INPUTS_BATCH_MAX));
    }
    // Owner 2026-10-25: each batch is a handful of set reads now, so the
    // batches run side by side (at most ten), merged in order.
    const inputs = new Map<string, FitCompanyInputs>();
    for (const part of await Promise.all(
      parts.map((companyIds) =>
        dependencies.inputs.read({
          actor,
          investorOrganisationId: subject.investorOrganisationId,
          mandateId,
          companyIds,
          ...(purpose === undefined ? {} : { purpose }),
        }),
      ),
    )) {
      for (const [companyId, input] of part) inputs.set(companyId, input);
    }
    const now = clock();
    const computedAt = now.toISOString();
    const items: FitProfileItem[] = [];
    for (const result of admitted) {
      const input = inputs.get(result.companyId);
      if (input === undefined) continue;
      const isUnclaimed = unclaimed.has(result.companyId);
      const observed = observeFit({
        companyId: result.companyId,
        snapshot: input.snapshot,
        declared: input.declared,
        // Not being in Discover is not a declared rule of this investor.
        eligibilityReasons: isUnclaimed
          ? result.reasonCodes.filter(
              (code) => code !== "COMPANY_NOT_MARKETPLACE_ELIGIBLE",
            )
          : result.reasonCodes,
        config,
        now,
      });
      items.push({
        assessment: assessFit(observed, config, computedAt),
        name: input.name,
        line: isUnclaimed
          ? [input.line, UNCLAIMED_PUBLIC_PROFILE_LABEL]
              .filter((part): part is string => part !== null && part !== "")
              .join(" · ")
          : input.line,
        about: input.about ?? null,
        raise: input.raise ?? null,
        evidence: input.evidence ?? [],
        evidenceConfidential: input.evidenceConfidential ?? false,
      });
    }
    lap("inputs");
    // Owner 2026-10-25 (live 152f09980: a premium reader's rank spent
    // 11.9 s here, reading Unicorn Potential history for all 463): the fit
    // order never reads Investability or Unicorn Potential, so a ranking
    // reads neither; the companies it shows read them through their
    // profile.
    if (purpose === "RANK") {
      lap("scores");
      return { kind: "OK", items };
    }
    // Request order, as eligibility returned it. Scores are read only for
    // the companies eligibility admitted for this reader.
    const scored = await withScores(actor, items);
    lap("scores");
    return scored;
  };

  return {
    profiles,
    compare: async (actor, companyIds, source = "SAVED") => {
      const ids = [...new Set(companyIds)].slice(0, FIT_COMPARISON_MAX);
      const result = await profiles(actor, ids);
      if (result.kind !== "OK") return result;
      const sources = new Map<string, ReadonlySet<FitCandidateSource>>(
        result.items.map((item) => [
          item.assessment.profile.companyId,
          new Set<FitCandidateSource>([source]),
        ]),
      );
      return {
        kind: "OK",
        comparison: buildFitComparison({
          items: result.items,
          sources,
          limit: ids.length,
          config,
          computedAt: clock().toISOString(),
          keepAll: true,
        }),
      };
    },
    rank: async (actor, companyIds, limit) => {
      const ids = [...new Set(companyIds)].slice(0, FIT_RANK_CANDIDATES_MAX);
      const phasesMs: Record<string, number> = {};
      const result = await profiles(actor, ids, "RANK", phasesMs);
      if (result.kind !== "OK") return result;
      return {
        kind: "OK",
        phasesMs,
        comparison: buildFitComparison({
          items: result.items,
          sources: new Map(ids.map((id) => [id, new Set(["FEED" as const])])),
          // P0 (live a7b99c465): a comparison holds at most
          // FIT_COMPARISON_MAX entries; asked for the catalog's page of 24
          // it threw, on every network rank.
          limit: Math.min(limit, FIT_COMPARISON_MAX),
          config,
          computedAt: clock().toISOString(),
          keepAll: true,
        }),
      };
    },
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
  /**
   * Q.10: the investor picked these, so none is left out for being outside
   * the mandate or thin; each still shows its band in words.
   */
  readonly keepAll?: boolean | undefined;
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
        input.keepAll === true ||
        (i.assessment.profile.band !== "OUTSIDE_MANDATE" &&
          i.assessment.profile.band !== "NOT_ENOUGH_INFORMATION"),
    )
    // The same comparator as the Discover feed (fit-order.v1): a higher
    // score out of 10 is never listed below a lower one.
    // No base rank here, so the config's company-id fallback keeps the
    // order total and stable.
    .sort(
      (a, b) =>
        compareFitOrder(
          { assessment: a.assessment, score: fitOrderScore(a.assessment) },
          { assessment: b.assessment, score: fitOrderScore(b.assessment) },
        ) || compareAssessments(a.assessment, b.assessment),
    )
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
      about: item.about ?? null,
      raise: item.raise ?? null,
      sources: [
        ...(input.sources.get(item.assessment.profile.companyId) ?? ["FEED"]),
      ].sort(),
      profile: item.assessment.profile,
      ...(item.scores === undefined ? {} : { scores: item.scores }),
      bestOn: bestOn(index),
    })),
    considered: input.items.length,
    leftOut:
      input.keepAll === true
        ? { outsideMandate: 0, notEnoughInformation: 0 }
        : { outsideMandate: outside, notEnoughInformation: thin },
    computedAt: input.computedAt,
  });
}

/** One profile, as plain text (Q's fallback where cards are not rendered). */
/**
 * The two scores as one plain line, each with its coverage and confidence;
 * computed by code, repeated by Q, never blended.
 */
export function companyScoresText(scores: CompanyScoresDto): string {
  const inv = scores.investability;
  const invWords =
    inv.status === "SCORED" && inv.band !== null && inv.confidence !== null
      ? `${investabilityLine(inv)} (${INVESTABILITY_BAND_LABELS[inv.band]}, ${SCORE_CONFIDENCE_LABELS[inv.confidence].toLowerCase()})`
      : investabilityLine(inv);
  const suit =
    scores.suitability === null ? null : suitabilityLine(scores.suitability);
  const potential = scores.unicornPotential;
  const unicorn =
    potential === undefined
      ? null
      : `Unicorn Potential: ${potential.overallScore === null ? "insufficient evidence, no score" : `${potential.overallScore}/100`}; evidence coverage ${Math.round(potential.coverage * 100)}%; ${potential.confidence.toLowerCase()} confidence; method ${potential.methodVersion}. ${UNICORN_POTENTIAL_CAVEAT}`;
  return (
    [invWords, suit, unicorn].filter((part) => part !== null).join(". ") + "."
  );
}

export function fitProfileText(
  name: string,
  profile: FitProfileDto,
  options: {
    readonly summaryOnly?: boolean;
    readonly scores?: CompanyScoresDto | undefined;
  } = {},
): string {
  // ADR 0059: the score out of 10 beside the words, computed here from the
  // rows below (never by a model); none when too little is known.
  const score = fitScoreOutOf10(profile);
  const head = `${name}: ${score === null ? "" : `${score}/10 · `}${FIT_BAND_LABELS[profile.band]}, ${FIT_CONFIDENCE_LABELS[profile.confidence].toLowerCase()}.${options.scores === undefined ? "" : ` ${companyScoresText(options.scores)}`}`;
  if (options.summaryOnly === true) return head;
  const rows = profile.parameters.map(
    (p) =>
      `- ${FIT_PARAMETER_LABELS[p.parameter]}: ${p.applicable ? FIT_OUTCOME_LABELS[p.outcome] : "No preference"}. ${p.reason}${rowNote(p)}`,
  );
  return [head, ...rows].join("\n");
}

/**
 * Owner 23 Oct 2026: Q invented why cheque compatibility was unknown. The
 * row's exact reason travels as a code with its words, and an estimate
 * says it is one, so Q has nothing to fill in.
 */
const UNKNOWN_REASON_WORDS: Readonly<Record<FitChequeUnknownReason, string>> = {
  ROUND_NOT_SHARED:
    "the company has not shared a round size you may see (no Q Card raise, no disclosure, no amount in a pitch you may play)",
  CURRENCY_DIFFERS_NO_RATE:
    "the round and your cheque are in different currencies and no exchange rate could be fetched just now (both rate sources unreachable)",
};

function rowNote(p: FitProfileDto["parameters"][number]): string {
  if (p.unknownReason !== undefined) {
    return ` [why unknown: ${p.unknownReason}, ${UNKNOWN_REASON_WORDS[p.unknownReason]}; the only reason]`;
  }
  if (p.estimate !== undefined) {
    return ` [ESTIMATE: approximately, at the ${p.estimate.method === "ECB_REFERENCE_RATE" ? "ECB reference rate" : "market rate"} of ${p.estimate.rateDate}; not exact, not verified]`;
  }
  return "";
}

/** The comparison as plain text, best first. */
export function fitComparisonText(
  comparison: FitComparisonDto,
  options: { readonly summaryOnly?: boolean } = {},
): string {
  if (comparison.entries.length === 0) {
    return `None of the ${comparison.considered} companies you can compare has enough known to rank yet.`;
  }
  // The compact tool fallback accompanies complete typed profiles. Repeat
  // only their code-derived scores here, not each band/confidence/reason.
  // Unknown scores remain words; full prose and every profile stay intact.
  if (options.summaryOnly === true) {
    const scores = comparison.entries.map((entry) => {
      const score = fitScoreOutOf10(entry.profile);
      return `${entry.position}. ${entry.name}: ${score === null ? FIT_BAND_LABELS[entry.profile.band] : `${score}/10`}${entry.scores === undefined ? "" : ` · ${companyScoresText(entry.scores)}`}`;
    });
    return [
      ...scores,
      `Mandate fit, rules ${comparison.configLabel}. Unknown never counts against a company.`,
    ].join("\n");
  }
  const parts = comparison.entries.map(
    (e) =>
      `${e.position}. ${fitProfileText(e.name, e.profile, { ...options, scores: e.scores })}`,
  );
  return [
    ...parts,
    `Ranked by fit with your mandate only (fit rules version ${comparison.configLabel}). Unknown never counts against a company.`,
  ].join("\n\n");
}
