import { PageSection } from "@/components/app-shell/page-container";
import { AdminDataTableSkeleton } from "@/features/admin/data-table";

/** Accounts while its first page loads: the table's own shape, not a spinner. */
export default function AccountsLoading() {
  return (
    <PageSection id="accounts" title="Accounts">
      <AdminDataTableSkeleton />
    </PageSection>
  );
}
