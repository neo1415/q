import { createHash } from "node:crypto";

import {
  InvestabilityDtoSchema,
  type InvestabilityBand,
  type InvestabilityDto,
  type ScoreFactor,
} from "@capital-q/contracts";

import {
  assessInvestIQV1,
  bandOf,
  INVESTIQ_V2_ARITHMETIC,
  observationWeight,
  type InvestIQV1Assessment,
} from "../investiq/assess-v1.js";
import type { InvestIQObservation } from "../investiq/contracts.js";
import {
  GRADED_DIMENSIONS,
  STAGE_WEIGHTS,
  type GradedDimension,
  type ReadinessBand,
} from "../investiq/method-v1.js";
import {
  INVESTOR_ELIGIBLE_SCOPES,
  type InvestabilityInputs,
} from "./inputs.js";
import {
  INVESTABILITY_INPUTS_VERSION,
  observeInvestability,
  PITCH_REF,
  UNCONFIRMED_DECK_REF,
} from "./observe.js";

/**
 * Investability: FDN InvestIQ v1, investor-facing (owner 2026-10-16).
 *
 *   inputs (investor-eligible only) -> observations (investability-inputs.v1)
 *   -> assessInvestIQV1 (weights, anchors, evidence multipliers, coverage
 *   gates, confidence: method-v1.ts) -> the investor's view.
 *
 * Score = InvestIQ overall 0-4 × 25, rounded once to an integer (no
 * decimals: no false precision). Shown only when InvestIQ bands the
 * company (stage known, >= 60% of the stage weight scored, Team and
 * Business Fundamentals scored); otherwise INSUFFICIENT_EVIDENCE with the
 * coverage and what is missing. Confidence is InvestIQ's discrete level and
 * is never multiplied into the score.
 *
 * Pure: the caller supplies `asOf`. The basis hash covers the method, the
 * input rules and the observations, never the clock, so an unchanged
 * company is never re-recorded.
 */

/** investiq/v2 arithmetic (no shrinkage; evidence drives confidence and range). */
export const INVESTABILITY_METHOD_VERSION = `${INVESTIQ_V2_ARITHMETIC.version}+${INVESTABILITY_INPUTS_VERSION}`;

export const INVESTABILITY_SCALE = 25;

const BAND_WORDS: Readonly<Record<ReadinessBand, InvestabilityBand>> = {
  STRONG: "STRONG",
  READY: "INVESTABLE",
  DEVELOPING: "DEVELOPING",
  NOT_YET_READY: "EARLY",
};

export const DIMENSION_LABELS: Readonly<Record<GradedDimension, string>> = {
  MANAGEMENT_AND_TEAM: "Management & team",
  BUSINESS_FUNDAMENTALS: "Business fundamentals",
  COMMERCIAL_STRENGTH: "Commercial strength",
  FINANCIAL_READINESS: "Financial readiness",
  GOVERNANCE: "Governance",
  LEGAL_AND_CORPORATE: "Legal & corporate",
  INVESTMENT_CASE: "Investment case",
  DILIGENCE_READINESS: "Diligence readiness",
};

const DIMENSION_ASKS: Readonly<Record<GradedDimension, string>> = {
  MANAGEMENT_AND_TEAM:
    "founder backgrounds and the team, shared with investors",
  BUSINESS_FUNDAMENTALS:
    "market, product and business model in a confirmed deck",
  COMMERCIAL_STRENGTH: "dated traction and customer figures",
  FINANCIAL_READINESS: "historical financials, forecasts or runway",
  GOVERNANCE: "board and reporting arrangements",
  LEGAL_AND_CORPORATE: "verified incorporation, IP and licences",
  INVESTMENT_CASE: "the raise, instrument and use of funds",
  DILIGENCE_READINESS: "a data room shared with investors",
};

const STAGE_WORDS: Readonly<Record<string, string>> = {
  PRE_SEED: "Pre-seed",
  SEED: "Seed",
  SERIES_A: "Series A",
  GROWTH: "Growth",
};

const EVIDENCE_WORDS: Readonly<Record<string, string>> = {
  NO_EVIDENCE: "no evidence",
  SELF_REPORTED: "self-reported",
  DOCUMENT_SUPPORTED: "document-supported",
  MULTI_SOURCE_SUPPORTED: "several sources",
  EXTERNALLY_VERIFIED: "externally verified",
  PLATFORM_VERIFIED: "verified by Capital Q",
};

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export type InvestabilityResult = {
  /** The investor's view, without its timestamp (the store adds it). */
  readonly view: Omit<InvestabilityDto, "assessedAt">;
  readonly assessment: InvestIQV1Assessment;
  readonly observations: readonly InvestIQObservation[];
  /** Method + input rules + context + observations; never the clock. */
  readonly basisHash: string;
};

