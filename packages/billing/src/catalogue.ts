/**
 * The feature keys code refers to. The catalogue itself (names, kinds,
 * which plan includes what, limits) is reference data in `billing.*`; these
 * are its stable identifiers, like event names -- never an enum of plans.
 */

export const FEATURE_REHEARSALS = "q.rehearsals" as const;
export const FEATURE_DELEGATIONS = "q.delegations" as const;
export const FEATURE_AI_IMAGES = "documents.ai_images" as const;
export const FEATURE_RESEARCH = "q.research" as const;
export const FEATURE_DAILY_EDITIONS = "q.daily_editions" as const;
export const FEATURE_GATEWAYS = "gateq.gateways" as const;

export const GATED_FEATURE_KEYS = [
  FEATURE_REHEARSALS,
  FEATURE_DELEGATIONS,
  FEATURE_AI_IMAGES,
  FEATURE_RESEARCH,
  FEATURE_DAILY_EDITIONS,
  FEATURE_GATEWAYS,
] as const;
export type GatedFeatureKey = (typeof GATED_FEATURE_KEYS)[number];

/**
 * BILLING-2 (ADR 0036): the Capital Readiness Blueprint, PADL #85 Layer 2
 * "Pro" -- an ACCESS feature; the route is a 501 stub until it is built.
 */
export const FEATURE_READINESS_BLUEPRINT = "q.readiness_blueprint" as const;

/**
 * BILLING-2 (ADR 0036): plan VALUES -- numbers a plan sets, read by the
 * owning context as configuration, never a refusal. Recommendation volume
 * changes how far down the ranked slate a feed may page; it never changes
 * a position (no pay-to-rank).
 */
export const VALUE_RECOMMENDATION_VOLUME =
  "discover.recommendation_volume" as const;
export const PLAN_VALUE_KEYS = [VALUE_RECOMMENDATION_VOLUME] as const;

/**
 * What no plan may ever gate (PADL #85 Layer 1 "Diagnosis (Core Platform)",
 * Decision #106 "Full InvestIQ diagnosis without paid advisory", and the
 * neutrality decisions: "Commercial payment cannot secretly manipulate Q's
 * objective rankings"). A test keeps these out of the catalogue; adding one
 * needs a PADL amendment, not a migration.
 */
export const NEVER_GATED_CAPABILITIES = [
  "onboarding",
  "diagnosis",
  "assessment",
  "q.answers",
  "discover.ranking",
  "discover.feed",
  "discover.save_pass",
  "relationship.interest",
  "relationship.chat",
  "meetings",
  "commitments",
  "verification",
  "safety",
  "data_export",
] as const;

/** A billing account: the organisation acted for, or the person alone. */
export type BillingAccount = {
  readonly organisationId: string | null;
  readonly userId: string;
};

export function billingAccountOf(actor: {
  readonly userId: string;
  readonly organisationId?: string | undefined;
}): BillingAccount {
  return {
    organisationId: actor.organisationId ?? null,
    userId: actor.userId,
  };
}

export function accountKeyOf(account: BillingAccount): string {
  return account.organisationId === null
    ? `p:${account.userId}`
    : `o:${account.organisationId}`;
}

/** Where metered work was started from (the meter's `surface`). */
export type MeterSurface = "API" | "Q_API" | "Q_TOOL" | "Q_ACTION" | "WORKER";
