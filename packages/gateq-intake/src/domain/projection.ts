import type { QualificationSubjectProjection } from "@capital-q/gateq";

import {
  QUALIFYING_DIMENSIONS,
  type ApplicationFact,
  type ApplicationId,
} from "../contracts/index.js";

/**
 * Turning what an applicant told us into something the deterministic
 * engine can judge (CQ-GATE-002 §24, §25).
 *
 * The same engine judges a canonical Company and an anonymous application,
 * and the subject discriminator is how it does that without either
 * pretending to be the other. What changes is only where the facts came
 * from; what does not change is that GATE-001 decides, deterministically,
 * from a bounded projection.
 *
 * Two rules do the real work here.
 *
 * **Only qualifying dimensions cross.** Revenue and traction are captured
 * as application intelligence and are deliberately absent from
 * `QUALIFYING_DIMENSIONS`, because GATE-001 does not support them as
 * criteria. Hearing a founder mention revenue must not quietly turn it
 * into one — that would be a criterion nobody published, applied by
 * nobody's decision.
 *
 * **UNKNOWN stays absent.** An applicant who was asked and does not know
 * produces a fact with provenance UNKNOWN, and it arrives here as null
 * rather than as a value. The engine then says INSUFFICIENT_INFORMATION,
 * which is the honest answer; a zero or an empty string would be a
 * mismatch nobody meant.
 *
 * Taxonomy is the one dimension an applicant cannot supply directly. They
 * give phrases; a resolver maps them to canonical node ids and the
 * applicant confirms. Unresolved phrases are not classifications, so the
 * projection carries none and the engine reports the taxonomy criterion
 * UNKNOWN — which is exactly what "nobody has classified this yet" means.
 */

export type ResolvedClassification = {
  readonly vocabularyCode: string;
  readonly nodeId: string;
  readonly ancestorNodeIds: readonly string[];
};

export function applicationProjection(input: {
  readonly applicationId: ApplicationId;
  readonly tenantId: string;
  /** Current facts only. Superseded ones are history, not truth. */
  readonly facts: readonly ApplicationFact[];
  /** Confirmed canonical classifications; phrases alone are not one. */
  readonly classifications: readonly ResolvedClassification[];
}): QualificationSubjectProjection {
  const current = new Map(
    input.facts
      .filter(
        (fact) =>
          fact.supersededAt === null &&
          // Asked and not known is not a value. Passing one through as an
          // empty string would read as a mismatch rather than a gap.
          fact.provenance !== "UNKNOWN" &&
          fact.value.kind !== "NONE" &&
          QUALIFYING_DIMENSIONS.includes(fact.dimension),
      )
      .map((fact) => [fact.dimension, fact] as const),
  );

  const country = current.get("company.country");
  const stage = current.get("company.stage");
  const amount = current.get("raise.amount");

  return {
    subject: {
      kind: "GATEQ_APPLICATION",
      applicationId: input.applicationId,
      tenantId: input.tenantId,
    },
    classifications: input.classifications.map((classification) => ({
      vocabularyCode: classification.vocabularyCode,
      nodeId: classification.nodeId,
      ancestorNodeIds: [...classification.ancestorNodeIds],
    })),
    headquartersCountry:
      country?.value.kind === "CODE" && /^[A-Z]{2}$/.test(country.value.code)
        ? country.value.code
        : null,
    currentStageCode: stage?.value.kind === "CODE" ? stage.value.code : null,
    // The raise carries its own currency, so there is no pairing to get
    // wrong and no place for a default to creep in.
    raise:
      amount?.value.kind === "AMOUNT"
        ? { amount: amount.value.amount, currency: amount.value.currency }
        : null,
  };
}