export function assessInvestability(
  inputs: InvestabilityInputs,
  asOf: string,
): InvestabilityResult {
  const observations = observeInvestability(inputs);
  const context = {
    stageCode: inputs.stageCode,
    sectorCodes: [...inputs.sectorCodes].sort().slice(0, 20),
    businessModel: [...inputs.businessModelCodes].sort()[0] ?? null,
    instrument: null,
  };
  const assessment = assessInvestIQV1(
    {
      companyRef: inputs.companyId,
      asOf,
      context,
      observations,
    },
    INVESTIQ_V2_ARITHMETIC,
  );
  const basisHash = createHash("sha256")
    .update(INVESTABILITY_METHOD_VERSION)
    .update("\n")
    .update(
      stable({
        context,
        observations: [...observations].sort((a, b) =>
          a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
        ),
      }),
    )
    .digest("hex");
  return {
    view: viewOf(assessment, observations, hasMaterial(inputs)),
    assessment,
    observations,
    basisHash,
  };
}

/** Is there anything investor-visible to read beyond the bare profile? */
function hasMaterial(inputs: InvestabilityInputs): boolean {
  const readable = (sections: readonly { readonly status: string }[]) =>
    sections.some((s) => s.status !== "NOT_IN_DECK" && s.status !== "UNCLEAR");
  const deck =
    inputs.deck !== null &&
    (readable(inputs.deck.sections) || readable(inputs.deck.unconfirmed ?? []));
  const pitch = inputs.pitch !== null && inputs.pitch !== undefined;
  const claims = inputs.claims.some((c) =>
    (INVESTOR_ELIGIBLE_SCOPES as readonly string[]).includes(c.visibilityScope),
  );
  return deck || pitch || claims;
}

/**
 * ADR 0075: the score shown when InvestIQ's full gates are not met. The
 * same criterion scores, each weighted by its dimension's stage weight
 * shared over that dimension's applicable criteria, averaged over the
 * criteria with evidence. Unknown criteria stay out (never zero). Stage
 * unknown: equal dimension weights, and no stage-specific readings.
 */
/**
 * Lead 2026-10-16 (ADR 0075 amendment): the point estimate reads only
 * content-graded criteria (a fact graded against the stage benchmark);
 * criteria merely on record count toward coverage and confidence, never
 * toward the number, so presence cannot pull every company to the stage
 * norm. With nothing content-graded the record-only score (the norm) is
 * used.
 *
 *   banded       stage-weighted mean over dimensions with a graded
 *                criterion, each dimension the mean of its graded criteria
 *   provisional  each graded criterion weighted by its dimension's stage
 *                weight shared over the dimension's applicable criteria
 */
/**
 * Credibility by how many factors are graded (not by evidence weight): one
 * graded factor cannot make a company Strong or Early on its own. The
 * graded mean's distance from the stage norm (2) counts in full from four
 * graded factors: z = min(1, n / 4).
 */
export const FULL_CREDIBILITY_FACTORS = 3;

function pointEstimate(
  a: InvestIQV1Assessment,
  graded: ReadonlySet<string>,
  banded: boolean,
): number | null {
  // One weighting for every company, whatever the coverage gates say: a
  // graded fact counts by its dimension's stage weight shared over the
  // dimension's applicable criteria. The gates decide confidence and the
  // "early read" label, never which facts count.
  void banded;
  const raw = gradedMean(a, graded, false);
  if (raw === null) return null;
  const n = [...graded].filter((key) =>
    a.dimensions.some((d) =>
      d.criteria.some(
        (c) => c.criterion === key && c.graded && c.state === "SCORED",
      ),
    ),
  ).length;
  if (n === 0) return raw;
  const z = Math.min(1, n / FULL_CREDIBILITY_FACTORS);
  return 2 + (raw - 2) * z;
}

function gradedMean(
  a: InvestIQV1Assessment,
  graded: ReadonlySet<string>,
  banded: boolean,
): number | null {
  const weights = a.stageBand === null ? null : STAGE_WEIGHTS[a.stageBand];
  const scoredGraded = (d: InvestIQV1Assessment["dimensions"][number]) =>
    d.criteria.filter(
      (c) =>
        c.graded &&
        c.state === "SCORED" &&
        c.score !== null &&
        graded.has(c.criterion),
    );
  if (banded) {
    let total = 0;
    let sum = 0;
    for (const d of a.dimensions) {
      const cs = scoredGraded(d);
      if (cs.length === 0 || d.status !== "SCORED") continue;
      const w = weights === null ? 1 : weights[d.dimension];
      total += w;
      sum += (w * cs.reduce((s, c) => s + (c.score ?? 0), 0)) / cs.length;
    }
    if (total > 0) return sum / total;
    return a.overall.score;
  }
  let total = 0;
  let sum = 0;
  for (const d of a.dimensions) {
    if (d.applicableGradedCriteria === 0) continue;
    const each =
      (weights === null ? 1 : weights[d.dimension]) /
      d.applicableGradedCriteria;
    for (const c of scoredGraded(d)) {
      total += each;
      sum += each * (c.score ?? 0);
    }
  }
  return total > 0 ? sum / total : provisionalScore(a);
}

