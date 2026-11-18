import type { Metadata } from "next";
import { notFound } from "next/navigation";

import {
  publicSiteBlocks,
  resolveSitePlaceholders,
} from "@capital-q/contracts";

import { SitePageFrame } from "@/features/site-content/site-chrome";
import { SitePageView } from "@/features/site-content/site-page-view";

import { HARNESS_SETTINGS, harnessPage } from "../../fixtures";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Site page (design review)",
  robots: { index: false },
};

/**
 * A public site page (decision 107) exactly as /pricing, /faq or
 * /legal/<slug> renders a published version, over the default content
 * with no API: the same frame, the same projection (lawyer notes out,
 * placeholders in). Development only, like every /dev page.
 */
export default async function SitePublicReviewPage({
  params,
}: {
  readonly params: Promise<{ readonly slug: string }>;
}) {
  if (
    process.env.NODE_ENV === "production" &&
    process.env["CQ_DEV_PREVIEW"] !== "1"
  ) {
    notFound();
  }
  const page = harnessPage((await params).slug);
  if (page === null || page.kind === "landing-section") notFound();
  return (
    <SitePageFrame>
      <SitePageView
        page={{
          kind: page.kind,
          title: resolveSitePlaceholders(page.title, HARNESS_SETTINGS),
          summary: resolveSitePlaceholders(page.summary, HARNESS_SETTINGS),
          effectiveDate: page.effectiveDate,
          versionNumber: 1,
          blocks: publicSiteBlocks(page.blocks, HARNESS_SETTINGS),
        }}
      />
    </SitePageFrame>
  );
}
