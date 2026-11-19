import type { Metadata } from "next";

import { getTeam } from "@capital-q/api-client";

import { serverT } from "@/features/i18n/server";
import { orgAdminContext } from "@/features/organisation/org-admin-context";
import { OrgReadOnly } from "@/features/organisation/org-admin-shell";
import { RoleCard } from "@/features/organisation/role-card";
import { apiSession } from "@/features/q/context";
import { QSection } from "@/features/q/q-section";
import { AccountColumn, AccountHead } from "@/features/settings/account-layout";
import { TeamError } from "@/features/team/settings-nav";

export const metadata: Metadata = { title: "Roles · Organisation" };
export const dynamic = "force-dynamic";

/**
 * Organisation → Roles: what each role can do, as the Team screen's role
 * card says it. Read-only for everyone until custom roles exist.
 */
export default async function OrganisationRolesPage() {
  const t = await serverT();
  const context = await orgAdminContext();
  if (context === null) return null;
  const session = await apiSession();
  const team =
    session === null ? null : await getTeam(session).catch(() => null);
  return (
    <OrgReadOnly readOnly={!context.canManage}>
      <AccountColumn>
        <QSection id="roles" kind="TEAM" label={t("what each role can do")}>
          <AccountHead
            title={t("Roles")}
            sub={t(
              "What each role can do. Roles can't be customised yet; change someone's role from Members.",
            )}
          />
          {team === null ? <TeamError /> : <RoleCard team={team} />}
        </QSection>
      </AccountColumn>
    </OrgReadOnly>
  );
}
