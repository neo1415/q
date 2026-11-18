import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { publishedSitePage } from "@/features/site-content/public-site";
import {
  SITE_LEGAL_LINKS,
  SiteNotYetPublished,
  SitePageFrame,
} from "@/features/site-content/site-chrome";
import { SitePageView } from "@/features/site-content/site-page-view";

/**
 * Decision 107: the legal pages, from their published versions. A legal
 * page goes live only when an admin confirms a lawyer approved it; until
 * then it says it is being prepared, and is not indexed.
 */
export const revalidate = 60;

type Props = { readonly params: Promise<{ readonly slug: string }> };

const LEGAL = new Map<string, string>(
  SITE_LEGAL_LINKS.map((link) => [
    link.href.replace("/legal/", ""),
    link.label,
  ]),
);

export function generateStaticParams() {
  return [...LEGAL.keys()].map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const label = LEGAL.get(slug);
  if (label === undefined) return { title: "Capital Q" };
  const page = await publishedSitePage(slug);
  return {
    title: { absolute: `${page?.title ?? label} · Capital Q` },
    description: page?.summary ?? label,
    alternates: { canonical: `/legal/${slug}` },
    robots: page === null ? { index: false } : { index: true, follow: true },
  };
}

export default async function LegalPage({ params }: Props) {
  const { slug } = await params;
  const label = LEGAL.get(slug);
  if (label === undefined) notFound();
  const page = await publishedSitePage(slug);
  return (
    <SitePageFrame>
      {page === null || page.kind !== "legal" ? (
        <SiteNotYetPublished title={label} />
      ) : (
        <SitePageView page={page} />
      )}
    </SitePageFrame>
  );
}
