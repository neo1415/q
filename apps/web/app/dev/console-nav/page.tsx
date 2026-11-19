import type { Metadata } from "next";
import { notFound } from "next/navigation";

import {
  PageContainer,
  PageHeader,
} from "@/components/app-shell/page-container";
import { CONSOLE_GROUPS } from "@/features/admin/console-nav";
import { ConsoleNav } from "@/features/admin/console-ui";

// Read per request: the preview's gate is the running server's setting.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Console navigation (design review)",
  robots: { index: false },
};

/**
 * The operations console's grouped sidebar with every section a platform
 * owner holds, for design review against docs/design/admin-2026-11-19
 * (§3.1). Development only; a production build serves it only with
 * CQ_DEV_PREVIEW=1. Nothing here reads or writes, and it grants nothing:
 * the console's own routes still ask the API.
 */
export default function ConsoleNavReviewPage() {
  if (
    process.env.NODE_ENV === "production" &&
    process.env["CQ_DEV_PREVIEW"] !== "1"
  ) {
    notFound();
  }
  const permissions = [
    ...new Set(
      CONSOLE_GROUPS.flatMap((group) =>
        group.sections.flatMap((section) =>
          typeof section.permission === "string"
            ? [section.permission]
            : section.permission,
        ),
      ),
    ),
  ];
  return (
    <PageContainer>
      <PageHeader title="Admin" description="Platform owner" />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-10">
        <div className="lg:sticky lg:top-4 lg:self-start">
          <ConsoleNav permissions={permissions} counts={{ people: 1906 }} />
        </div>
        <p className="cq-body text-(--cq-text-secondary)">
          The current section&apos;s page renders here.
        </p>
      </div>
    </PageContainer>
  );
}
