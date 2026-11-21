import type { Metadata } from "next";

import { serverT } from "@/features/i18n/server";
import { orgAdminContext } from "@/features/organisation/org-admin-context";
import { OrgNotBuilt } from "@/features/organisation/org-not-built";
import { OrgReadOnly } from "@/features/organisation/org-admin-shell";

export const metadata: Metadata = {
  title: "Export and deletion · Organisation",
};
export const dynamic = "force-dynamic";

/** Organisation → Export and deletion: not built yet (admin design 2026-11-19 §2.2). */
export default async function OrganisationDataPage() {
  const t = await serverT();
  const context = await orgAdminContext();
  if (context === null) return null;
  return (
    <OrgReadOnly readOnly={!context.canManage}>
      <OrgNotBuilt
        t={t}
        title="Export and deletion"
        what="Exporting or deleting the organisation's data as a whole."
        elsewhere={{
          href: "/settings/data",
          label: "Export or delete your own data",
          why: "Exporting or deleting the organisation as a whole isn't built yet. Your own data is yours to export or delete now, in Settings; it covers you, not the organisation.",
        }}
      />
    </OrgReadOnly>
  );
}
