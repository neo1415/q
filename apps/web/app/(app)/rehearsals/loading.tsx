import { IndexLoading } from "@/components/app-shell/page-loading";
import { WorkLoading } from "@/features/work/work-loading";

/**
 * Work's Rehearsals tab while it loads: Work's header and tabs, then rows.
 * A rehearsal room or record under /rehearsals keeps its own shape.
 */
export default function RehearsalsLoading() {
  return (
    <IndexLoading path="/rehearsals">
      <WorkLoading view="rehearsals" label="Loading your rehearsals" />
    </IndexLoading>
  );
}
