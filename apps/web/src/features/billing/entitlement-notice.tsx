import Link from "next/link";

import type { EntitlementProblemExtension } from "@capital-q/contracts";
import { buttonClassName } from "@capital-q/ui/button";
import { InlineNotice } from "@capital-q/ui/states";

/**
 * BILLING (ADR 0034): what a plan-controlled feature answered when the
 * plan does not cover it now. Never a dead button or a silent hide: the
 * person's own plan, their count, when it resets, and the way to the plans.
 */
export function EntitlementNotice({
  entitlement,
}: {
  readonly entitlement: EntitlementProblemExtension;
}) {
  return (
    <InlineNotice
      tone="info"
      title={
        entitlement.reason === "NOT_IN_PLAN"
          ? `${entitlement.featureName} isn't in your plan`
          : `You've used this month's ${entitlement.featureName.toLowerCase()}`
      }
      action={
        <Link
          href={entitlement.upgradePath}
          className={buttonClassName("secondary", "compact")}
        >
          See plans
        </Link>
      }
    >
      {entitlement.message}
    </InlineNotice>
  );
}
