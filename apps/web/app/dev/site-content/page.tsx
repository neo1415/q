import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AppShell } from "@/components/app-shell/app-shell";
import {
  PageContainer,
  PageHeader,
  PageSection,
} from "@/components/app-shell/page-container";
import { ContentIndex } from "@/features/site-content/editor/content-index";

import { harnessDetail, harnessIndex } from "./fixtures";
import { SiteContentHarness } from "./site-content-harness";

import "@/features/site-content/site-content.css";

// Read per request: the harness's gate is the running server's setting.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Site content (design review)",
  robots: { index: false },
};

/**
 * The content editor (decision 107) in the real shell over the default
 * content, for design review, screenshots and the browser checks
 * (apps/web/e2e/site-content.spec.ts). Development only; a production
 * build serves it only when CQ_DEV_PREVIEW=1 is set on that server.
 */
export default async function SiteContentReviewPage({
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
  const raw = (await searchParams)["page"];
  const slug = typeof raw === "string" ? raw : null;
  const detail = slug === null ? null : harnessDetail(slug);
  return (
    <AppShell
      context={{
        scope: "investor_private",
        label: "Zino Aviation (fictional)",
        admin: true,
      }}
    >
      <PageContainer className="flex flex-col gap-6">
        <PageHeader title="Admin" description="Platform owner (fictional)" />
        {slug === null || detail === null ? (
          <PageSection
            id="content"
            title="Site content"
            description="The home page, pricing, FAQ and legal pages. Open one to edit it block by block, preview it at desktop and phone widths, and publish. Every published version is kept."
          >
            <ContentIndex
              pages={harnessIndex()}
              hrefOf={(s) => `/dev/site-content?page=${s}`}
            />
          </PageSection>
        ) : (
          <SiteContentHarness detail={detail} slug={slug} />
        )}
      </PageContainer>
    </AppShell>
  );
}
