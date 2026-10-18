import { createHash } from "node:crypto";
import type { UnicornPotentialDto } from "@capital-q/contracts";
import type { InvestabilityInputs } from "../investability/inputs.js";
import {
  UNICORN_PILLARS,
  UNICORN_POTENTIAL_METHOD_VERSION,
  UNICORN_POTENTIAL_INPUT_RULES_VERSION,
  pillarWeight,
  unicornStageOf,
} from "./method-v1.js";
import { observeUnicornPotential, type UnicornObservation } from "./observe.js";
export type UnicornPotentialResult = {
  readonly view: Omit<UnicornPotentialDto, "assessedAt" | "momentum">;
  readonly basisHash: string;
  readonly observations: readonly UnicornObservation[];
};
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
/** Clock is explicit; aging changes basis only when an evidence state changes. */
export function assessUnicornPotential(
  inputs: InvestabilityInputs,
  asOf: string,
): UnicornPotentialResult {
  const observations = observeUnicornPotential(inputs, asOf);
  const stage = unicornStageOf(inputs.stageCode);
  const initialPillars: UnicornPotentialDto["pillars"] = UNICORN_PILLARS.map(
    (p) => {
      const criteria: UnicornPotentialDto["pillars"][number]["criteria"] =
        p.criteria.map((rule, index) => {
          const id = index === 0 ? "A" : "B";
          const all = observations.filter(
            (o) => o.pillar === p.id && o.criterion === id,
          );
          const current = all.filter((o) => !o.stale);
          const conflicts =
            all.some((o) => o.conflicted) ||
            (current.some((o) => o.grade < 2) &&
              current.some((o) => o.grade > 2));
          const state = conflicts
            ? "CONFLICTED"
            : current.length > 0
              ? "OBSERVED"
              : all.length > 0
                ? "STALE"
                : "UNKNOWN";
          // Different grades among compatible positive observations take the conservative bound.
          const grade =
            state === "OBSERVED"
              ? Math.min(...current.map((o) => o.grade))
              : null;
          return {
            id,
            label: rule.label,
            state,
            grade,
            anchor:
              grade === null
                ? rule.gap
                : grade === 0
                  ? "Affirmative material adverse evidence"
                  : grade === 1
                    ? "Concrete documented weakness"
                    : grade === 2
                      ? "Plausible or mixed limited evidence"
                      : grade === 4
                        ? "Sustained documented or corroborated execution"
                        : "Demonstrated stage-appropriate execution",
            sources: all.slice(0, 12).map((o) => ({
              ...o.source,
              label: o.source.label.slice(0, 200),
              at:
                o.source.at !== null && Number.isFinite(Date.parse(o.source.at))
                  ? new Date(o.source.at).toISOString()
                  : null,
            })),
          };
        });
      const scored = criteria.filter(
        (c) => c.state === "OBSERVED" && c.grade !== null,
      );
      return {
        id: p.id,
        label: p.label,
        weight: pillarWeight(p.weights, stage),
        grade:
          scored.length === 0
            ? null
            : scored.reduce((s, c) => s + (c.grade ?? 0), 0) / scored.length,
        contribution: null,
        coverage: scored.length / 2,
        criteria,
      };
    },
  );
  const pillars = initialPillars;
  const total =
    stage === null ? 12 : pillars.reduce((s, p) => s + (p.weight ?? 0), 0);
  const coverage =
    pillars.reduce((s, p) => s + (p.weight ?? 1) * p.coverage, 0) / total;
  const scored = pillars.filter((p) => p.grade !== null);
  const scoredWeight = scored.reduce((s, p) => s + (p.weight ?? 0), 0);
  let confidenceIndex = 0;
  for (const p of pillars) {
    for (const c of p.criteria) {
      if (c.state !== "OBSERVED") continue;
      const rel = Math.max(
        0,
        ...observations
          .filter((o) => o.pillar === p.id && o.criterion === c.id && !o.stale)
          .map((o) => o.reliability),
      );
      confidenceIndex += ((p.weight ?? 1) * 0.5 * rel) / total;
    }
  }
  const required =
    ["P1", "P2", "P3"].every((id) => scored.some((p) => p.id === id)) &&
    scored.some((p) => p.id === "P4" || p.id === "P7");
  const eligible =
    stage !== null && coverage >= 0.6 && scored.length >= 6 && required;
  const raw =
    scoredWeight === 0
      ? null
      : scored.reduce((s, p) => s + (p.weight ?? 0) * (p.grade ?? 0), 0) /
        scoredWeight;
  const overallScore = eligible && raw !== null ? Math.round(25 * raw) : null;
  const resultPillars = pillars.map((p) => ({
    ...p,
    contribution:
      overallScore === null || p.grade === null
        ? null
        : (25 * (p.weight ?? 0) * p.grade) / scoredWeight,
  }));
  const ordered = [...pillars].sort(
    (a, b) => (b.weight ?? 0) - (a.weight ?? 0) || a.id.localeCompare(b.id),
  );
  const missing = [
    ...(stage === null ? ["Confirm the company's funding stage"] : []),
    ...ordered.flatMap((p) =>
      p.criteria
        .filter((c) => c.state !== "OBSERVED")
        .map((c) => `${p.label}: ${c.anchor}`),
    ),
  ].slice(0, 24);
  const ranked = [...scored].sort(
    (a, b) =>
      Math.abs((b.weight ?? 0) * ((b.grade ?? 2) - 2)) -
        Math.abs((a.weight ?? 0) * ((a.grade ?? 2) - 2)) ||
      a.id.localeCompare(b.id),
  );
  const factors = (positive: boolean) =>
    ranked
      .filter((p) => (positive ? (p.grade ?? 2) > 2 : (p.grade ?? 2) < 2))
      .slice(0, 3)
      .map((p) => ({
        label: p.label,
        detail: p.criteria
          .filter((c) => c.grade !== null)
          .map((c) => c.sources[0]?.label ?? c.anchor)
          .join("; ")
          .slice(0, 200),
      }));
  const view: UnicornPotentialResult["view"] = {
    status: overallScore === null ? "INSUFFICIENT_EVIDENCE" : "SCORED",
    overallScore,
    band:
      overallScore === null
        ? null
        : overallScore < 40
          ? "LIMITED_INDICATORS"
          : overallScore < 60
            ? "DEVELOPING"
            : overallScore < 80
              ? "STRONG_SIGNALS"
              : "EXCEPTIONAL_SIGNALS",
    confidence:
      confidenceIndex >= 0.75
        ? "HIGH"
        : confidenceIndex >= 0.5
          ? "MODERATE"
          : "LOW",
    coverage,
    stage,
    methodVersion: UNICORN_POTENTIAL_METHOD_VERSION,
    inputRulesVersion: UNICORN_POTENTIAL_INPUT_RULES_VERSION,
    pillars: resultPillars,
    up: factors(true),
    down: factors(false),
    missing,
    benchmark: "Comparable benchmark unavailable",
  };
  const basisHash = createHash("sha256")
    .update(
      canonical({
        methodVersion: view.methodVersion,
        inputRulesVersion: view.inputRulesVersion,
        stage,
        sectorCodes: [...inputs.sectorCodes].sort(),
        applicability: "all-24.v1",
        observations,
        pillars,
      }),
    )
    .digest("hex");
  return { view, basisHash, observations };
}
