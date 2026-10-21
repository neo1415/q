import type { Metadata } from "next";

import { ShortlistPage } from "@/features/discover/shortlist-page";

export const metadata: Metadata = { title: "Passed" };
export const dynamic = "force-dynamic";

/**
 * Passed (doc 19 §66–68; app prototype "shortlist", option 1, its Passed
 * tab): the companies an investor passed on, with Undo pass. A pass hides
 * a company from the feed, never from the investor: each is read back
 * through the ordinary company path, which re-checks disclosure.
 */
export default function PassedPage() {
  return <ShortlistPage tab="PASSED" />;
}
