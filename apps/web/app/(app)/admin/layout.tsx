import type { ReactNode } from "react";
import { notFound } from "next/navigation";

import {
  PageContainer,
  PageHeader,
} from "@/components/app-shell/page-container";
import { ConsoleNav, StepUpProvider } from "@/features/admin/console-ui";
import { ROLE_WORDS } from "@/features/admin/words";
import { adminContext } from "@/features/admin/admin-context";
import type { ConsoleCounts } from "@/features/admin/console-nav";
import { getAdminOverview } from "@capital-q/api-client";
import { serverT } from "@/features/i18n/server";

export const dynamic = "force-dynamic";

/**
 * Capital Q's operations console (ADR 0033). The API decides who is an
 * admin and what their role may see; anyone else gets this route's 404,
 * and each section is shown only to roles that hold its permission.
 */
export default async function AdminLayout({
  children,
}: {
  readonly children: ReactNode;
}) {
  const t = await serverT();

  const context = await adminContext();
  if (context === null) notFound();
  const { me, session } = context;
  // The overview's own totals, when this role may read them; none rather
  // than a guess when the read fails.
  const counts: ConsoleCounts | null = context.can("overview.read")
    ? await getAdminOverview(session)
        .then((overview) => ({ people: overview.people }))
        .catch(() => null)
    : null;
  return (
    <PageContainer>
      <PageHeader
        title={t("Admin")}
        description={t(
          `${ROLE_WORDS[me.role] ?? me.role}${
            me.stepUpExpiresAt === null
              ? ""
              : ` · confirmed until ${new Date(me.stepUpExpiresAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} UTC`
          }`,
        )}
      />
      <StepUpProvider>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-10">
          <div className="lg:sticky lg:top-4 lg:self-start">
            <ConsoleNav permissions={me.permissions} counts={counts} />
          </div>
          <div className="flex min-w-0 flex-col gap-8">{children}</div>
        </div>
      </StepUpProvider>
    </PageContainer>
  );
}
