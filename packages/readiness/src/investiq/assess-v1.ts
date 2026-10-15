import { EvidenceStatusSchema } from "@capital-q/contracts";
import { z } from "zod";

import {
  exclusionOf,
  investiqInputHash,
  InvestIQInputError,
} from "./assess.js";
import {
  CORE_DIMENSIONS,
  CoreDimensionSchema,
  InvestIQInputSchema,
  type InvestIQObservation,
} from "./contracts.js";
import {
  BASELINE_ANCHOR,
  CONFIDENCE_RULES,
  COVERAGE_RULES,
  EVIDENCE_WEIGHT,
  GRADED_DIMENSIONS,
  INVESTIQ_V1,
  INVESTIQ_V1_CRITERIA,
  LIFECYCLE_WEIGHT,
  OUTPUT_GROUPS,
  READING_DEFAULT_ANCHOR,
  READINESS_BANDS,
  STAGE_BANDS,
  STAGE_WEIGHTS,
  stageBandOf,
  TRUTH_WEIGHT,
  type ConfidenceLevel,
  type GradedDimension,
  type ReadinessBand,
  type StageBand,
} from "./method-v1.js";

/**
 * FDN InvestIQ v1 (shadow). Pure: (input) -> assessment. No clock, model,
 * I/O or randomness. Pipeline, each step traced:
 *
 *  criterion  admissible observations (v0 exclusions) -> CONFLICTED
 *             (withheld) | NOT_APPLICABLE | UNKNOWN | scored. Score: for the
 *             observations with the highest evidence weight w (no volume
 *             bonus: ten copies of a deck are one source), the mean of
 *             2 + (anchor - 2) * w.
 *  dimension  mean of scored graded criteria when coverage >= 0.4, else
 *             INSUFFICIENT_EVIDENCE. Unknown leaves the mean; never zero.
 *  overall    stage-weighted mean over scored dimensions, renormalised,
 *             only when the stage is known, scored dimensions hold >= 60%
 *             of the stage weight, and Team + Fundamentals are scored.
 *             Business Quality and Investment Readiness get their own band
 *             by the same rule; neither is folded into the other.
 *  confidence discrete HIGH/MODERATE/LOW from coverage and evidence weight;
 *             one level lower with any open conflict. Never multiplied
 *             into the score; a band above DEVELOPING needs >= MODERATE.
 */

const BandSchema = z.enum(["NOT_YET_READY", "DEVELOPING", "READY", "STRONG"]);
const ConfidenceSchema = z.enum(["HIGH", "MODERATE", "LOW"]);
const Score = z.number().min(0).max(4);

const BandResultSchema = z
  .object({
    status: z.enum(["BANDED", "INSUFFICIENT_EVIDENCE"]),
    band: BandSchema.nullable(),
    /** Internal 0-4; never shown to users as a number (FDN p.7 no false precision). */
    score: Score.nullable(),
    confidence: ConfidenceSchema.nullable(),
    weightedCoverage: z.number().min(0).max(1),
    cappedByConfidence: z.boolean(),
    reasons: z.array(z.string()),
  })
  .strict();
export type InvestIQV1Band = z.infer<typeof BandResultSchema>;

const CriterionV1Schema = z
  .object({
    criterion: z.string(),
    label: z.string(),
    coreSeven: CoreDimensionSchema,
    graded: z.boolean(),
    state: z.enum(["NOT_APPLICABLE", "UNKNOWN", "CONFLICTED", "SCORED"]),
    score: Score.nullable(),
    evidenceWeight: z.number().min(0).max(1).nullable(),
    strongestEvidenceStatus: EvidenceStatusSchema.nullable(),
    observationIds: z.array(z.string()),
    knownUnknowns: z.array(z.string()),
  })
  .strict();

