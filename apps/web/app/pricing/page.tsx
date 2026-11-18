import type { Metadata } from "next";

import { publishedSitePage } from "@/features/site-content/public-site";
import {
  SiteNotYetPublished,
  SitePageFrame,
} from "@/features/site-content/site-chrome";
import { SitePageView } from "@/features/site-content/site-page-view";

/** Decision 107: the pricing page, rendered from its published version. */
export const revalidate = 60;

export async function generateMetadata(): Promise<Metadata> {
  const page = await publishedSitePage("pricing");
  return {
    title: { absolute: "Pricing · Capital Q" },
    description: page?.summary ?? "Plans for founders and investors.",
    alternates: { canonical: "/pricing" },
    robots: page === null ? { index: false } : { index: true, follow: true },
  };
}

export default async function PricingPage() {
  const page = await publishedSitePage("pricing");
  return (
    <SitePageFrame>
      {page === null || page.kind !== "pricing" ? (
        <SiteNotYetPublished title="Pricing" />
      ) : (
        <SitePageView page={page} />
      )}
    </SitePageFrame>
  );
}
