import type { Metadata } from "next";

import { VisibilityScreen } from "@/features/company/visibility-screen";
import { serverT } from "@/features/i18n/server";
import { InvestorVisibilityScreen } from "@/features/investor/visibility-screen";
import { orgAdminContext } from "@/features/organisation/org-admin-context";
import { OrgReadOnly } from "@/features/organisation/org-admin-shell";
import { OrgPrivacyLinks } from "@/features/organisation/org-sections-views";
import { resolveOwnContext } from "@/features/q/context";
import { QSection } from "@/features/q/q-section";
import {
  AccountColumn,
  AccountHead,
  GroupHead,
} from "@/features/settings/account-layout";

export const metadata: Metadata = { title: "Privacy · Organisation" };
export const dynamic = "force-dynamic";

/**
 * Organisation → Privacy (owner decision 112): who can see the company or
 * firm, and what each audience sees, through the same visibility screen
 * the profile opens (the server's own preview and shares). A member sees
 * it read-only, and the API refuses their changes (company.edit /
 * investor.edit). A person's own Q Card is theirs: linked, not moved.
 */
export default async function OrganisationPrivacyPage() {
  const t = await serverT();
  const [context, own] = await Promise.all([
    orgAdminContext(),
    resolveOwnContext(),
  ]);
  if (context === null) return null;
  return (
    <OrgReadOnly readOnly={!context.canManage}>
      <AccountColumn>
        <QSection id="privacy" kind="VISIBILITY" label={t("privacy")}>
          <AccountHead
            title={t("Privacy")}
            sub={t(
              "Who can see the organisation, and its visibility on the network.",
            )}
          />
          <GroupHead title={t("Who can see the organisation")} />
          {own.kind === "FOUNDER" ? (
            <VisibilityScreen companyId={own.companyId} />
          ) : own.kind === "INVESTOR" ? (
            <InvestorVisibilityScreen
              investorOrganisationId={own.investorOrganisationId}
            />
          ) : (
            <p className="m-0 cq-body-sm text-(--cq-text-secondary)">
              {t(
                "Visibility applies once the organisation has a company or investor profile.",
              )}
            </p>
          )}
          <OrgPrivacyLinks t={t} />
        </QSection>
      </AccountColumn>
    </OrgReadOnly>
  );
}
