import { createHash } from "node:crypto";

import { EVIDENCE_STATUSES, type EvidenceStatus } from "@capital-q/contracts";

import {
  CORE_DIMENSIONS,
  FDN_DIMENSIONS,
  InvestIQAssessmentSchema,
  InvestIQInputSchema,
  type CriterionState,
  type DimensionResult,
  type InvestIQAssessment,
  type InvestIQInput,
  type InvestIQObservation,
} from "./contracts.js";
import { INVESTIQ_SHADOW_METHOD_V0, type InvestIQMethod } from "./method-v0.js";
import { stageRank } from "../domain/inputs.js";

/**
 * The InvestIQ shadow assessment: a pure function of (input, method). No
 * clock, no model, no I/O, no randomness; the same input and method give
 * the same output and inputHash.
 *
 * Criterion state, in order (each step cites its source in the trace):
 *   1. Observations SUPERSEDED, truth UNKNOWN, or Q inference with no
 *      evidence are excluded. "Not known" statements become known gaps,
 *      never weakness (PADL Ch4 #68; CLAUDE.md "unknown stays unknown").
 *   2. No admissible observation: NOT_APPLICABLE when a versioned context
 *      rule says so, otherwise UNKNOWN. Unknown stage never grants N/A.
 *   3. CONTRADICTORY/DISPUTED lifecycle, or strength and weakness readings
 *      together: CONFLICTED. Conflict is investigated, not penalised
 *      (PADL Ch4 #67).
 *   4. Any affirmative weakness: WEAKNESS_EVIDENCED. Else any strength:
 *      STRENGTH_INDICATED. Else RECORDED (on record, not judged).
 * A dimension never gets a number: grade and confidence level stay null
 * until a method version with approved bands exists (FDN brief p.8).
 */

export class InvestIQInputError extends Error {
  override readonly name = "InvestIQInputError";
}

type Trace = InvestIQAssessment["trace"];

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

/** Observation order must not change the hash or the result. */
function canonicalInput(input: InvestIQInput): InvestIQInput {
  return {
    ...input,
    context: {
      ...input.context,
      sectorCodes: [...input.context.sectorCodes].sort(),
    },
    observations: [...input.observations].sort((a, b) =>
      a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
    ),
  };
}

export function investiqInputHash(
  methodVersion: string,
  input: InvestIQInput,
): string {
  return createHash("sha256")
    .update(methodVersion)
    .update("\n")
    .update(stable(canonicalInput(input)))
    .digest("hex");
}

function rank(status: EvidenceStatus): number {
  return EVIDENCE_STATUSES.indexOf(status);
}

function isEarlyStage(stageCode: string | null): boolean {
  // stageRank() defaults unknown to seed; unknown must not grant N/A here.
  return stageCode !== null && stageRank(stageCode) === 1;
}

export function exclusionOf(o: InvestIQObservation) {
  if (o.lifecycleStatus === "SUPERSEDED") return "SUPERSEDED" as const;
  if (o.truthClass === "UNKNOWN") return "TRUTH_UNKNOWN" as const;
  if (o.truthClass === "Q_INFERENCE" && o.evidenceStatus === "NO_EVIDENCE") {
    return "INFERENCE_WITHOUT_EVIDENCE" as const;
  }
  return null;
}