const DimensionV1Schema = z
  .object({
    dimension: z.enum(GRADED_DIMENSIONS),
    status: z.enum(["SCORED", "INSUFFICIENT_EVIDENCE", "NOT_APPLICABLE"]),
    score: Score.nullable(),
    band: BandSchema.nullable(),
    confidence: ConfidenceSchema.nullable(),
    coverage: z.number().min(0).max(1),
    applicableGradedCriteria: z.number().int().min(0),
    scoredCriteria: z.number().int().min(0),
    hasUnresolvedConflict: z.boolean(),
    criteria: z.array(CriterionV1Schema),
  })
  .strict();

export const InvestIQV1AssessmentSchema = z
  .object({
    method: z
      .object({
        version: z.literal("investiq/v1"),
        status: z.literal("OWNER_DELEGATED_PENDING_CALIBRATION"),
      })
      .strict(),
    companyRef: z.string(),
    asOf: z.string(),
    inputHash: z.string().regex(/^[0-9a-f]{64}$/),
    stageBand: z.enum(STAGE_BANDS).nullable(),
    weights: z.record(z.string(), z.number()).nullable(),
    dimensions: z.array(DimensionV1Schema).length(GRADED_DIMENSIONS.length),
    investorFit: z
      .object({
        status: z.literal("ROUTED_TO_DISCOVERY_FIT"),
        weight: z.literal(0),
      })
      .strict(),
    overall: BandResultSchema,
    businessQuality: BandResultSchema,
    investmentReadiness: BandResultSchema,
    coreSevenProjection: z.array(
      z
        .object({
          dimension: CoreDimensionSchema,
          score: Score.nullable(),
          coverage: z.number().min(0).max(1),
        })
        .strict(),
    ),
    notComputedHere: z.array(z.string()),
    trace: z.array(
      z
        .object({
          seq: z.number().int(),
          subject: z.string(),
          rule: z.string(),
          outcome: z.string(),
        })
        .strict(),
    ),
  })
  .strict();
export type InvestIQV1Assessment = z.infer<typeof InvestIQV1AssessmentSchema>;

/** Half-up to 2 decimals, once, at output. */
function round2(x: number): number {
  return Math.round((x + Number.EPSILON) * 100) / 100;
}

export function bandOf(score: number): ReadinessBand {
  let band: ReadinessBand = "NOT_YET_READY";
  for (const b of READINESS_BANDS) if (score >= b.min) band = b.band;
  return band;
}

const LEVELS: readonly ConfidenceLevel[] = ["LOW", "MODERATE", "HIGH"];

export function confidenceOf(
  coverage: number,
  quality: number,
  conflict: boolean,
): ConfidenceLevel {
  let level: ConfidenceLevel = "LOW";
  if (
    coverage >= CONFIDENCE_RULES.MODERATE.coverage &&
    quality >= CONFIDENCE_RULES.MODERATE.quality
  ) {
    level = "MODERATE";
  }
  if (
    coverage >= CONFIDENCE_RULES.HIGH.coverage &&
    quality >= CONFIDENCE_RULES.HIGH.quality
  ) {
    level = "HIGH";
  }
  if (conflict) {
    level =
      LEVELS[
        Math.max(0, LEVELS.indexOf(level) - CONFIDENCE_RULES.conflictDowngrade)
      ] ?? "LOW";
  }
  return level;
}

export function observationWeight(o: InvestIQObservation): number {
  if (o.truthClass === "UNKNOWN") return 0;
  if (
    o.lifecycleStatus === "SUPERSEDED" ||
    o.lifecycleStatus === "CONTRADICTORY" ||
    o.lifecycleStatus === "DISPUTED"
  ) {
    return 0;
  }
  return (
    EVIDENCE_WEIGHT[o.evidenceStatus] *
    TRUTH_WEIGHT[o.truthClass] *
    LIFECYCLE_WEIGHT[o.lifecycleStatus]
  );
}

function anchorOf(o: InvestIQObservation): number {
  const fallback = READING_DEFAULT_ANCHOR[o.reading];
  if (o.anchor === undefined) return fallback;
  const ok =
    o.reading === "INDICATES_WEAKNESS"
      ? o.anchor <= 1
      : o.reading === "SUPPORTS_STRENGTH"
        ? o.anchor >= 3
        : o.anchor === BASELINE_ANCHOR;
  if (!ok)
    throw new InvestIQInputError(
      `observation ${o.id}: anchor ${o.anchor} disagrees with ${o.reading}`,
    );
  return o.anchor;
}

