import { EmptyState } from "@capital-q/ui/states";

import { PageSection } from "@/components/app-shell/page-container";

/**
 * A restrained region for material changes, relationship activity and
 * intelligence updates. Not a chronological social feed: only what is
 * material appears here, and today nothing is.
 */
export function ActivitySummary() {
  return (
    <PageSection id="activity" title="Recent updates">
      <EmptyState
        compact
        title="Nothing important yet."
        description="Important changes, relationship news and new findings from Q appear here as they happen. Not everything, just what matters."
      />
    </PageSection>
  );
}
