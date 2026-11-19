import type { Metadata } from "next";

import { serverT } from "@/features/i18n/server";
import { orgAdminContext } from "@/features/organisation/org-admin-context";
import { OrgReadOnly } from "@/features/organisation/org-admin-shell";
import { QSection } from "@/features/q/q-section";
import { AccountColumn, AccountHead } from "@/features/settings/account-layout";
import { accountButton } from "@/features/settings/account-styles";
import Link from "next/link";

export const metadata: Metadata = { title: "Import · Organisation" };
export const dynamic = "force-dynamic";

/**
 * Organisation → Import: the pipeline import lives in the CRM
 * (/relationships/import), where Q reads the file and shows every change
 * before it is made. This section points there rather than copying it.
 */
export default async function OrganisationImportPage() {
  const t = await serverT();
  const context = await orgAdminContext();
  if (context === null) return null;
  return (
    <OrgReadOnly readOnly={!context.canManage}>
      <AccountColumn>
        <QSection id="import" kind="OTHER" label={t("importing your pipeline")}>
          <AccountHead
            title={t("Import")}
            sub={t(
              "Bring the pipeline you already keep: a CRM or spreadsheet export. Q reads it, matches each row on Capital Q and shows you everything before it changes.",
            )}
          />
          {context.canManage ? (
            <Link
              href="/relationships/import"
              className={accountButton("primary", "regular")}
              data-org-import
            >
              {t("Import your pipeline")}
            </Link>
          ) : (
            <button
              type="button"
              disabled
              className={accountButton("primary", "regular")}
              data-org-import
            >
              {t("Import your pipeline")}
            </button>
          )}
        </QSection>
      </AccountColumn>
    </OrgReadOnly>
  );
}
