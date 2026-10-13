import type {
  GateqCoverageV1,
  GateqInvestmentGroup,
} from "@capital-q/contracts";
import type { GatewayPolicy, QualificationResult } from "@capital-q/gateq";

import type {
  ApplicationDimension,
  ApplicationFact,
  FactValue,
} from "../contracts/index.js";
import {
  countryName,
  INSTRUMENT_WORDS,
  LEAD_WORDS,
  STAGE_WORDS,
} from "../inbox/domain.js";
import { contradictionsIn, questionNeedsFor } from "./question-needs.js";

/**
 * What an application covers, before the founder presses Submit (GateQ
 * slice 1, directive §6).
 *
 * Deterministic and numberless. The interviewer is never trusted to
 * remember what it has covered: this reads the recorded facts, GATE-001's
 * own answer and the contradiction rules, and says plainly what is
 * answered (and on whose word), what the founder does not know, what they
 * preferred not to say, what was never covered and what disagrees. There
 * is no completeness percentage and no weight anywhere, because a number
 * here would read as a score and none has been approved.
 *
 * Qualification is not recomputed or reinterpreted. Access, unmet and
 * still-needed come straight from the engine's result, by the investor's
 * published label and never by the configuration behind it.
 */

/**
 * The fixed, ordered investment dimensions and the application dimensions
 * each one reads. Contact fields and the founder's note are not
 * investment dimensions and are reported elsewhere.
 */
export const INVESTMENT_DIMENSIONS: readonly {
  readonly group: GateqInvestmentGroup;
  readonly label: string;
  readonly dimensions: readonly ApplicationDimension[];
}[] = [
  {
    group: "COMPANY",
    label: "Company",
    dimensions: [
      "company.name",
      "company.description",
      "company.website",
      "company.country",
      "company.stage",
      "company.sector_phrases",
    ],
  },
  {
    group: "PRODUCT",
    label: "Problem and product",
    dimensions: ["company.problem", "company.solution"],
  },
  {
    group: "MARKET",
    label: "Customers and market",
    dimensions: ["company.customers", "company.market"],
  },
  {
    group: "BUSINESS_MODEL",
    label: "Business model",
    dimensions: ["company.business_model"],
  },
  {
    group: "TRACTION",
    label: "Traction and revenue",
    dimensions: ["claims.traction", "claims.revenue"],
  },
  { group: "TEAM", label: "Team", dimensions: ["company.team"] },
  {
    group: "FUNDRAISING",
    label: "Fundraising",
    dimensions: [
      "raise.amount",
      "raise.currency",
      "raise.instrument",
      "raise.lead_status",
      "raise.use_of_funds",
    ],
  },
];

/** Plain labels for every dimension a founder or investor reads. */
export const DIMENSION_LABELS: Readonly<Record<ApplicationDimension, string>> =
  {
    "contact.name": "Contact name",
    "contact.email": "Contact email",
    "contact.role": "Contact role",
    "company.name": "Company name",
    "company.description": "What the company does",
    "company.website": "Website",
    "company.country": "Where the company is based",
    "company.stage": "Stage",
    "company.problem": "Problem",
    "company.solution": "Solution",
    "company.market": "Market",
    "company.customers": "Customers",
    "company.team": "Team",
    "company.business_model": "Business model",
    "company.sector_phrases": "Sector",
    "claims.revenue": "Revenue",
    "claims.traction": "Traction",
    "raise.amount": "Raise size",
    "raise.currency": "Raise currency",
    "raise.instrument": "Instrument",
    "raise.use_of_funds": "Use of funds",
    "raise.lead_status": "Lead investor",
    "application.note": "Note to the investor",
  };

/**
 * Dimensions that are not reported missing on their own: the currency
 * travels with the raise amount, and an application can be assessed
 * without it being asked separately.
 */
const NOT_REPORTED_MISSING: ReadonlySet<ApplicationDimension> = new Set([
  "raise.currency",
]);

