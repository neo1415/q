import { z } from "zod";

import {
  createUuidIdSchema,
  type DiscoveryMode,
  type InvestorMandateConstraintDto,
  type InvestorMandateDto,
  type InvestorMandateStatus,
  type InvestorMandateSummaryDto,
  type MandateChequeRange,
  type MandateConstraintDimension,
  type MandateConstraintOperator,
  type MandateConstraintValue,
  type MandatePreferenceClass,
  type UtcTimestamp,
} from "@capital-q/contracts";
import type { TenantId, UserId } from "@capital-q/security";
import type { MandateTaxonomyPreference } from "@capital-q/taxonomy";

import type { InvestorOrganisationId } from "./index.js";

/**
 * Declared-mandate contracts of the Investor bounded context.
 *
 *   InvestorOrganisation ≠ InvestorMandate ≠ Observed Behaviour
 *   ≠ Q Inference ≠ GateQ Rule ≠ Recommendation
 *
 * A mandate is explicit investor policy: what the organisation says it is
 * looking for. Nothing here is learned, inferred or an inbound rule.
 */

export const InvestorMandateIdSchema = createUuidIdSchema("InvestorMandateId");
export type InvestorMandateId = z.infer<typeof InvestorMandateIdSchema>;

export const InvestorMandateConstraintIdSchema = createUuidIdSchema(
  "InvestorMandateConstraintId",
);
export type InvestorMandateConstraintId = z.infer<
  typeof InvestorMandateConstraintIdSchema
>;

/** Whether a dimension may feed automated discovery, or is stored for humans only. */
export type MandateAutomatedUse = "ELIGIBLE" | "MANUAL_ONLY";

/**
 * One declared constraint: for this mandate, this dimension has this
 * operator and value with this declared importance. AVOID is a soft
 * negative; HARD_EXCLUSION (⇔ isHardExclusion) is the only ineligibility
 * signal. Ranking weights are not defined in this package.
 */
export type InvestorMandateConstraint = {
  readonly id: InvestorMandateConstraintId;
  readonly tenantId: TenantId;
  readonly mandateId: InvestorMandateId;
  readonly dimension: MandateConstraintDimension;
  readonly operator: MandateConstraintOperator;
  readonly value: MandateConstraintValue;
  readonly importance: MandatePreferenceClass;
  readonly isHardExclusion: boolean;
};

export type InvestorMandate = {
  readonly id: InvestorMandateId;
  readonly tenantId: TenantId;
  readonly investorOrganisationId: InvestorOrganisationId;
  readonly name: string;
  readonly status: InvestorMandateStatus;
  readonly effectiveFrom: UtcTimestamp | null;
  readonly effectiveTo: UtcTimestamp | null;
  readonly discoveryMode: DiscoveryMode | null;
  /** Exact decimal strings; unknown stays null. */
  readonly minCheque: string | null;
  readonly maxCheque: string | null;
  readonly currencyCode: string | null;
  readonly minStageCode: string | null;
  readonly maxStageCode: string | null;
  /** Investor-private narrative. Never emitted. */
  readonly rawMandateText: string | null;
  readonly createdByUserId: UserId;
  readonly version: number;
  readonly createdAt: UtcTimestamp;
  readonly updatedAt: UtcTimestamp;
  /** Every stored constraint, including the derived `cheque.typical`. */
  readonly constraints: readonly InvestorMandateConstraint[];
  /** Declared canonical taxonomy preferences (CQ-TAX-001); same node ids companies are classified with. */
  readonly taxonomyPreferences: readonly MandateTaxonomyPreference[];
};

export type InvestorMandateSummary = {
  readonly id: InvestorMandateId;
  readonly tenantId: TenantId;
  readonly investorOrganisationId: InvestorOrganisationId;
  readonly name: string;
  readonly status: InvestorMandateStatus;
  readonly discoveryMode: DiscoveryMode | null;
  readonly effectiveFrom: UtcTimestamp | null;
  readonly effectiveTo: UtcTimestamp | null;
  readonly version: number;
  readonly createdAt: UtcTimestamp;
};

/**
 * What a recommendation or Q consumer receives through the query port:
 * deterministic for (mandateId, version), typed, and without the raw
 * narrative. Each constraint says whether automated use is eligible.
 */