function provisionalScore(a: InvestIQV1Assessment): number | null {
  const weights = a.stageBand === null ? null : STAGE_WEIGHTS[a.stageBand];
  let total = 0;
  let sum = 0;
  for (const d of a.dimensions) {
    if (d.applicableGradedCriteria === 0) continue;
    const dimensionWeight = weights === null ? 1 : weights[d.dimension];
    const each = dimensionWeight / d.applicableGradedCriteria;
    for (const c of d.criteria) {
      if (!c.graded || c.state !== "SCORED" || c.score === null) continue;
      total += each;
      sum += each * c.score;
    }
  }
  return total === 0 ? null : sum / total;
}

/**
 * The evidence range: each scored criterion's anchor ± 2 × (1 − w), where
 * w is its deciding observation's evidence weight (verified 1 → no width,
 * a founder claim 0.5 → ±1, Q's unconfirmed read 0.25 → ±1.5), clipped to
 * 0-4, then averaged with the provisional weights. Unknown criteria stay
 * out of it, as they stay out of the score.
 */
function evidenceRange(
  a: InvestIQV1Assessment,
  weightOfCriterion: ReadonlyMap<string, number>,
): { readonly low: number; readonly high: number } | null {
  const weights = a.stageBand === null ? null : STAGE_WEIGHTS[a.stageBand];
  let total = 0;
  let low = 0;
  let high = 0;
  for (const d of a.dimensions) {
    if (d.applicableGradedCriteria === 0) continue;
    const each =
      (weights === null ? 1 : weights[d.dimension]) /
      d.applicableGradedCriteria;
    for (const c of d.criteria) {
      if (!c.graded || c.state !== "SCORED" || c.score === null) continue;
      const half = 2 * (1 - (weightOfCriterion.get(c.criterion) ?? 0.25));
      total += each;
      low += each * Math.max(0, c.score - half);
      high += each * Math.min(4, c.score + half);
    }
  }
  return total === 0 ? null : { low: low / total, high: high / total };
}

/** What a factor line may say: confirmed facts are quoted, the rest named only. */
function factorDetail(
  top: InvestIQObservation | undefined,
  fallback: string,
): string {
  const ref = top?.provenance.sourceRef ?? "";
  if (ref.startsWith(UNCONFIRMED_DECK_REF)) {
    return "From their own deck, not yet confirmed";
  }
  if (ref.startsWith(PITCH_REF)) return "Stated in their pitch video";
  const evidence =
    top === undefined ? "" : ` · ${EVIDENCE_WORDS[top.evidenceStatus] ?? ""}`;
  return `${top?.statement ?? fallback}${evidence}`.slice(0, 200);
}

