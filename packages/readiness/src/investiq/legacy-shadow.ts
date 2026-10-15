import { EvidenceStatusSchema, TruthClassSchema } from "@capital-q/contracts";
import { z } from "zod";

import type {
  CoreDimension,
  InvestIQInput,
  InvestIQObservation,
} from "./contracts.js";

/**
 * Shadow adapter: a STORED readiness-rules/v1 assessment (the jsonb in
 * core.company_readiness_assessments) -> InvestIQ shadow input. Read-only,
 * pure, offline. It never writes and never feeds a production value.
 *
 * It does not interpret merit: every mapped line is RECORDED, because v1
 * stores what is on record, not a judgement of it. Every assumption it has
 * to make is returned in `assumptions` so the comparison can show it.
 *
 * Exclusions, by rule:
 *   VERIFICATION lines   identity/organisation/domain verification is the
 *                        separate verification_claims workflow (ADR-001)
 *                        and is not evidence of business merit.
 *   PROFILE categories   sector taxonomy is assessment context, not evidence.
 */

const LegacyLineSchema = z.object({
  label: z.string(),
  source: z.string(),
  truthClass: z.string().nullable(),
  evidenceStatus: z.string().nullable(),
  ref: z.unknown().optional(),
});
const LegacyAssessmentSchema = z.object({
  rulesVersion: z.string(),
  stageCode: z.string().nullable(),
  pillars: z.array(
    z.object({
      pillar: z.string(),
      status: z.string(),
      evidence: z.array(LegacyLineSchema),
    }),
  ),
  blockers: z.array(
    z.object({ id: z.string(), kind: z.string(), pillar: z.string() }),
  ),
});
export type LegacyReadinessAssessment = z.infer<typeof LegacyAssessmentSchema>;

/** The legacy pillar whose status is compared with each Core Seven dimension. */
export const LEGACY_PRIMARY_PILLAR: Readonly<Record<CoreDimension, string>> = {
  FOUNDER_AND_LEADERSHIP: "FOUNDER",
  MARKET_OPPORTUNITY: "MARKET_OPPORTUNITY",
  PRODUCT_AND_TECHNOLOGY: "PRODUCT_AND_SOLUTION",
  COMMERCIAL_PERFORMANCE: "COMMERCIAL_VALIDATION",
  FINANCIAL_HEALTH: "BUSINESS_ECONOMICS",
  GOVERNANCE_AND_INSTITUTIONAL_READINESS: "GOVERNANCE_AND_TRUST",
  CAPITAL_STRATEGY: "INVESTMENT_READINESS",
};

type Route = { readonly test: RegExp; readonly criterion: string };
const ROUTES: Readonly<Record<string, readonly Route[]>> = {
  FOUNDER: [
    { test: /founders section/i, criterion: "fl.founder_quality" },
    { test: /founder/i, criterion: "fl.leadership_depth" },
  ],
  MARKET_OPPORTUNITY: [
    {
      test: /TAM|SAM|SOM|market|spend|outlets|employers|estimated/i,
      criterion: "mo.market_size",
    },
  ],
  PRODUCT_AND_SOLUTION: [{ test: /./, criterion: "pt.product_definition" }],
  COMMERCIAL_VALIDATION: [
    { test: /retention|churn/i, criterion: "cp.retention" },
    { test: /top three|concentration/i, criterion: "cp.customer_base" },
    { test: /willingness to pay/i, criterion: "cp.revenue_model" },
    {
      test: /revenue|MRR|ARR|GMV|merchandise value|order value|contributions|paying|paid/i,
      criterion: "cp.revenue_quality",
    },
    { test: /./, criterion: "cp.traction" },
  ],
  BUSINESS_ECONOMICS: [
    { test: /business model section/i, criterion: "cp.business_model" },
    { test: /management accounts/i, criterion: "fh.historical_financials" },
    { test: /net revenue retention/i, criterion: "cp.retention" },
    { test: /margin/i, criterion: "fh.profitability" },
    {
      test: /CAC|acquisition cost|payback|IRR/i,
      criterion: "fh.capital_efficiency",
    },
  ],
  EXECUTION_CAPACITY: [
    { test: /go to market/i, criterion: "cp.distribution" },
    { test: /team of/i, criterion: "fl.organisational_structure" },
  ],
  GOVERNANCE_AND_TRUST: [
    { test: /incorporation/i, criterion: "gir.incorporation" },
    {
      test: /shareholder|stockholder|director/i,
      criterion: "gir.ownership_structure",
    },
    { test: /cap table/i, criterion: "gir.cap_table" },
    { test: /churn/i, criterion: "cp.retention" },
  ],
  INVESTMENT_READINESS: [
    { test: /^pitch deck$/i, criterion: "cs.capital_narrative" },
    { test: /the ask section|^target /i, criterion: "cs.raise_amount" },
    { test: /use of funds/i, criterion: "cs.use_of_funds" },
    { test: /instrument/i, criterion: "cs.investment_structure" },
    { test: /valuation/i, criterion: "cs.valuation" },
    { test: /summary|data room/i, criterion: "gir.data_room" },
  ],
};

