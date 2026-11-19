import type { Metadata } from "next";

import { orgAdminContext } from "@/features/organisation/org-admin-context";
import { OrgReadOnly } from "@/features/organisation/org-admin-shell";
import { PlanSection } from "@/features/billing/plan-section";

export const metadata: Metadata = { title: "Plan and billing · Organisation" };
export const dynamic = "force-dynamic";

/** Organisation → Plan and billing: the Plan screen (Settings → Plan). */
export default async function OrganisationPlanPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await orgAdminContext();
  if (context === null) return null;
  const checkout = (await searchParams)["checkout"];
  return (
    <OrgReadOnly readOnly={!context.canManage}>
      <PlanSection back={null} checkoutDone={checkout === "done"} />
    </OrgReadOnly>
  );
}
