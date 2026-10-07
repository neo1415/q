import type {
  GateCriterionStanding,
  InvestorGateFitDto,
} from "@capital-q/contracts";

/**
 * Q.05: an investor's published gate in words, against the founder's own
 * company. Met, not met and not known yet are said in words with a mark
 * (never colour alone); unknown is never a no.
 */

export const STANDING_WORDS: Readonly<Record<GateCriterionStanding, string>> = {
  MET: "Met",
  NOT_MET: "Not met",
  UNKNOWN: "Not known yet",
};

export function gateTally(gate: InvestorGateFitDto): {
  readonly met: number;
  readonly notMet: number;
  readonly unknown: number;
} {
  return {
    met: gate.criteria.filter((c) => c.standing === "MET").length,
    notMet: gate.criteria.filter((c) => c.standing === "NOT_MET").length,
    unknown: gate.criteria.filter((c) => c.standing === "UNKNOWN").length,
  };
}

/** "meets Seed or pre-seed, Fintech · not met: East Africa only · not known yet: raise". */
export function gateLine(gate: InvestorGateFitDto): string {
  const of = (standing: GateCriterionStanding) =>
    gate.criteria.filter((c) => c.standing === standing).map((c) => c.label);
  const parts = [
    of("MET").length === 0 ? null : `meets ${of("MET").join(", ")}`,
    of("NOT_MET").length === 0 ? null : `not met: ${of("NOT_MET").join(", ")}`,
    of("UNKNOWN").length === 0
      ? null
      : `not known yet: ${of("UNKNOWN").join(", ")}`,
  ].filter((part): part is string => part !== null);
  return parts.length === 0 ? "no published criteria" : parts.join(" · ");
}

/** The one-sentence summary under a gate's criteria. */
export function gateSummary(gate: InvestorGateFitDto): string {
  const { met, notMet, unknown } = gateTally(gate);
  const total = gate.criteria.length;
  const requiredMissed = gate.criteria.filter(
    (c) => c.standing === "NOT_MET" && c.requiredness === "REQUIRED",
  );
  if (!gate.acceptingApplications) {
    return "Their gate isn't taking applications right now.";
  }
  if (requiredMissed.length > 0) {
    return `Doesn't meet ${requiredMissed.length === 1 ? "one required criterion" : `${String(requiredMissed.length)} required criteria`}: ${requiredMissed.map((c) => c.label).join(", ")}.`;
  }
  if (unknown > 0) {
    return `Meets ${String(met)} of their ${String(total)} published criteria; ${unknown === 1 ? "one" : String(unknown)} Q can't check until you share more.`;
  }
  return notMet === 0
    ? `Meets all ${String(total)} of their published criteria.`
    : `Meets ${String(met)} of ${String(total)}; the rest are preferences, not requirements.`;
}
