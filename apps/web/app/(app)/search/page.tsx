import type { Metadata } from "next";

import { requireSessionUser } from "@/auth/session";
import {
  PageContainer,
  PageHeader,
} from "@/components/app-shell/page-container";
import { SearchHome } from "@/features/search/search-home";
import { QSection } from "@/features/q/q-section";
import { serverT } from "@/features/i18n/server";

export const metadata: Metadata = { title: "Search" };
export const dynamic = "force-dynamic";

/**
 * Search (founder direction 2026-09-29; app prototype "search", option 2,
 * "Search palette", warm charcoal). One place to look someone up: the bar
 * opens the palette (also / from anywhere), which searches a name among
 * the people this person already sees, opens anyone's Q Card by their
 * whole @handle, and finds the videos founders opened to everyone. Below
 * the bar, what they opened recently. An address with `?q=` (the old
 * /find, or Q) opens the palette with it.
 */
export default async function SearchPage({
  searchParams,
}: {
  readonly searchParams?: Promise<{
    readonly q?: string | string[];
    readonly handle?: string | string[];
  }>;
} = {}) {
  const t = await serverT();
  const user = await requireSessionUser("/search");
  const params = (await searchParams) ?? {};
  const raw =
    typeof params.q === "string"
      ? params.q
      : typeof params.handle === "string"
        ? params.handle
        : "";
  const text = raw.trim().slice(0, 80);
  return (
    <PageContainer className="cq-charcoal">
      <QSection id="search" kind="SEARCH_RESULTS" label={t("search results")}>
        <PageHeader
          title={t("Search")}
          description={t(
            "One place to look someone up. Press / from anywhere.",
          )}
        />
        <SearchHome viewer={user.authUserId} initialQuery={text} />
      </QSection>
    </PageContainer>
  );
}
