import {
  FIT_PARAMETERS,
  FitProfileDtoSchema,
  type EvidenceStatus,
  type FitBand,
  type FitConfidence,
  type FitHardRuleDto,
  type FitOutcome,
  type FitParameter,
  type FitParameterResultDto,
  type FitProfileDto,
} from "@capital-q/contracts";

import type { FitConfig } from "./config.js";
import { renderFitReason } from "./templates.js";

/**
 * The fit model (B1; ADR 0052): a pure function from observations to a
 * profile. No clock read, no I/O, no model. The same observations under
 * the same config give the same profile, byte for byte, apart from the
 * `computedAt` the caller passes.
 */

/** One parameter as observed for one company-investor pair. */
export type FitObservation = {
  readonly outcome: FitOutcome;
  /** False: the mandate declares nothing here. Counts toward neither value nor coverage. */
  readonly applicable: boolean;
  /** Evidence behind the company-side input; null when unknown or declared without a status. */
  readonly evidenceStatus: EvidenceStatus | null;
  readonly stale: boolean;
  /** Slot values for the reason sentence; only facts the reader may already see. */
  readonly facts: Readonly<Record<string, string | undefined>>;
};

export type FitInputs = {
  readonly companyId: string;
  readonly observations: Readonly<Record<FitParameter, FitObservation>>;
  /** Set only from a rule the investor declared (eligibility's hard criteria). */
  readonly hardRule: FitHardRuleDto | null;
};

export type FitAssessment = {
  readonly profile: FitProfileDto;
  /** Internal ordering value over known parameters; never shown. Null when nothing is known. */
  readonly value: number | null;
  /** Share of applicable weight that is known. */
  readonly coverage: number;
  /** Coverage discounted by evidence and freshness; the confidence word comes from it. */
  readonly confidenceScore: number;
};

/** An unknown observation; what every parameter is until an input says otherwise. */
export function unknownObservation(
  facts: Readonly<Record<string, string | undefined>> = {},
): FitObservation {
  return {
    outcome: "UNKNOWN",
    applicable: true,
    evidenceStatus: null,
    stale: false,
    facts,
  };
}

export function notApplicableObservation(): FitObservation {
  return {
    outcome: "UNKNOWN",
    applicable: false,
    evidenceStatus: null,
    stale: false,
    facts: {},
  };
}

function round(value: number, precision: number): number {
  const f = 10 ** precision;
  return Math.round(value * f) / f;
}

export function assessFit(
  inputs: FitInputs,
  config: FitConfig,
  computedAt: string,
): FitAssessment {
  let applicableWeight = 0;
  let knownWeight = 0;
  let weighted = 0;
  let evidenced = 0;
  const results: FitParameterResultDto[] = [];

  for (const entry of config.parameters) {
    const o = inputs.observations[entry.parameter];
    if (o.applicable) applicableWeight += entry.weight;
    const outcome = o.outcome;
    const known = o.applicable && outcome !== "UNKNOWN";
    if (o.applicable && outcome !== "UNKNOWN") {
      knownWeight += entry.weight;
      weighted += entry.weight * entry.values[outcome];
      const factor =
        o.evidenceStatus === null
          ? config.confidence.undeclaredEvidenceFactor
          : (config.confidence.evidenceFactor[o.evidenceStatus] ?? 0);
      evidenced +=
        entry.weight * factor * (o.stale ? config.confidence.staleFactor : 1);
    }
    results.push({
      parameter: entry.parameter,
      outcome: o.outcome,
      reason: renderFitReason(
        entry.parameter,
        o.applicable ? o.outcome : "NO_PREFERENCE",
        o.facts,
      ),
      evidenceStatus: known ? o.evidenceStatus : null,
      stale: known && o.stale,
      applicable: o.applicable,
    });
  }

  const p = config.precision;
  const value = knownWeight > 0 ? round(weighted / knownWeight, p) : null;
  const coverage =
    applicableWeight > 0 ? round(knownWeight / applicableWeight, p) : 0;
  const confidenceScore =
    applicableWeight > 0 ? round(evidenced / applicableWeight, p) : 0;

  const confidence: FitConfidence =
    confidenceScore >= config.confidence.highMin
      ? "HIGH"
      : confidenceScore >= config.confidence.mediumMin
        ? "MEDIUM"
        : "LOW";

  const band = bandFor(config, inputs.hardRule, value, coverage, confidence);

  const weightOf = new Map(
    config.parameters.map((e) => [e.parameter, e.weight] as const),
  );
  const byWeight = (a: FitParameterResultDto, b: FitParameterResultDto) =>
    (weightOf.get(b.parameter) ?? 0) - (weightOf.get(a.parameter) ?? 0) ||
    FIT_PARAMETERS.indexOf(a.parameter) - FIT_PARAMETERS.indexOf(b.parameter);
  const applicable = results.filter((r) => r.applicable);
  const topReasons = [
    ...applicable.filter((r) => r.outcome === "STRONG").sort(byWeight),
    ...applicable.filter((r) => r.outcome === "PARTIAL").sort(byWeight),
  ].slice(0, 3);
  const mainMismatch =
    applicable.filter((r) => r.outcome === "MISMATCH").sort(byWeight)[0] ??
    null;

  const profile = FitProfileDtoSchema.parse({
    companyId: inputs.companyId,
    configVersion: config.version,
    configLabel: config.label,
    band,
    confidence,
    parameters: results,
    topReasons,
    mainMismatch,
    hardRule: inputs.hardRule,
    computedAt,
  });
  return { profile, value, coverage, confidenceScore };
}

function bandFor(
  config: FitConfig,
  hardRule: FitHardRuleDto | null,
  value: number | null,
  coverage: number,
  confidence: FitConfidence,
): FitBand {
  // A declared rule is the investor's own; it is named, never weighted.
  if (hardRule !== null) return "OUTSIDE_MANDATE";
  if (value === null || coverage < config.bands.minCoverageForBand) {
    return "NOT_ENOUGH_INFORMATION";
  }
  const { strong, good, partial } = config.bands;
  if (
    value >= strong.minValue &&
    coverage >= strong.minCoverage &&
    confidence === strong.requiresConfidence
  ) {
    return "STRONG_FIT";
  }
  if (value >= good.minValue) return "GOOD_FIT";
  if (value >= partial.minValue) return "PARTIAL_FIT";
  return "WEAK_FIT";
}

const CONFIDENCE_ORDER: Readonly<Record<FitConfidence, number>> = {
  HIGH: 2,
  MEDIUM: 1,
  LOW: 0,
};

/**
 * The config's tie-break, as a comparator: value descending (unknown
 * value last), then confidence, then company id. Outside-mandate profiles
 * sort after everything a person could act on.
 */
export function compareAssessments(a: FitAssessment, b: FitAssessment): number {
  const outA = a.profile.band === "OUTSIDE_MANDATE" ? 1 : 0;
  const outB = b.profile.band === "OUTSIDE_MANDATE" ? 1 : 0;
  if (outA !== outB) return outA - outB;
  const va = a.value ?? -1;
  const vb = b.value ?? -1;
  if (va !== vb) return vb - va;
  const ca = CONFIDENCE_ORDER[a.profile.confidence];
  const cb = CONFIDENCE_ORDER[b.profile.confidence];
  if (ca !== cb) return cb - ca;
  return a.profile.companyId < b.profile.companyId
    ? -1
    : a.profile.companyId > b.profile.companyId
      ? 1
      : 0;
}
