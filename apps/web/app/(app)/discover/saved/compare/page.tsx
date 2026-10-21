import type { Metadata } from "next";

import { ShortlistPage } from "@/features/discover/shortlist-page";

export const metadata: Metadata = { title: "Compare" };
export const dynamic = "force-dynamic";

/**
 * Compare (Q.10; app prototype "shortlist", option 1, its Compare tab):
 * the investor's top three by fit with their mandate, or the 2 to 4
 * companies the address names (`?ids=`), side by side. Each id is
 * re-checked by the fit service; one the reader may not see is absent.
 * The same comparison Q's `fit_compare` returns.
 */
export default async function SavedComparePage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly ids?: string | string[] }>;
}) {
  const ids = [(await searchParams).ids].flat()[0];
  return <ShortlistPage tab="COMPARE" compareIds={ids} />;
}
