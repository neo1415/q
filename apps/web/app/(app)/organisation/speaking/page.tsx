import type { Metadata } from "next";

import { getMyEtiquetteGuide } from "@capital-q/api-client";

import { serverT } from "@/features/i18n/server";
import { orgAdminContext } from "@/features/organisation/org-admin-context";
import { OrgReadOnly } from "@/features/organisation/org-admin-shell";
import { OrgSpeakingView } from "@/features/organisation/org-sections-views";
import { apiSession } from "@/features/q/context";
import { QSection } from "@/features/q/q-section";
import { AccountColumn, AccountHead } from "@/features/settings/account-layout";

export const metadata: Metadata = {
  title: "How Q speaks for us · Organisation",
};
export const dynamic = "force-dynamic";

/**
 * Organisation → How Q speaks for us (owner decision 112). Capital Q keeps
 * a house guide and each person's own guide; there is no organisation-wide
 * store, so this shows what applies now, read-only, and says that an
 * organisation guide is not built. No storage is invented here.
 */
export default async function OrganisationSpeakingPage() {
  const t = await serverT();
  const context = await orgAdminContext();
  if (context === null) return null;
  const session = await apiSession();
  const guide =
    session === null
      ? null
      : await getMyEtiquetteGuide(session).catch(() => null);
  return (
    <OrgReadOnly readOnly={!context.canManage}>
      <AccountColumn>
        <QSection id="speaking" kind="OTHER" label={t("how Q speaks for us")}>
          <AccountHead
            title={t("How Q speaks for us")}
            sub={t(
              "The organisation's own guide for how Q writes and speaks on its behalf.",
            )}
          />
          <OrgSpeakingView t={t} guide={guide} />
        </QSection>
      </AccountColumn>
    </OrgReadOnly>
  );
}
