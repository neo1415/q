import { PageSection } from "@/components/app-shell/page-container";
import { AdminDataTableSkeleton } from "@/features/admin/data-table";

/** Organisations while its first page loads: the table's own shape, not a spinner. */
export default function OrganisationsLoading() {
  return (
    <PageSection id="organisations" title="Organisations">
      <AdminDataTableSkeleton />
    </PageSection>
  );
}
