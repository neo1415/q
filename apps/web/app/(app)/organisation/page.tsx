import type { Metadata } from "next";

import { serverT } from "@/features/i18n/server";
import { orgAdminContext } from "@/features/organisation/org-admin-context";
import { OrgReadOnly } from "@/features/organisation/org-admin-shell";
import { ROLE_NAME } from "@/features/organisation/org-admin-sections";
import { QSection } from "@/features/q/q-section";
import { AccountColumn, AccountHead } from "@/features/settings/account-layout";
import { teamWords } from "@/features/team/team-words";

export const metadata: Metadata = { title: "Organisation" };
export const dynamic = "force-dynamic";

/**
 * Organisation → General: what Capital Q holds about the organisation the
 * person acts for, from their own membership read. Editing the name, logo,
 * website or country here is not built yet, and the page says so.
 */
export default async function OrganisationGeneralPage() {
  const t = await serverT();
  const context = await orgAdminContext();
  if (context === null) return null;
  const { organisation } = context;
  const facts: readonly (readonly [string, string])[] = [
    ["Name", organisation.name],
    ["Kind", teamWords(organisation.kind).label],
    [
      "Members",
      organisation.memberCount === 1
        ? "Just you"
        : `${String(organisation.memberCount)} people`,
    ],
    ["Your role", ROLE_NAME[context.role].replace(/^an? /u, "")],
  ];
  return (
    <OrgReadOnly readOnly={!context.canManage}>
      <AccountColumn>
        <QSection id="organisation" kind="TEAM" label={t("your organisation")}>
          <AccountHead
            title={t("General")}
            sub={t(`What Capital Q holds about ${organisation.name}.`)}
          />
          <dl
            className="m-0 grid max-w-[60ch] grid-cols-[minmax(8rem,auto)_minmax(0,1fr)] gap-x-6 gap-y-3 rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface-raised) p-5"
            data-org-general
          >
            {facts.map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="cq-body-sm text-(--cq-text-secondary)">
                  {t(label)}
                </dt>
                <dd className="m-0 cq-body-sm text-(--cq-text-primary)">
                  {label === "Name" ? value : t(value)}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 max-w-[60ch] cq-body-sm text-(--cq-text-secondary)">
            {t(
              "Not built yet: changing the name, logo, website and country here, and handing ownership over. Until then the profile holds them.",
            )}
          </p>
        </QSection>
      </AccountColumn>
    </OrgReadOnly>
  );
}