/** v1 blocker id -> criterion, used only for CONTRADICTED blockers. */
const CONTRADICTION_ROUTES: Readonly<Record<string, string>> = {
  "traction.revenue": "cp.revenue_quality",
  "traction.metrics": "cp.traction",
};

const SOURCE_KIND: Readonly<
  Record<string, InvestIQObservation["provenance"]["sourceKind"]>
> = {
  PROFILE: "PROFILE",
  CLAIM: "CLAIM",
  DECK: "DECK",
  DATA_ROOM: "DATA_ROOM",
  RAISE: "RAISE",
};

export type LegacyShadowInput = {
  readonly input: InvestIQInput;
  readonly legacy: LegacyReadinessAssessment;
  readonly excluded: readonly {
    readonly pillar: string;
    readonly label: string;
    readonly reason: string;
  }[];
  readonly assumptions: readonly string[];
};

export function investiqInputFromLegacyReadiness(
  stored: unknown,
  opts: { readonly companyRef: string; readonly asOf: string },
): LegacyShadowInput {
  const legacy = LegacyAssessmentSchema.parse(stored);
  const observations: InvestIQObservation[] = [];
  const excluded: { pillar: string; label: string; reason: string }[] = [];
  const assumptions = new Set<string>();

  for (const pillar of legacy.pillars) {
    pillar.evidence.forEach((line, i) => {
      if (line.source === "VERIFICATION") {
        excluded.push({
          pillar: pillar.pillar,
          label: line.label,
          reason: "VERIFICATION_WORKFLOW",
        });
        return;
      }
      if (line.source === "PROFILE" && /categor/i.test(line.label)) {
        excluded.push({
          pillar: pillar.pillar,
          label: line.label,
          reason: "CONTEXT_NOT_EVIDENCE",
        });
        return;
      }
      const route = (ROUTES[pillar.pillar] ?? []).find((r) =>
        r.test.test(line.label),
      );
      const kind = SOURCE_KIND[line.source];
      if (route === undefined || kind === undefined) {
        excluded.push({
          pillar: pillar.pillar,
          label: line.label,
          reason: "UNMAPPED",
        });
        return;
      }
      const parsedTruth = TruthClassSchema.safeParse(line.truthClass);
      const parsedEvidence = EvidenceStatusSchema.safeParse(
        line.evidenceStatus,
      );
      const truthClass = parsedTruth.success ? parsedTruth.data : "USER_CLAIM";
      const evidenceStatus = parsedEvidence.success
        ? parsedEvidence.data
        : line.source === "DATA_ROOM"
          ? "DOCUMENT_SUPPORTED"
          : "SELF_REPORTED";
      if (!parsedTruth.success) {
        assumptions.add(
          `${line.source} line without truth class read as USER_CLAIM (founder-supplied)`,
        );
      }
      if (!parsedEvidence.success) {
        assumptions.add(
          `${line.source} line without evidence status read as ${evidenceStatus} (present, unverified)`,
        );
      }
      assumptions.add(
        "v1 lines carry no lifecycle: read as CURRENT; no observation time: null",
      );
      observations.push({
        id: `${pillar.pillar}:${i}`,
        criterion: route.criterion,
        reading: "RECORDED",
        statement: line.label.slice(0, 500) || "(empty)",
        truthClass,
        evidenceStatus,
        lifecycleStatus: "CURRENT",
        provenance: { sourceKind: kind, sourceRef: null, observedAt: null },
      });
    });
  }

  legacy.blockers.forEach((b, i) => {
    if (b.kind !== "CONTRADICTED") return; // MISSING / UNSUPPORTED stay unknown or as stated
    const criterion = CONTRADICTION_ROUTES[b.id];
    if (criterion === undefined) {
      excluded.push({
        pillar: b.pillar,
        label: b.id,
        reason: "UNMAPPED_CONTRADICTION",
      });
      return;
    }
    observations.push({
      id: `blocker:${i}`,
      criterion,
      reading: "RECORDED",
      statement: `Open contradiction (${b.id})`,
      truthClass: "USER_CLAIM",
      evidenceStatus: "SELF_REPORTED",
      lifecycleStatus: "CONTRADICTORY",
      provenance: { sourceKind: "CLAIM", sourceRef: null, observedAt: null },
    });
  });

  return {
    input: {
      companyRef: opts.companyRef,
      asOf: opts.asOf,
      context: {
        stageCode: legacy.stageCode,
        sectorCodes: [],
        businessModel: null,
        instrument: null,
      },
      observations,
    },
    legacy,
    excluded,
    assumptions: [...assumptions].sort(),
  };
}