function weightedBand(
  dims: readonly {
    dimension: GradedDimension;
    score: number | null;
    confidenceInputs: { coverage: number; quality: number; conflict: boolean };
  }[],
  members: readonly GradedDimension[],
  stage: StageBand | null,
  required: readonly GradedDimension[],
): InvestIQV1Band {
  const reasons: string[] = [];
  if (stage === null) {
    return {
      status: "INSUFFICIENT_EVIDENCE",
      band: null,
      score: null,
      confidence: null,
      weightedCoverage: 0,
      cappedByConfidence: false,
      reasons: ["STAGE_UNKNOWN"],
    };
  }
  const weights = STAGE_WEIGHTS[stage];
  const inScope = dims.filter((d) => members.includes(d.dimension));
  const total = inScope.reduce((s, d) => s + weights[d.dimension], 0);
  const scored = inScope.filter((d) => d.score !== null);
  const scoredWeight = scored.reduce((s, d) => s + weights[d.dimension], 0);
  const weightedCoverage = total === 0 ? 0 : scoredWeight / total;
  if (weightedCoverage < COVERAGE_RULES.weightedMin)
    reasons.push("WEIGHTED_COVERAGE_BELOW_MIN");
  for (const r of required) {
    if (!scored.some((d) => d.dimension === r))
      reasons.push(`REQUIRED_DIMENSION_UNSCORED:${r}`);
  }
  // Confidence over all in-scope dimensions, weighted by stage weight.
  const cov =
    total === 0
      ? 0
      : inScope.reduce(
          (s, d) => s + weights[d.dimension] * d.confidenceInputs.coverage,
          0,
        ) / total;
  const qual =
    scoredWeight === 0
      ? 0
      : scored.reduce(
          (s, d) => s + weights[d.dimension] * d.confidenceInputs.quality,
          0,
        ) / scoredWeight;
  const conflict = inScope.some((d) => d.confidenceInputs.conflict);
  if (reasons.length > 0) {
    return {
      status: "INSUFFICIENT_EVIDENCE",
      band: null,
      score: null,
      confidence: null,
      weightedCoverage: round2(weightedCoverage),
      cappedByConfidence: false,
      reasons,
    };
  }
  const score =
    scored.reduce((s, d) => s + weights[d.dimension] * (d.score ?? 0), 0) /
    scoredWeight;
  const confidence = confidenceOf(cov, qual, conflict);
  let band = bandOf(score);
  let capped = false;
  if (
    (band === "READY" || band === "STRONG") &&
    LEVELS.indexOf(confidence) <
      LEVELS.indexOf(CONFIDENCE_RULES.minForReadyBand)
  ) {
    band = "DEVELOPING";
    capped = true;
    reasons.push("CAPPED_BY_CONFIDENCE");
  }
  return {
    status: "BANDED",
    band,
    score: round2(score),
    confidence,
    weightedCoverage: round2(weightedCoverage),
    cappedByConfidence: capped,
    reasons,
  };
}

