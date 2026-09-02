import { EmptyState } from "@capital-q/ui/states";

import { PageSection } from "@/components/app-shell/page-container";

/**
 * A restrained region for material changes, relationship activity and
 * intelligence updates. Not a chronological social feed: only what is
 * material appears here, and today nothing is.
 */
export function ActivitySummary() {
  return (
    <PageSection id="activity" title="Recent intelligence">
      <EmptyState
        compact
        title="Nothing material yet."
        description="Material changes, relationship activity and intelligence updates appear here as they happen. Not everything, just what matters."
      />
    </PageSection>
  );
}
