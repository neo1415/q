import type { Metadata } from "next";

import { serverT } from "@/features/i18n/server";
import { orgAdminContext } from "@/features/organisation/org-admin-context";
import { OrgReadOnly } from "@/features/organisation/org-admin-shell";
import { OrgGeneralView } from "@/features/organisation/org-general";
import {
  loadProfileImages,
  loadProfilePage,
} from "@/features/profile/profile-data";
import { apiSession, resolveOwnContext } from "@/features/q/context";

export const metadata: Metadata = { title: "Organisation" };
export const dynamic = "force-dynamic";

/**
 * Organisation → General: the organisation's own details, read under the
 * person's own session (the company or investor organisation they act
 * for) and edited through the same commands the profile page and Q use.
 */
export default async function OrganisationGeneralPage() {
  const t = await serverT();
  const context = await orgAdminContext();
  if (context === null) return null;
  const [session, own] = await Promise.all([apiSession(), resolveOwnContext()]);
  const data = await loadProfilePage(session, own);
  const images =
    data.company !== null
      ? await loadProfileImages(session, "COMPANY", data.company.id)
      : data.investor !== null
        ? await loadProfileImages(
            session,
            "INVESTOR_ORGANISATION",
            data.investor.id,
          )
        : null;
  return (
    <OrgReadOnly readOnly={!context.canManage}>
      <OrgGeneralView
        t={t}
        organisation={context.organisation}
        role={context.role}
        canManage={context.canManage}
        company={data.company}
        investor={data.investor}
        images={images}
        unavailable={own.kind === "NONE" && own.unavailable === true}
      />
    </OrgReadOnly>
  );
}
