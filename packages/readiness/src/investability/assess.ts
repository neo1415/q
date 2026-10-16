import { createHash } from "node:crypto";

import {
  InvestabilityDtoSchema,
  type InvestabilityBand,
  type InvestabilityDto,
  type ScoreFactor,
} from "@capital-q/contracts";

import {
  assessInvestIQV1,
  type InvestIQV1Assessment,
} from "../investiq/assess-v1.js";
import type { InvestIQObservation } from "../investiq/contracts.js";
import {
  GRADED_DIMENSIONS,
  INVESTIQ_V1,
  STAGE_WEIGHTS,
  type GradedDimension,
  type ReadinessBand,
} from "../investiq/method-v1.js";
import type { InvestabilityInputs } from "./inputs.js";
import {
  INVESTABILITY_INPUTS_VERSION,
  observeInvestability,
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

export const INVESTABILITY_METHOD_VERSION = `${INVESTIQ_V1.version}+${INVESTABILITY_INPUTS_VERSION}`;

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
  const assessment = assessInvestIQV1({
    companyRef: inputs.companyId,
    asOf,
    context,
    observations,
  });
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
    view: viewOf(assessment, observations),
    assessment,
    observations,
    basisHash,
  };
}

function viewOf(
  a: InvestIQV1Assessment,
  observations: readonly InvestIQObservation[],
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
  for (const d of a.dimensions) {
    for (const c of d.criteria) {
      if (!c.graded) continue;
      const evidence =
        c.strongestEvidenceStatus === null
          ? ""
          : ` · ${EVIDENCE_WORDS[c.strongestEvidenceStatus] ?? ""}`;
      const statement =
        c.observationIds.map((id) => byId.get(id)).find((o) => o !== undefined)
          ?.statement ?? c.label;
      if (c.state === "CONFLICTED") {
        withheld.push({
          label: c.label,
          detail: "Contradictory evidence: withheld until reconciled",
        });
      } else if (c.state === "SCORED" && c.score !== null) {
        rows.push({
          score: c.score,
          weight: weightOf(d.dimension),
          factor: {
            label: c.label,
            detail: `${statement}${evidence}`.slice(0, 200),
          },
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

  const scored =
    overall.status === "BANDED" &&
    overall.score !== null &&
    overall.band !== null;
  return InvestabilityDtoSchema.omit({ assessedAt: true }).parse({
    status: scored ? "SCORED" : "INSUFFICIENT_EVIDENCE",
    score:
      scored && overall.score !== null
        ? Math.round(overall.score * INVESTABILITY_SCALE)
        : null,
    band: scored && overall.band !== null ? BAND_WORDS[overall.band] : null,
    confidence: scored ? overall.confidence : null,
    cappedByConfidence: overall.cappedByConfidence,
    coverage: {
      areasScored: scoredAreas.length,
      areasTotal: applicable.length,
      criteriaScored: applicable.reduce((s, d) => s + d.scoredCriteria, 0),
      criteriaApplicable: applicable.reduce(
        (s, d) => s + d.applicableGradedCriteria,
        0,
      ),
    },
    stage: a.stageBand === null ? null : (STAGE_WORDS[a.stageBand] ?? null),
    up,
    down,
    missing: missing.slice(0, 4),
    methodVersion: INVESTABILITY_METHOD_VERSION,
  });
}

/** Graded dimensions, in the order every surface shows them. */
export const INVESTABILITY_AREAS = GRADED_DIMENSIONS;
