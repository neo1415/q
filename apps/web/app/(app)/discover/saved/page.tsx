import type { Metadata } from "next";

import { ShortlistPage } from "@/features/discover/shortlist-page";

export const metadata: Metadata = { title: "Saved" };
export const dynamic = "force-dynamic";

/**
 * Saved (doc 17 §100; ux-direction §13; app prototype "shortlist",
 * option 1): the companies an investor saved to revisit, best fit first.
 * A save is "I want to come back to this", never interest. Each company is
 * read back through the ordinary company path, which re-checks disclosure:
 * one that has stopped being discoverable is simply not shown, because
 * once being saved must not leak it.
 */
export default function SavedPage() {
  return <ShortlistPage tab="SAVED" />;
}
