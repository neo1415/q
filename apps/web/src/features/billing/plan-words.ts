import type { BillingFeatureStandingDto } from "@capital-q/contracts";

/**
 * BILLING (ADR 0034): plan wording, shared by the plan page and the
 * features that show what is left. Plain words; the count is always in
 * text, never in colour alone.
 */

const DAY_MONTH = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});

export function unitsOf(
  feature: Pick<BillingFeatureStandingDto, "unitSingular" | "unitPlural">,
  count: number,
): string {
  return count === 1 ? feature.unitSingular : feature.unitPlural;
}

/** "3 of 20 rehearsals used this month", "Unlimited", "Not included". */
export function allowanceLine(feature: BillingFeatureStandingDto): string {
  if (!feature.included) return "Not included in your plan";
  if (feature.kind === "ACCESS") return "Included";
  // BILLING-2: a number the plan sets (never a meter).
  if (feature.kind === "VALUE") {
    return feature.limit === null
      ? "No limit"
      : `Up to ${String(feature.limit)} ${unitsOf(feature, feature.limit)}`;
  }
  if (feature.limit === null) {
    return feature.used === null
      ? "Unlimited"
      : `Unlimited · ${String(feature.used)} ${unitsOf(feature, feature.used)} ${
          feature.kind === "MONTHLY" ? "this month" : "now"
        }`;
  }
  const used = feature.used ?? 0;
  return feature.kind === "MONTHLY"
    ? `${String(used)} of ${String(feature.limit)} ${unitsOf(feature, feature.limit)} used this month`
    : `${String(used)} of ${String(feature.limit)} ${unitsOf(feature, feature.limit)}`;
}

/**
 * The allowance as a figure for a phone row (design-48): "27 of 30",
 * "Unlimited", "Included", "Up to 200", "Not included".
 */
export function countLine(feature: BillingFeatureStandingDto): string {
  if (!feature.included) return "Not included";
  if (feature.kind === "ACCESS") return "Included";
  if (feature.kind === "VALUE") {
    return feature.limit === null
      ? "No limit"
      : `Up to ${String(feature.limit)}`;
  }
  if (feature.limit === null) return "Unlimited";
  return `${String(feature.used ?? 0)} of ${String(feature.limit)}`;
}

/** Units left this month, or null when unlimited / not metered. */
export function remainingOf(feature: BillingFeatureStandingDto): number | null {
  if (!feature.included) return 0;
  if (feature.limit === null || feature.used === null) return null;
  return Math.max(0, feature.limit - feature.used);
}

export function resetLine(feature: BillingFeatureStandingDto): string | null {
  return feature.resetsAt === null
    ? null
    : `Resets on ${DAY_MONTH.format(new Date(feature.resetsAt))}`;
}

/** Percentage used for the meter, or null when there is no limit. */
export function usedPercent(feature: BillingFeatureStandingDto): number | null {
  if (
    !feature.included ||
    feature.kind === "VALUE" ||
    feature.limit === null ||
    feature.limit === 0
  ) {
    return null;
  }
  return Math.round(((feature.used ?? 0) / feature.limit) * 100);
}

export function sourceLine(input: {
  readonly source: "LAUNCH_DEFAULT" | "ADMIN" | "TRIAL" | "STRIPE";
  readonly planName: string;
  readonly endsAt: string | null;
}): string {
  const ends =
    input.endsAt === null ? null : DAY_MONTH.format(new Date(input.endsAt));
  switch (input.source) {
    case "LAUNCH_DEFAULT":
      return `${input.planName} plan · free while Capital Q launches`;
    case "TRIAL":
      return `${input.planName} trial${ends === null ? "" : ` until ${ends}`}`;
    case "STRIPE":
      return `${input.planName} plan${ends === null ? "" : ` · ends ${ends}`}`;
    case "ADMIN":
      return `${input.planName} plan${ends === null ? "" : ` until ${ends}`}`;
  }
}