const GROUP_OF = new Map<ApplicationDimension, GateqInvestmentGroup>(
  INVESTMENT_DIMENSIONS.flatMap((entry) =>
    entry.dimensions.map((dimension) => [dimension, entry.group] as const),
  ),
);

/** A stored value in words, for a person. Never the stored shape. */
export function factSummary(
  dimension: ApplicationDimension,
  value: FactValue,
): string {
  switch (value.kind) {
    case "TEXT":
      return value.text;
    case "AMOUNT":
      return `${value.amount} ${value.currency}`;
    case "PHRASES":
      return value.phrases.join(", ");
    case "NONE":
      return value.declined === true ? "Preferred not to say" : "Not known";
    case "CODE":
      if (dimension === "company.country") return countryName(value.code);
      if (dimension === "company.stage") {
        return STAGE_WORDS[value.code] ?? value.code;
      }
      if (dimension === "raise.instrument") {
        return INSTRUMENT_WORDS[value.code] ?? value.code;
      }
      if (dimension === "raise.lead_status") {
        return LEAD_WORDS[value.code] ?? value.code;
      }
      return value.code;
  }
}

/** The engine's answer in an applicant's terms: published labels only. */
export function explainQualification(
  policy: GatewayPolicy,
  qualification: QualificationResult,
): {
  readonly access: QualificationResult["access"];
  readonly unmet: readonly string[];
  readonly stillNeeded: readonly string[];
} {
  const label = (criterionId: string) =>
    policy.criteria.find((c) => c.id === criterionId)?.label ?? "a criterion";
  return {
    access: qualification.access,
    unmet: qualification.principalMismatches.map(label),
    stillNeeded: qualification.unknowns.map(label),
  };
}

export function coverageFor(input: {
  readonly policy: GatewayPolicy;
  readonly qualification: QualificationResult;
  readonly facts: readonly ApplicationFact[];
}): GateqCoverageV1 {
  const current = new Map(
    input.facts
      .filter((fact) => fact.supersededAt === null)
      .map((fact) => [fact.dimension, fact] as const),
  );
  // Every reason a dimension could matter, not only the next six to ask.
  const reasons = new Map(
    questionNeedsFor({
      policy: input.policy,
      qualification: input.qualification,
      facts: input.facts,
      limit: 64,
    }).map((need) => [need.dimension, need.reason] as const),
  );

  const answered: GateqCoverageV1["answered"][number][] = [];
  const unknown: GateqCoverageV1["unknown"][number][] = [];
  const declined: GateqCoverageV1["declined"][number][] = [];
  const missing: GateqCoverageV1["missing"][number][] = [];

  for (const entry of INVESTMENT_DIMENSIONS) {
    for (const dimension of entry.dimensions) {
      const base = {
        dimension,
        label: DIMENSION_LABELS[dimension],
        group: entry.group,
      };
      const fact = current.get(dimension);
      if (fact === undefined) {
        if (!NOT_REPORTED_MISSING.has(dimension)) {
          missing.push({
            ...base,
            reason: reasons.get(dimension) ?? "UNDERSTANDING",
          });
        }
        continue;
      }
      if (fact.value.kind === "NONE") {
        // Asked and answered "I'd rather not say" or "I don't know": a
        // real answer, never converted into a no or a zero.
        if (fact.value.declined === true) declined.push(base);
        else unknown.push(base);
        continue;
      }
      answered.push({
        ...base,
        summary: factSummary(dimension, fact.value).slice(0, 2000),
        provenance: fact.provenance,
      });
    }
  }

  const explained = explainQualification(input.policy, input.qualification);
  return {
    version: 1,
    access: explained.access,
    unmet: [...explained.unmet],
    stillNeeded: [...explained.stillNeeded],
    answered,
    unknown,
    declined,
    missing,
    contradictions: [...contradictionsIn(input.facts)].slice(0, 16),
  };
}

/** The investment group a dimension is read under, if it is one. */
export function groupOf(
  dimension: ApplicationDimension,
): GateqInvestmentGroup | null {
  return GROUP_OF.get(dimension) ?? null;
}
