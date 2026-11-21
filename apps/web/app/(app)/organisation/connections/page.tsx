import type { Metadata } from "next";

import {
  getGoogleConnection,
  getInboundEmailAddress,
  getKyb,
  getVerificationProviders,
} from "@capital-q/api-client";

import { serverT } from "@/features/i18n/server";
import { orgAdminContext } from "@/features/organisation/org-admin-context";
import { OrgReadOnly } from "@/features/organisation/org-admin-shell";
import { OrgConnectionsView } from "@/features/organisation/org-sections-views";
import { apiSession } from "@/features/q/context";
import { QSection } from "@/features/q/q-section";
import { AccountColumn, AccountHead } from "@/features/settings/account-layout";

export const metadata: Metadata = { title: "Connections · Organisation" };
export const dynamic = "force-dynamic";

/**
 * Organisation → Connections (owner decision 112): what is connected, read
 * from each thing's own API as this person; "not connected" is said when
 * it is so. Nothing is changed here: each line opens the screen that
 * changes it, and that screen's API decides who may.
 */
export default async function OrganisationConnectionsPage() {
  const t = await serverT();
  const context = await orgAdminContext();
  if (context === null) return null;
  const session = await apiSession();
  const [kyb, providers, google, inbound] =
    session === null
      ? [null, null, null, null]
      : await Promise.all([
          getKyb(session).catch(() => null),
          getVerificationProviders(session).catch(() => null),
          getGoogleConnection(session).catch(() => null),
          getInboundEmailAddress(session).catch(() => null),
        ]);
  return (
    <OrgReadOnly readOnly={!context.canManage}>
      <AccountColumn>
        <QSection id="connections" kind="OTHER" label={t("connections")}>
          <AccountHead
            title={t("Connections")}
            sub={t(
              "What the organisation has connected, and what each person connects for themselves. Each line says what is true now.",
            )}
          />
          <OrgConnectionsView
            t={t}
            kyb={kyb}
            providers={providers}
            google={google}
            inbound={inbound}
          />
        </QSection>
      </AccountColumn>
    </OrgReadOnly>
  );
}