export type InvestorMandateSnapshot = {
  readonly mandateId: InvestorMandateId;
  readonly tenantId: TenantId;
  readonly investorOrganisationId: InvestorOrganisationId;
  readonly version: number;
  readonly status: InvestorMandateStatus;
  readonly discoveryMode: DiscoveryMode | null;
  readonly cheque: MandateChequeRange | null;
  readonly stage: {
    readonly minStageCode: string | null;
    readonly maxStageCode: string | null;
  };
  readonly constraints: readonly (InvestorMandateConstraint & {
    readonly automatedUse: MandateAutomatedUse;
  })[];
  readonly taxonomyPreferences: readonly MandateTaxonomyPreference[];
};

/** The typical cheque lives in a derived constraint, not a column. */
export function typicalCheque(
  constraints: readonly InvestorMandateConstraint[],
): string | undefined {
  const typical = constraints.find(
    (constraint) => constraint.dimension === "cheque.typical",
  );
  return typical !== undefined && typical.value.kind === "amount"
    ? typical.value.amount
    : undefined;
}

export function chequeRangeOf(
  mandate: Pick<
    InvestorMandate,
    "minCheque" | "maxCheque" | "currencyCode" | "constraints"
  >,
): MandateChequeRange | null {
  if (mandate.currencyCode === null) {
    return null;
  }
  const typical = typicalCheque(mandate.constraints);
  return {
    currency: mandate.currencyCode,
    ...(mandate.minCheque === null ? {} : { min: mandate.minCheque }),
    ...(typical === undefined ? {} : { typical }),
    ...(mandate.maxCheque === null ? {} : { max: mandate.maxCheque }),
  };
}

/** Client-visible constraints exclude the derived typical cheque (it is in chequeRange). */
export function toInvestorMandateConstraintDto(
  constraint: InvestorMandateConstraint,
): InvestorMandateConstraintDto | null {
  if (constraint.dimension === "cheque.typical") {
    return null;
  }
  return {
    id: constraint.id,
    dimension: constraint.dimension,
    operator: constraint.operator,
    value: constraint.value,
    importance: constraint.importance,
    isHardExclusion: constraint.isHardExclusion,
  };
}

/**
 * Organisation-internal wire shape: carries the raw text and every
 * declared constraint because authorised investor users edit them. A
 * founder-facing profile must not reuse this mapping.
 */
export function toInvestorMandateDto(
  mandate: InvestorMandate,
): InvestorMandateDto {
  return {
    id: mandate.id,
    investorOrganisationId: mandate.investorOrganisationId,
    name: mandate.name,
    status: mandate.status,
    effectiveFrom: mandate.effectiveFrom,
    effectiveTo: mandate.effectiveTo,
    discoveryMode: mandate.discoveryMode,
    chequeRange: chequeRangeOf(mandate),
    minStageCode: mandate.minStageCode,
    maxStageCode: mandate.maxStageCode,
    rawMandateText: mandate.rawMandateText,
    constraints: mandate.constraints
      .map(toInvestorMandateConstraintDto)
      .filter(
        (constraint): constraint is InvestorMandateConstraintDto =>
          constraint !== null,
      ),
    taxonomyPreferences: mandate.taxonomyPreferences.map((preference) => ({
      nodeId: preference.nodeId,
      vocabularyCode: preference.vocabularyCode,
      canonicalCode: preference.canonicalCode,
      preferenceStrength: preference.preferenceStrength,
      isExclusion: preference.isExclusion,
    })),
    version: mandate.version,
    createdAt: mandate.createdAt,
    updatedAt: mandate.updatedAt,
  };
}

export function toInvestorMandateSummaryDto(
  summary: InvestorMandateSummary,
): InvestorMandateSummaryDto {
  return {
    id: summary.id,
    investorOrganisationId: summary.investorOrganisationId,
    name: summary.name,
    status: summary.status,
    discoveryMode: summary.discoveryMode,
    effectiveFrom: summary.effectiveFrom,
    effectiveTo: summary.effectiveTo,
    version: summary.version,
    createdAt: summary.createdAt,
  };
}
