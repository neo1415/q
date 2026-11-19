import type { Metadata } from "next";

import { getMyPlan } from "@capital-q/api-client";

import { PlanAllowances } from "@/features/billing/plan-board";
import { orgAdminContext } from "@/features/organisation/org-admin-context";
import { OrgReadOnly } from "@/features/organisation/org-admin-shell";
import { apiSession } from "@/features/q/context";
import { TeamSection } from "@/features/team/team-section";

export const metadata: Metadata = { title: "Members and usage · Organisation" };
export const dynamic = "force-dynamic";

/**
 * Organisation → Members and usage: the Team screen (Settings → Team), and
 * the organisation plan's allowances and use. The API answers both for the
 * active organisation and decides what each role may do.
 */
export default async function OrganisationMembersPage() {
  const context = await orgAdminContext();
  if (context === null) return null;
  const session = await apiSession();
  const plan =
    session === null ? null : await getMyPlan(session).catch(() => null);
  return (
    <OrgReadOnly readOnly={!context.canManage}>
      <TeamSection back={null} />
      {plan === null ? null : (
        <div className="mx-auto w-full max-w-[calc(820px+4rem)] px-4 pb-28 sm:px-6 lg:px-8">
          <PlanAllowances plan={plan} />
        </div>
      )}
    </OrgReadOnly>
  );
}
