import Link from "next/link";

import { buttonClassName } from "@capital-q/ui/button";

import { PageSection } from "@/components/app-shell/page-container";

/**
 * The Capital Readiness Blueprint's place on Capital (PADL #85 Layer 2
 * "Pro"; ADR 0036). The free diagnosis and action plan sit above it; the
 * Blueprint sequences that same plan over 3, 6 or 12 months (built by
 * code from the diagnosis, plan-gated at its route). No sample plan here.
 */
export function ReadinessBlueprintEntry() {
  return (
    <PageSection
      id="readiness-blueprint"
      title="Readiness Blueprint"
      description="With Pro, Q sequences the action plan above over 3, 6 or 12 months, each step tied to the gap it closes."
    >
      <div className="flex flex-wrap gap-2">
        <Link
          href="/home#q"
          className={buttonClassName("secondary", "compact")}
        >
          Ask Q how investors see you
        </Link>
        <Link
          href="/settings/plan"
          className={buttonClassName("quiet", "compact")}
        >
          See plans
        </Link>
      </div>
    </PageSection>
  );
}
