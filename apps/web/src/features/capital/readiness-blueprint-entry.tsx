import Link from "next/link";

import { buttonClassName } from "@capital-q/ui/button";

import { PageSection } from "@/components/app-shell/page-container";

/**
 * The Capital Readiness Blueprint's place on Capital (PADL #85 Layer 2
 * "Pro"; ADR 0036). Not built yet, so it says exactly that: no sample
 * plan, no placeholder steps, nothing that looks like Q's work. The free
 * diagnosis stays one question to Q away.
 */
export function ReadinessBlueprintEntry() {
  return (
    <PageSection
      id="readiness-blueprint"
      title="Readiness Blueprint"
      description="Coming with Pro: Q will turn its diagnosis of your company into a plan of what to fix first, in what order, and what each investor will want to see."
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
