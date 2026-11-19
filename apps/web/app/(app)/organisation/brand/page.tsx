import type { Metadata } from "next";

import { serverT } from "@/features/i18n/server";
import { orgAdminContext } from "@/features/organisation/org-admin-context";
import { OrgNotBuilt } from "@/features/organisation/org-not-built";
import { OrgReadOnly } from "@/features/organisation/org-admin-shell";

export const metadata: Metadata = {
  title: "Gateway and Q Card brand · Organisation",
};
export const dynamic = "force-dynamic";

/** Organisation → Gateway and Q Card brand: not built yet (admin design 2026-11-19 §2.2). */
export default async function OrganisationBrandPage() {
  const t = await serverT();
  const context = await orgAdminContext();
  if (context === null) return null;
  return (
    <OrgReadOnly readOnly={!context.canManage}>
      <OrgNotBuilt
        t={t}
        title="Gateway and Q Card brand"
        what="The organisation's brand on its GateQ gateway and Q Cards."
        elsewhere={{
          href: "/gateq",
          label: "Open GateQ",
          why: "A gateway's appearance is set on the gateway itself in GateQ.",
        }}
      />
    </OrgReadOnly>
  );
}
