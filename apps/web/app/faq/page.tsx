import type { Metadata } from "next";

import { publishedSitePage } from "@/features/site-content/public-site";
import {
  SiteNotYetPublished,
  SitePageFrame,
} from "@/features/site-content/site-chrome";
import { SitePageView } from "@/features/site-content/site-page-view";

/** Decision 107: the FAQ, rendered from its published version. */
export const revalidate = 60;

export async function generateMetadata(): Promise<Metadata> {
  const page = await publishedSitePage("faq");
  return {
    title: { absolute: "Frequently asked questions · Capital Q" },
    description: page?.summary ?? "Answers about how Capital Q works.",
    alternates: { canonical: "/faq" },
    robots: page === null ? { index: false } : { index: true, follow: true },
  };
}

export default async function FaqPage() {
  const page = await publishedSitePage("faq");
  return (
    <SitePageFrame>
      {page === null || page.kind !== "faq" ? (
        <SiteNotYetPublished title="Frequently asked questions" />
      ) : (
        <SitePageView page={page} />
      )}
    </SitePageFrame>
  );
}
