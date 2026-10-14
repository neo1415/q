import type { GatewayPolicy, QualificationResult } from "@capital-q/gateq";

import {
  APPLICATION_DIMENSIONS,
  type ApplicationDimension,
  type ApplicationFact,
} from "../contracts/index.js";

/**
 * What is worth asking next, and why (CQ-GATE-002 §22, §28).
 *
 * Deterministic, and deliberately so. The model composes the question; the
 * platform decides what the question should be about, because only the
 * platform knows which criteria are required, what is already answered and
 * what contradicts what. A model left to choose from nothing would ask
 * whatever came to mind, and an interview that wanders is an interview
 * nobody finishes.
 *
 * The other half is §28. A private criterion still needs its answer, and
 * the need can be stated without the rule: "ask about the current stage"
 * carries everything the conversation requires, while the allowed stage
 * codes stay on the server. A model that never receives a threshold cannot
 * leak one, cannot be argued into revealing one, and cannot be tricked
 * into coaching somebody past it.
 */

export type QuestionNeed = {
  readonly dimension: ApplicationDimension;
  /**
   * Why it is worth asking, in bounded vocabulary. Never the rule itself.
   */
  readonly reason:
    | "REQUIRED_BY_GATEWAY"
    | "PREFERRED_BY_GATEWAY"
    | "CONTRADICTION"
    | "UNDERSTANDING";
};

/** Which application dimension answers which kind of criterion. */
const CRITERION_DIMENSION: Readonly<
  Record<string, ApplicationDimension | undefined>
> = {
  GEOGRAPHY: "company.country",
  STAGE: "company.stage",
  TAXONOMY: "company.sector_phrases",
  EXCLUDED_TAXONOMY: "company.sector_phrases",
  RAISE_SIZE: "raise.amount",
  CHEQUE_COMPATIBILITY: "raise.amount",
};

/**
 * What an investor reads first, when nothing is pressing.
 *
 * Ordered as a partner would want it: what the company is and does, then
 * who it serves, then the shape of the raise. Not the schema's order, and
 * not every dimension — a question asked only because a field exists is
 * the thing §22 forbids.
 */
const UNDERSTANDING_ORDER: readonly ApplicationDimension[] = [
  "company.name",
  "company.description",
  "company.problem",
  "company.solution",
  "company.customers",
  "company.market",
  "company.business_model",
  "claims.revenue",
  "claims.traction",
  "company.team",
  "raise.amount",
  "raise.instrument",
  "raise.lead_status",
  "raise.use_of_funds",
  "contact.name",
];

export function questionNeedsFor(input: {
  readonly policy: GatewayPolicy;
  readonly qualification: QualificationResult;
  readonly facts: readonly ApplicationFact[];
  /** Dimensions Q has already asked about and been answered "don't know". */
  readonly limit?: number | undefined;
}): readonly QuestionNeed[] {
  const limit = input.limit ?? 6;
  const answered = new Set(
    input.facts
      .filter((fact) => fact.supersededAt === null)
      .map((fact) => fact.dimension),
  );
  const needs: QuestionNeed[] = [];
  const seen = new Set<ApplicationDimension>();

  const add = (
    dimension: ApplicationDimension | undefined,
    reason: QuestionNeed["reason"],
  ): void => {
    if (dimension === undefined) return;
    // NONE is an answer too. Qualification can remain UNKNOWN without
    // repeatedly pressing someone who has already said they do not know
    // or declined. A new answer/correction can still change it later.
    if (answered.has(dimension)) return;
    if (seen.has(dimension)) return;
    if (!APPLICATION_DIMENSIONS.includes(dimension)) return;
    seen.add(dimension);
    needs.push({ dimension, reason });
  };

  const criterionById = new Map(
    input.policy.criteria.map(
      (criterion) => [criterion.id, criterion] as const,
    ),
  );

  // A required criterion nobody can answer yet is the most useful thing in
  // the conversation: it is the difference between an application that can
  // be assessed and one that cannot.
  for (const criterionId of input.qualification.unknowns) {
    const criterion = criterionById.get(criterionId);
    add(
      CRITERION_DIMENSION[criterion?.config.type ?? ""],
      "REQUIRED_BY_GATEWAY",
    );
  }

  // Then a preferred criterion, which informs a human without gating.
  for (const result of input.qualification.criteria) {
    if (result.requiredness !== "PREFERRED" || result.status !== "UNKNOWN") {
      continue;
    }
    const criterion = criterionById.get(result.criterionId);
    add(
      CRITERION_DIMENSION[criterion?.config.type ?? ""],
      "PREFERRED_BY_GATEWAY",
    );
  }

  // Then what a partner would want to know, in the order they would want
  // it, skipping anything the applicant has already told us.
  for (const dimension of UNDERSTANDING_ORDER) {
    if (answered.has(dimension)) continue;
    add(dimension, "UNDERSTANDING");
  }

  return needs.slice(0, limit);
}

/**
 * Things that do not agree, stated without deciding between them.
 *
 * A contradiction is a question, not a verdict: the applicant is the one
 * who knows which is right. Contradictions coexist until somebody
 * reconciles them, and the somebody is a person.
 */
export function contradictionsIn(
  facts: readonly ApplicationFact[],
): readonly string[] {
  const current = new Map<ApplicationDimension, ApplicationFact[]>();
  for (const fact of facts) {
    if (fact.supersededAt !== null || fact.value.kind === "NONE") continue;
    const group = current.get(fact.dimension) ?? [];
    group.push(fact);
    current.set(fact.dimension, group);
  }
  const out: string[] = [];
  for (const [dimension, group] of current) {
    // Only conflicting answers to the SAME dimension constitute a
    // deterministic contradiction. Revenue larger than a financing round
    // is entirely plausible; without periods/bases no verdict is possible.
    const values = new Map<string, ApplicationFact>();
    for (const fact of group) {
      const value = fact.value;
      const key =
        value.kind === "PHRASES"
          ? JSON.stringify({
              kind: value.kind,
              phrases: [...value.phrases].sort(),
            })
          : JSON.stringify(value);
      values.set(key, fact);
    }
    if (values.size < 2) continue;
    const summaries = [...values.values()].slice(0, 3).map((fact) => {
      const value = fact.value;
      const summary =
        value.kind === "TEXT"
          ? value.text
          : value.kind === "CODE"
            ? value.code
            : value.kind === "AMOUNT"
              ? `${value.amount} ${value.currency}`
              : value.kind === "PHRASES"
                ? value.phrases.join(", ")
                : "unknown";
      return `${summary.slice(0, 48)} [${fact.provenance}]`;
    });
    out.push(
      `${dimension} has conflicting current answers: ${summaries.join(" versus ")}`,
    );
  }
  return out.slice(0, 16);
}
