import { IndexLoading } from "@/components/app-shell/page-loading";
import { WorkLoading } from "@/features/work/work-loading";

/** Work's Tasks tab while it loads: Work's header and tabs, then rows. */
export default function WorkTasksLoading() {
  return (
    <IndexLoading path="/work">
      <WorkLoading view="tasks" label="Loading your tasks" />
    </IndexLoading>
  );
}
