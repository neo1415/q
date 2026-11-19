import type { Metadata } from "next";

import { serverT } from "@/features/i18n/server";
import { orgAdminContext } from "@/features/organisation/org-admin-context";
import { OrgNotBuilt } from "@/features/organisation/org-not-built";
import { OrgReadOnly } from "@/features/organisation/org-admin-shell";

export const metadata: Metadata = { title: "Privacy · Organisation" };
export const dynamic = "force-dynamic";

/** Organisation → Privacy: not built yet (admin design 2026-11-19 §2.2). */
export default async function OrganisationPrivacyPage() {
  const t = await serverT();
  const context = await orgAdminContext();
  if (context === null) return null;
  return (
    <OrgReadOnly readOnly={!context.canManage}>
      <OrgNotBuilt
        t={t}
        title="Privacy"
        what="Who can see the organisation, and its visibility on the network."
      />
    </OrgReadOnly>
  );
}
