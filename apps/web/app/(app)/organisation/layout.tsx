import type { ReactNode } from "react";

import { EmptyState } from "@capital-q/ui/states";

import { PageContainer } from "@/components/app-shell/page-container";
import { serverT } from "@/features/i18n/server";
import { orgAdminContext } from "@/features/organisation/org-admin-context";
import { OrgAdminFrame } from "@/features/organisation/org-admin-shell";

// Read per request, under the person's own session.
export const dynamic = "force-dynamic";

/**
 * The organisation admin (admin design 2026-11-19 §3.2; decisions 109 and
 * 110): the active organisation's own settings, inside the product shell.
 * The scope bar names the organisation and the person's role; the section
 * index sits beside the page. Members see every section read-only. No
 * permission is added here: each section calls the API it already called,
 * and the API's membership checks stay the authority.
 */
export default async function OrganisationLayout({
  children,
}: {
  readonly children: ReactNode;
}) {
  const t = await serverT();
  const context = await orgAdminContext();
  if (context === null) {
    return (
      <PageContainer width="content">
        <EmptyState
          title={t("No organisation yet")}
          description={t(
            "The organisation admin appears once you act for a company or firm on Capital Q.",
          )}
        />
      </PageContainer>
    );
  }
  return (
    <OrgAdminFrame
      name={context.organisation.name}
      role={context.role}
      organisations={context.organisations}
    >
      {children}
    </OrgAdminFrame>
  );
}
