import type { ReactNode } from "react";
import { notFound } from "next/navigation";

import {
  PageContainer,
  PageHeader,
} from "@/components/app-shell/page-container";
import { ConsoleNav, StepUpProvider } from "@/features/admin/console-ui";
import { ROLE_WORDS } from "@/features/admin/words";
import { adminContext } from "@/features/admin/admin-context";

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
  const context = await adminContext();
  if (context === null) notFound();
  const { me } = context;
  return (
    <PageContainer>
      <PageHeader
        title="Admin"
        description={`${ROLE_WORDS[me.role] ?? me.role}${
          me.stepUpExpiresAt === null
            ? ""
            : ` · confirmed until ${new Date(me.stepUpExpiresAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} UTC`
        }`}
      />
      <StepUpProvider>
        <div className="flex flex-col gap-8">
          <ConsoleNav permissions={me.permissions} />
          {children}
        </div>
      </StepUpProvider>
    </PageContainer>
  );
}