function viewOf(
  a: InvestIQV1Assessment,
  observations: readonly InvestIQObservation[],
  material: boolean,
): Omit<InvestabilityDto, "assessedAt"> {
  const byId = new Map(observations.map((o) => [o.id, o] as const));
  const weights = a.stageBand === null ? null : STAGE_WEIGHTS[a.stageBand];
  const weightOf = (d: GradedDimension) => weights?.[d] ?? 0;
  const applicable = a.dimensions.filter((d) => d.status !== "NOT_APPLICABLE");
  const scoredAreas = applicable.filter((d) => d.status === "SCORED");

  type Row = {
    readonly score: number;
    readonly weight: number;
    readonly factor: ScoreFactor;
  };
  const rows: Row[] = [];
  const withheld: ScoreFactor[] = [];
  let unconfirmedOnly = 0;
  const deciding = new Map<string, number>();
  const contentGraded = new Set<string>();
  for (const d of a.dimensions) {
    for (const c of d.criteria) {
      if (!c.graded) continue;
      // The observation that decided the criterion: the highest weight.
      const top = c.observationIds
        .map((id) => byId.get(id))
        .filter((o): o is InvestIQObservation => o !== undefined)
        .sort((x, y) => observationWeight(y) - observationWeight(x))[0];
      if (c.state === "CONFLICTED") {
        withheld.push({
          label: c.label,
          detail: "Contradictory evidence: withheld until reconciled",
        });
      } else if (c.state === "SCORED" && c.score !== null) {
        if (top !== undefined)
          deciding.set(c.criterion, observationWeight(top));
        if (top?.anchor !== undefined) contentGraded.add(c.criterion);
        const ref = top?.provenance.sourceRef ?? "";
        if (ref.startsWith(UNCONFIRMED_DECK_REF) || ref.startsWith(PITCH_REF)) {
          unconfirmedOnly += 1;
        }
        rows.push({
          score: c.score,
          weight: weightOf(d.dimension),
          factor: { label: c.label, detail: factorDetail(top, c.label) },
        });
      }
    }
  }
  const byMerit = (sign: 1 | -1) => (x: Row, y: Row) =>
    sign * (y.score - x.score) ||
    y.weight - x.weight ||
    (x.factor.label < y.factor.label ? -1 : 1);
  const up = rows
    .filter((r) => r.score > 2)
    .sort(byMerit(1))
    .slice(0, 3)
    .map((r) => r.factor);
  const down = [
    ...rows
      .filter((r) => r.score < 2)
      .sort(byMerit(-1))
      .map((r) => r.factor),
    ...withheld,
  ].slice(0, 3);

  const missing: string[] = [];
  if (a.stageBand === null) missing.push("Stage: not stated on the profile");
  if (unconfirmedOnly > 0) {
    missing.push(
      "The founder confirming Q's reading of their deck would raise confidence",
    );
  }
  const thin = applicable
    .filter((d) => d.status === "INSUFFICIENT_EVIDENCE")
    .sort(
      (x, y) =>
        weightOf(y.dimension) - weightOf(x.dimension) ||
        (x.dimension < y.dimension ? -1 : 1),
    );
  for (const d of thin) {
    missing.push(
      `${DIMENSION_LABELS[d.dimension]}: ${DIMENSION_ASKS[d.dimension]}`,
    );
  }
  const overall = a.overall;
  if (
    overall.status === "BANDED" &&
    overall.confidence !== "HIGH" &&
    missing.length < 4
  ) {
    missing.push(
      "Document-supported or verified evidence would raise confidence",
    );
  }

  const coverage = {
    areasScored: scoredAreas.length,
    areasTotal: applicable.length,
    criteriaScored: applicable.reduce((s, d) => s + d.scoredCriteria, 0),
    criteriaApplicable: applicable.reduce(
      (s, d) => s + d.applicableGradedCriteria,
      0,
    ),
  };
  const common = {
    coverage,
    stage: a.stageBand === null ? null : (STAGE_WORDS[a.stageBand] ?? null),
    up,
    down,
    missing: missing.slice(0, 4),
    methodVersion: INVESTABILITY_METHOD_VERSION,
  };
  const viewSchema = InvestabilityDtoSchema.omit({ assessedAt: true });
  const range = evidenceRange(a, deciding);
  const rangeAround = (score: number) =>
    range === null
      ? {}
      : {
          range: {
            low: Math.min(score, Math.round(range.low * INVESTABILITY_SCALE)),
            high: Math.max(score, Math.round(range.high * INVESTABILITY_SCALE)),
          },
        };
  const parse = (value: unknown) => viewSchema.parse(value);

  if (!material) {
    return parse({
      ...common,
      status: "NO_MATERIAL",
      score: null,
      band: null,
      confidence: null,
      cappedByConfidence: false,
      provisional: false,
    });
  }
  if (
    overall.status === "BANDED" &&
    overall.score !== null &&
    overall.band !== null
  ) {
    // Score and confidence are separate (lead 2026-10-16): the band says
    // where the score is; confidence says how far to trust it.
    const point = pointEstimate(a, contentGraded, true) ?? overall.score;
    const score = Math.round(point * INVESTABILITY_SCALE);
    return parse({
      ...common,
      status: "SCORED",
      score,
      ...rangeAround(score),
      band: BAND_WORDS[bandOf(point)],
      confidence: overall.confidence,
      cappedByConfidence: false,
      provisional: false,
    });
  }
  // ADR 0075: always a number when there is material; a thin basis is
  // Low confidence and the band is held at Developing at most.
  const provisional = pointEstimate(a, contentGraded, false);
  if (provisional === null) {
    return parse({
      ...common,
      status: "INSUFFICIENT_EVIDENCE",
      score: null,
      band: null,
      confidence: null,
      cappedByConfidence: false,
      provisional: false,
    });
  }
  const score = Math.round(provisional * INVESTABILITY_SCALE);
  return parse({
    ...common,
    status: "SCORED",
    score,
    ...rangeAround(score),
    band: BAND_WORDS[bandOf(provisional)],
    confidence: "LOW",
    cappedByConfidence: false,
    provisional: true,
  });
}

/** Graded dimensions, in the order every surface shows them. */
export const INVESTABILITY_AREAS = GRADED_DIMENSIONS;
