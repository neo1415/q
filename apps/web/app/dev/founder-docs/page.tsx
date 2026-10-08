import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AppShell } from "@/components/app-shell/app-shell";
import {
  PageContainer,
  PageHeader,
} from "@/components/app-shell/page-container";

import { FounderDocsHarness } from "./founder-docs-harness";

// Read per request: the harness's gate is the running server's setting.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Founder documents (design review)",
  robots: { index: false },
};

const VIEWS = [
  "requested",
  "dataroom",
  "access",
  "folder",
  "investor",
] as const;

/**
 * Founder documents (2026-10-08) in the real shell, with fictional data,
 * for design review, screenshots and the browser checks
 * (apps/web/e2e/founder-docs.spec.ts). Development only; a production
 * build serves it only when CQ_DEV_PREVIEW=1 is set on that server.
 */
export default async function FounderDocsReviewPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (
    process.env.NODE_ENV === "production" &&
    process.env["CQ_DEV_PREVIEW"] !== "1"
  ) {
    notFound();
  }
  const params = await searchParams;
  const raw = params["view"];
  const view =
    VIEWS.find((candidate) => candidate === raw) ?? ("requested" as const);
  const item = typeof params["item"] === "string" ? params["item"] : null;
  const investor = view === "investor";
  return (
    <AppShell
      context={{
        scope: investor ? "investor_private" : "founder_private",
        label: investor ? "Zino Capital (fictional)" : "Ledgerline (fictional)",
        admin: false,
      }}
    >
      <PageContainer className="flex flex-col gap-6">
        <PageHeader title={investor ? "Ledgerline (fictional)" : "Documents"} />
        <FounderDocsHarness view={view} item={item} />
      </PageContainer>
    </AppShell>
  );
}