export function assessInvestIQ(
  raw: unknown,
  method: InvestIQMethod = INVESTIQ_SHADOW_METHOD_V0,
): InvestIQAssessment {
  const parsed = InvestIQInputSchema.safeParse(raw);
  if (!parsed.success) {
    throw new InvestIQInputError(
      parsed.error.issues.map((i) => i.message).join("; "),
    );
  }
  const input = canonicalInput(parsed.data);
  const asOf = Date.parse(input.asOf);
  const criterionDefs = new Map(method.criteria.map((c) => [c.key, c]));
  const seenIds = new Set<string>();
  for (const o of input.observations) {
    if (seenIds.has(o.id))
      throw new InvestIQInputError(`duplicate observation id ${o.id}`);
    seenIds.add(o.id);
    if (!criterionDefs.has(o.criterion)) {
      throw new InvestIQInputError(
        `unknown criterion ${o.criterion} for ${method.version}`,
      );
    }
    if (
      o.provenance.observedAt !== null &&
      Date.parse(o.provenance.observedAt) > asOf
    ) {
      throw new InvestIQInputError(`observation ${o.id} is dated after asOf`);
    }
  }

  const trace: Trace = [];
  const step = (
    subject: string,
    rule: string,
    provenance: string,
    outcome: string,
  ) =>
    trace.push({ seq: trace.length + 1, subject, rule, provenance, outcome });

  step(
    "method",
    "method.status",
    "FDN brief p.8 (formula, weights, bands to be finalised)",
    `${method.version} ${method.status}: no weights, bands or composite`,
  );

  const early = isEarlyStage(input.context.stageCode);
  const byCriterion = new Map<string, InvestIQObservation[]>();
  for (const o of input.observations) {
    const list = byCriterion.get(o.criterion) ?? [];
    list.push(o);
    byCriterion.set(o.criterion, list);
  }

  const stateOf = new Map<string, CriterionState>();
  const dimensions: DimensionResult[] = method.dimensions.map((dim) => {
    const criteria = method.criteria
      .filter((c) => c.dimension === dim.code)
      .map((def) => {
        const all = byCriterion.get(def.key) ?? [];
        const excluded: {
          id: string;
          reason: NonNullable<ReturnType<typeof exclusionOf>>;
        }[] = [];
        const admissible: InvestIQObservation[] = [];
        const knownUnknowns: string[] = [];
        for (const o of all) {
          const reason = exclusionOf(o);
          if (reason === null) {
            admissible.push(o);
            continue;
          }
          excluded.push({ id: o.id, reason });
          if (reason === "TRUTH_UNKNOWN") knownUnknowns.push(o.statement);
          step(
            o.id,
            `exclude.${reason}`,
            "PADL Ch4 #68 (:2472); ADR-001",
            "excluded; stays unknown",
          );
        }

        let state: CriterionState;
        let applicabilityRule: string | null = null;
        if (admissible.length === 0) {
          const rule = early
            ? method.applicability.find((r) => r.criteria.includes(def.key))
            : undefined;
          if (rule !== undefined) {
            state = "NOT_APPLICABLE";
            applicabilityRule = rule.id;
            step(
              def.key,
              rule.id,
              `${rule.provenance.kind}: ${rule.provenance.ref}`,
              "NOT_APPLICABLE",
            );
          } else {
            state = "UNKNOWN";
            step(
              def.key,
              "state.unknown",
              "PADL Ch4 #68; Spec 4.7 (:3015)",
              "UNKNOWN (never zero, never weakness)",
            );
          }
        } else {
          const conflicted =
            admissible.some(
              (o) =>
                o.lifecycleStatus === "CONTRADICTORY" ||
                o.lifecycleStatus === "DISPUTED",
            ) ||
            (admissible.some((o) => o.reading === "SUPPORTS_STRENGTH") &&
              admissible.some((o) => o.reading === "INDICATES_WEAKNESS"));
          if (conflicted) {
            state = "CONFLICTED";
            step(
              def.key,
              "state.conflicted",
              "PADL Ch4 #67 (:2420)",
              "CONFLICTED: investigate, no penalty",
            );
          } else if (
            admissible.some((o) => o.reading === "INDICATES_WEAKNESS")
          ) {
            state = "WEAKNESS_EVIDENCED";
            step(
              def.key,
              "state.weakness",
              "PADL Ch4 #68 (affirmative only)",
              "WEAKNESS_EVIDENCED",
            );
          } else if (
            admissible.some((o) => o.reading === "SUPPORTS_STRENGTH")
          ) {
            state = "STRENGTH_INDICATED";
            step(
              def.key,
              "state.strength",
              "PADL Ch4 #65 (:2328)",
              "STRENGTH_INDICATED",
            );
          } else {
            state = "RECORDED";
            step(
              def.key,
              "state.recorded",
              "PADL #105 (:5383) stated vs evidenced",
              "RECORDED: on record, not judged",
            );
          }
        }
        stateOf.set(def.key, state);

        const strongest = admissible.reduce<EvidenceStatus | null>(
          (best, o) =>
            best === null || rank(o.evidenceStatus) > rank(best)
              ? o.evidenceStatus
              : best,
          null,
        );
        return {
          criterion: def.key,
          label: def.label,
          state,
          applicabilityRule,
          observationIds: admissible.map((o) => o.id),
          excluded,
          knownUnknowns,
          strongestEvidenceStatus: strongest,
          staleObservations: admissible.filter(
            (o) => o.lifecycleStatus === "STALE",
          ).length,
        };
      });

    const count = (s: CriterionState) =>
      criteria.filter((c) => c.state === s).length;
    const counts = {
      strengthIndicated: count("STRENGTH_INDICATED"),
      weaknessEvidenced: count("WEAKNESS_EVIDENCED"),
      recorded: count("RECORDED"),
      conflicted: count("CONFLICTED"),
      unknown: count("UNKNOWN"),
      notApplicable: count("NOT_APPLICABLE"),
    };
    const applicableCriteria = criteria.length - counts.notApplicable;
    const observedCriteria =
      counts.strengthIndicated + counts.weaknessEvidenced + counts.recorded;
    const highest = criteria.reduce<EvidenceStatus | null>((best, c) => {
      const s = c.strongestEvidenceStatus;
      if (s === null) return best;
      return best === null || rank(s) > rank(best) ? s : best;
    }, null);
    const applicability =
      applicableCriteria === 0 ? "NOT_APPLICABLE" : "APPLICABLE";
    const necessaryConditionMet =
      applicability === "NOT_APPLICABLE" || observedCriteria > 0;
    step(
      dim.code,
      "dimension.profile",
      "Spec 4.3 (:2811-2826) independent per-dimension reasoning",
      `${observedCriteria}/${applicableCriteria} applicable criteria observed; grade UNSPECIFIED`,
    );
    return {
      dimension: dim.code,
      label: dim.label,
      output: dim.output,
      applicability,
      criteria,
      subscore: {
        kind: "EVIDENCE_PROFILE",
        counts,
        applicableCriteria,
        observedCriteria,
        highestEvidenceStatus: highest,
        hasUnresolvedConflict: counts.conflicted > 0,
        hasEvidencedWeakness: counts.weaknessEvidenced > 0,
      },
      grade: null,
      gradeStatus: "UNSPECIFIED_PENDING_METHOD_APPROVAL",
      confidence: {
        level: null,
        status: "UNSPECIFIED_PENDING_METHOD_APPROVAL",
      },
      necessaryConditionMet,
    };
  });

  const reasons = ["METHOD_NOT_APPROVED"];
  for (const d of dimensions) {
    if (!d.necessaryConditionMet)
      reasons.push(`NO_EVIDENCE_IN_APPLICABLE_DIMENSION:${d.dimension}`);
    for (const c of d.criteria) {
      if (c.state === "CONFLICTED")
        reasons.push(`UNRESOLVED_CONFLICT:${c.criterion}`);
    }
  }

  const routed = new Map(method.routedElsewhere.map((r) => [r.fdn, r]));
  const fdnLens = FDN_DIMENSIONS.map((fdn) => ({
    fdn,
    routedTo: routed.has(fdn)
      ? ("DISCOVERY_FIT" as const)
      : ("THIS_ASSESSMENT" as const),
    criteria: method.criteria
      .filter((c) => c.fdn.includes(fdn))
      .map((c) => ({
        criterion: c.key,
        state: stateOf.get(c.key) ?? "UNKNOWN",
      })),
  }));

  const outputDims = (o: "BUSINESS_QUALITY" | "INVESTMENT_READINESS") =>
    method.dimensions.filter((d) => d.output === o).map((d) => d.code);

  const assessment: InvestIQAssessment = {
    method: { version: method.version, status: method.status },
    companyRef: input.companyRef,
    asOf: input.asOf,
    inputHash: investiqInputHash(method.version, parsed.data),
    dimensions,
    businessQuality: {
      dimensions: outputDims("BUSINESS_QUALITY"),
      headline: null,
      headlineStatus: "UNSPECIFIED_PENDING_METHOD_APPROVAL",
      compositionStatus: "PROPOSED_ADR_0068",
    },
    investmentReadiness: {
      dimensions: outputDims("INVESTMENT_READINESS"),
      headline: null,
      headlineStatus: "UNSPECIFIED_PENDING_METHOD_APPROVAL",
      compositionStatus: "PROPOSED_ADR_0068",
    },
    intelligenceConfidence: {
      level: null,
      status: "UNSPECIFIED_PENDING_METHOD_APPROVAL",
    },
    notComputedHere: [
      "INVESTOR_FIT",
      "INTEREST",
      "MATCH",
      "RELATIONSHIP_STATE",
      "OUTCOME",
    ],
    fdnLens,
    finalisation: { status: "PROVISIONAL", reasons },
    trace,
  };
  // The method's own dimension list must be the Core Seven, in order.
  if (dimensions.map((d) => d.dimension).join() !== CORE_DIMENSIONS.join()) {
    throw new InvestIQInputError(
      `${method.version} does not cover the Core Seven in order`,
    );
  }
  return InvestIQAssessmentSchema.parse(assessment);
}
