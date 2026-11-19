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
          label: "Open your data rights",
          why: "Your own data rights, export and deletion, are in Settings.",
        }}
      />
    </OrgReadOnly>
  );
}
