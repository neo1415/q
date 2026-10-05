/**
 * Billing page plan tiers (P5): the ONE place the shown plans and prices
 * live, so changing a price or a line is a one-line, reviewed diff. Bump
 * `version` with any change.
 *
 * PREVIEW ONLY: these are display prices. Nothing reads them to charge,
 * gate or limit anyone; what a plan actually allows comes from the billing
 * service (ADR 0034) and is shown on the plan page. Money is a decimal
 * string with its ISO currency, never a float.
 */

export type PlanTier = {
  readonly key: "founder" | "investor" | "fund";
  readonly name: string;
  /** Who it is for, in one plain line. */
  readonly forWhom: string;
  /** Decimal string per month, or null for "Talk to us". */
  readonly monthly: string | null;
  readonly highlights: readonly string[];
  /** Billing-service plan keys this tier stands for ("Your plan"). */
  readonly planKeys: readonly string[];
  /** The account kind it suits, for a quiet "Suits you" mark. */
  readonly suits: "FOUNDER" | "INVESTOR";
};

export const PLAN_TIERS = {
  version: 1,
  currency: "USD",
  preview: true,
  tiers: [
    {
      key: "founder",
      name: "Founder",
      forWhom: "For a company preparing or running a raise.",
      monthly: "49.00",
      highlights: [
        "Q's diagnosis and readiness, kept current",
        "Pitch rehearsals with Q",
        "Share your pitch and data room with investors",
      ],
      planKeys: ["founder", "founder_pro"],
      suits: "FOUNDER",
    },
    {
      key: "investor",
      name: "Investor",
      forWhom: "For an angel or a partner sourcing deals.",
      monthly: "149.00",
      highlights: [
        "A Discover feed shaped by your mandate",
        "Q research on any company",
        "Relationships and notes in one place",
      ],
      planKeys: ["investor", "investor_pro"],
      suits: "INVESTOR",
    },
    {
      key: "fund",
      name: "Fund",
      forWhom: "For a team running a pipeline together.",
      monthly: "990.00",
      highlights: [
        "Everything in Investor",
        "Seats for the whole team",
        "Shared relationships, memos and diligence",
      ],
      planKeys: ["fund", "fund_team"],
      suits: "INVESTOR",
    },
  ],
} as const satisfies {
  readonly version: number;
  readonly currency: string;
  readonly preview: boolean;
  readonly tiers: readonly PlanTier[];
};

/** "$49" for whole amounts, "$49.50" otherwise; null → "Talk to us". */
export function tierPrice(
  monthly: string | null,
  currency: string = PLAN_TIERS.currency,
): string {
  if (monthly === null) return "Talk to us";
  const [whole = "0", cents = "00"] = monthly.split(".");
  const symbol = currency === "USD" ? "$" : `${currency} `;
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/gu, ",");
  return cents === "00" || cents === "0"
    ? `${symbol}${grouped}`
    : `${symbol}${grouped}.${cents.padEnd(2, "0")}`;
}

/** The tier a billing-service plan key stands for, if any. */
export function tierOfPlan(planKey: string): PlanTier | null {
  return (
    PLAN_TIERS.tiers.find((tier) =>
      (tier.planKeys as readonly string[]).includes(planKey),
    ) ?? null
  );
}
