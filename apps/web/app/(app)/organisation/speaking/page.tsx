import type { Metadata } from "next";

import { serverT } from "@/features/i18n/server";
import { orgAdminContext } from "@/features/organisation/org-admin-context";
import { OrgNotBuilt } from "@/features/organisation/org-not-built";
import { OrgReadOnly } from "@/features/organisation/org-admin-shell";

export const metadata: Metadata = {
  title: "How Q speaks for us · Organisation",
};
export const dynamic = "force-dynamic";

/** Organisation → How Q speaks for us: not built yet (admin design 2026-11-19 §2.2). */
export default async function OrganisationSpeakingPage() {
  const t = await serverT();
  const context = await orgAdminContext();
  if (context === null) return null;
  return (
    <OrgReadOnly readOnly={!context.canManage}>
      <OrgNotBuilt
        t={t}
        title="How Q speaks for us"
        what="The organisation's own guide for how Q writes and speaks on its behalf."
        elsewhere={{
          href: "/settings#speaking",
          label: "Open your guide",
          why: "Today each person sets how Q speaks for them in Settings.",
        }}
      />
    </OrgReadOnly>
  );
}
