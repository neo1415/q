import { IndexLoading } from "@/components/app-shell/page-loading";
import { WorkLoading } from "@/features/work/work-loading";

/** Work's Documents tab while it loads: Work's header and tabs, then rows. */
export default function DocumentsLoading() {
  return (
    <IndexLoading path="/documents">
      <WorkLoading view="documents" label="Loading your documents" />
    </IndexLoading>
  );
}
