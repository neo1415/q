import type { Metadata } from "next";

import { serverT } from "@/features/i18n/server";
import { orgAdminContext } from "@/features/organisation/org-admin-context";
import { OrgNotBuilt } from "@/features/organisation/org-not-built";
import { OrgReadOnly } from "@/features/organisation/org-admin-shell";

export const metadata: Metadata = { title: "Connections · Organisation" };
export const dynamic = "force-dynamic";

/** Organisation → Connections: not built yet (admin design 2026-11-19 §2.2). */
export default async function OrganisationConnectionsPage() {
  const t = await serverT();
  const context = await orgAdminContext();
  if (context === null) return null;
  return (
    <OrgReadOnly readOnly={!context.canManage}>
      <OrgNotBuilt
        t={t}
        title="Connections"
        what="The organisation's connected accounts and Q's inbound email address."
        elsewhere={{
          href: "/settings#connections",
          label: "Open your connections",
          why: "Today each person connects their own Google account in Settings.",
        }}
      />
    </OrgReadOnly>
  );
}
