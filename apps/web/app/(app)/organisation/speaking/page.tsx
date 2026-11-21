import type { Metadata } from "next";

import {
  getMyEtiquetteGuide,
  getOrganisationEtiquetteGuide,
} from "@capital-q/api-client";

import { OrganisationGuide } from "@/features/etiquette/organisation-guide";
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
 * Organisation → How Q speaks for us (owner decision 112): the
 * organisation's own guide, which owners and admins write in versions and
 * every member reads, between Capital Q's house guide and each person's
 * own. The API decides who may save.
 */
export default async function OrganisationSpeakingPage() {
  const t = await serverT();
  const context = await orgAdminContext();
  if (context === null) return null;
  const session = await apiSession();
  const [guide, ours] =
    session === null
      ? [null, null]
      : await Promise.all([
          getMyEtiquetteGuide(session).catch(() => null),
          getOrganisationEtiquetteGuide(session).catch(() => null),
        ]);
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
          <OrgSpeakingView
            t={t}
            guide={guide}
            ours={
              ours === null ? null : (
                <OrganisationGuide
                  initial={ours}
                  canManage={context.canManage}
                />
              )
            }
          />
        </QSection>
      </AccountColumn>
    </OrgReadOnly>
  );
}
