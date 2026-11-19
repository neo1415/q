import type { Metadata } from "next";

import { orgAdminContext } from "@/features/organisation/org-admin-context";
import { OrgReadOnly } from "@/features/organisation/org-admin-shell";
import { ActivitySection } from "@/features/organisation/activity-section";

export const metadata: Metadata = { title: "Activity log · Organisation" };
export const dynamic = "force-dynamic";

/**
 * Organisation → Activity log: the Activity screen (Settings → Activity).
 * The API shows it to owners and admins; a member gets its honest refusal.
 */
export default async function OrganisationActivityPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await orgAdminContext();
  if (context === null) return null;
  return (
    <OrgReadOnly readOnly={!context.canManage}>
      <ActivitySection params={await searchParams} back={null} />
    </OrgReadOnly>
  );
}