export function assessInvestIQV1(raw: unknown): InvestIQV1Assessment {
  const parsed = InvestIQInputSchema.safeParse(raw);
  if (!parsed.success) {
    throw new InvestIQInputError(
      parsed.error.issues.map((i) => i.message).join("; "),
    );
  }
  const input = parsed.data;
  const asOf = Date.parse(input.asOf);
  const defs = new Map(INVESTIQ_V1_CRITERIA.map((c) => [c.key, c]));
  const seen = new Set<string>();
  const byCriterion = new Map<string, InvestIQObservation[]>();
  for (const o of input.observations) {
    if (seen.has(o.id))
      throw new InvestIQInputError(`duplicate observation id ${o.id}`);
    seen.add(o.id);
    if (!defs.has(o.criterion))
      throw new InvestIQInputError(
        `unknown criterion ${o.criterion} for investiq/v1`,
      );
    if (
      o.provenance.observedAt !== null &&
      Date.parse(o.provenance.observedAt) > asOf
    ) {
      throw new InvestIQInputError(`observation ${o.id} is dated after asOf`);
    }
    anchorOf(o); // validate anchor/reading agreement up front
    byCriterion.set(o.criterion, [...(byCriterion.get(o.criterion) ?? []), o]);
  }

  const trace: InvestIQV1Assessment["trace"] = [];
  const step = (subject: string, rule: string, outcome: string) =>
    trace.push({ seq: trace.length + 1, subject, rule, outcome });

  const stage = stageBandOf(input.context.stageCode);
  step(
    "context",
    "stage.band",
    stage ?? "UNKNOWN: no stage weights, no overall band",
  );
  const early = stage === "PRE_SEED";

  const criterionResults = INVESTIQ_V1_CRITERIA.map((def) => {
    const all = [...(byCriterion.get(def.key) ?? [])].sort((a, b) =>
      a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
    );
    const admissible = all.filter((o) => exclusionOf(o) === null);
    const knownUnknowns = all
      .filter((o) => exclusionOf(o) === "TRUTH_UNKNOWN")
      .map((o) => o.statement);
    const strongest = admissible.reduce<
      InvestIQObservation["evidenceStatus"] | null
    >((best, o) => {
      const order = EvidenceStatusSchema.options;
      return best === null ||
        order.indexOf(o.evidenceStatus) > order.indexOf(best)
        ? o.evidenceStatus
        : best;
    }, null);
    const base = {
      criterion: def.key,
      label: def.label,
      coreSeven: def.coreSeven,
      graded: def.graded,
      strongestEvidenceStatus: strongest,
      observationIds: admissible.map((o) => o.id),
      knownUnknowns,
    };
    if (admissible.length === 0) {
      const rule = early
        ? INVESTIQ_V1.applicability.find((r) => r.criteria.includes(def.key))
        : undefined;
      step(
        def.key,
        rule?.id ?? "state.unknown",
        rule === undefined ? "UNKNOWN" : "NOT_APPLICABLE",
      );
      return {
        ...base,
        state:
          rule === undefined
            ? ("UNKNOWN" as const)
            : ("NOT_APPLICABLE" as const),
        score: null,
        evidenceWeight: null,
      };
    }
    const conflicted =
      admissible.some(
        (o) =>
          o.lifecycleStatus === "CONTRADICTORY" ||
          o.lifecycleStatus === "DISPUTED",
      ) ||
      (admissible.some((o) => o.reading === "SUPPORTS_STRENGTH") &&
        admissible.some((o) => o.reading === "INDICATES_WEAKNESS"));
    if (conflicted) {
      step(
        def.key,
        "state.conflicted",
        "CONFLICTED: withheld, investigate (PADL Ch4 #67)",
      );
      return {
        ...base,
        state: "CONFLICTED" as const,
        score: null,
        evidenceWeight: null,
      };
    }
    const weighted = admissible.map((o) => ({ o, w: observationWeight(o) }));
    const maxW = Math.max(...weighted.map((x) => x.w));
    const top = weighted.filter((x) => x.w === maxW);
    const score =
      top.reduce(
        (s, x) => s + BASELINE_ANCHOR + (anchorOf(x.o) - BASELINE_ANCHOR) * x.w,
        0,
      ) / top.length;
    step(
      def.key,
      "criterion.score",
      `${round2(score)} from ${top.length} top-evidence observation(s), w=${round2(maxW)}${def.graded ? "" : " (ungraded)"}`,
    );
    return {
      ...base,
      state: "SCORED" as const,
      score: round2(score),
      evidenceWeight: round2(maxW),
    };
  });

  const dimensionResults = GRADED_DIMENSIONS.map((dimension) => {
    const criteria = criterionResults.filter(
      (c) =>
        INVESTIQ_V1_CRITERIA.find((d) => d.key === c.criterion)?.dimension ===
        dimension,
    );
    const graded = criteria.filter(
      (c) => c.graded && c.state !== "NOT_APPLICABLE",
    );
    const scored = graded.filter((c) => c.state === "SCORED");
    const coverage = graded.length === 0 ? 0 : scored.length / graded.length;
    const quality =
      scored.length === 0
        ? 0
        : scored.reduce((s, c) => s + (c.evidenceWeight ?? 0), 0) /
          scored.length;
    const conflict = criteria.some((c) => c.state === "CONFLICTED");
    const status =
      graded.length === 0
        ? ("NOT_APPLICABLE" as const)
        : coverage >= COVERAGE_RULES.dimensionMin
          ? ("SCORED" as const)
          : ("INSUFFICIENT_EVIDENCE" as const);
    const score =
      status === "SCORED"
        ? scored.reduce((s, c) => s + (c.score ?? 0), 0) / scored.length
        : null;
    const confidence =
      status === "SCORED" ? confidenceOf(coverage, quality, conflict) : null;
    step(
      dimension,
      "dimension.coverage",
      `${scored.length}/${graded.length} scored -> ${status}`,
    );
    return {
      result: {
        dimension,
        status,
        score: score === null ? null : round2(score),
        band: score === null ? null : bandOf(score),
        confidence,
        coverage: round2(coverage),
        applicableGradedCriteria: graded.length,
        scoredCriteria: scored.length,
        hasUnresolvedConflict: conflict,
        criteria,
      },
      forBand: {
        dimension,
        score,
        confidenceInputs: { coverage, quality, conflict },
      },
    };
  });
  const forBand = dimensionResults.map((d) => d.forBand);

  const overall = weightedBand(
    forBand,
    GRADED_DIMENSIONS,
    stage,
    COVERAGE_RULES.requiredForOverall,
  );
  const businessQuality = weightedBand(
    forBand,
    OUTPUT_GROUPS.BUSINESS_QUALITY,
    stage,
    [],
  );
  const investmentReadiness = weightedBand(
    forBand,
    OUTPUT_GROUPS.INVESTMENT_READINESS,
    stage,
    [],
  );
  step(
    "overall",
    "band",
    overall.status === "BANDED"
      ? `${overall.band ?? ""} (${overall.confidence ?? ""})`
      : overall.reasons.join(","),
  );

  const coreSevenProjection = CORE_DIMENSIONS.map((dimension) => {
    const graded = criterionResults.filter(
      (c) =>
        c.coreSeven === dimension && c.graded && c.state !== "NOT_APPLICABLE",
    );
    const scored = graded.filter((c) => c.state === "SCORED");
    const coverage = graded.length === 0 ? 0 : scored.length / graded.length;
    const score =
      scored.length > 0 && coverage >= COVERAGE_RULES.dimensionMin
        ? scored.reduce((s, c) => s + (c.score ?? 0), 0) / scored.length
        : null;
    return {
      dimension,
      score: score === null ? null : round2(score),
      coverage: round2(coverage),
    };
  });

  return InvestIQV1AssessmentSchema.parse({
    method: { version: INVESTIQ_V1.version, status: INVESTIQ_V1.status },
    companyRef: input.companyRef,
    asOf: input.asOf,
    inputHash: investiqInputHash(INVESTIQ_V1.version, input),
    stageBand: stage,
    weights: stage === null ? null : { ...STAGE_WEIGHTS[stage] },
    dimensions: dimensionResults.map((d) => d.result),
    investorFit: { status: "ROUTED_TO_DISCOVERY_FIT", weight: 0 },
    overall,
    businessQuality,
    investmentReadiness,
    coreSevenProjection,
    notComputedHere: [
      "INVESTOR_FIT",
      "INTEREST",
      "MATCH",
      "RELATIONSHIP_STATE",
      "OUTCOME",
      "VALUATION",
      "CAPITAL_FORM_RECOMMENDATION",
    ],
    trace,
  });
}
