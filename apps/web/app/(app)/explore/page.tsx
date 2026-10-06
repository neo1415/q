import type { Metadata } from "next";

import { exploreSlate, listTaxonomyNodes } from "@capital-q/api-client";

import { PageContainer } from "@/components/app-shell/page-container";
import { loadExploreSearch } from "@/features/explore/explore-search";
import { searchTabOf } from "@/features/explore/explore-search-view";
import { ExploreScreen } from "@/features/explore/explore-screen";
import { apiSession } from "@/features/q/context";

export const metadata: Metadata = { title: "Explore" };
export const dynamic = "force-dynamic";

/**
 * Explore (E1-E5, ADR 0055), what "Search" became: every pitch on the
 * network this person may see, lightly personalised, as a masonry grid,
 * with search at the top. The first page is read here under the person's
 * own session so the grid can render on arrival; the client owns every
 * page after, by cursor. With `?q=`, the same page shows search results,
 * each opening a profile.
 */
export default async function ExplorePage({
  searchParams,
}: {
  readonly searchParams?: Promise<{
    readonly q?: string | string[];
    readonly tab?: string | string[];
  }>;
} = {}) {
  const params = (await searchParams) ?? {};
  const query =
    typeof params.q === "string" ? params.q.trim().slice(0, 80) : "";
  const session = await apiSession();
  const sectors =
    session === null
      ? []
      : await listTaxonomyNodes(session, "industry", {
          status: "ACTIVE",
          limit: 100,
        })
          .then((page) =>
            page.items.map((node) => ({
              nodeId: node.id,
              label: node.displayName,
            })),
          )
          .catch(() => []);

  if (query.length > 0) {
    const search = await loadExploreSearch({
      query,
      tab: searchTabOf(params.tab),
      sectors,
    }).catch(() => undefined);
    return (
      <PageContainer className="flex flex-col gap-4">
        <h1 className="cq-title-md lg:sr-only">Explore</h1>
        <ExploreScreen
          search={
            search ?? {
              query,
              tab: searchTabOf(params.tab),
              chips: [],
              companies: [],
              investors: [],
              people: [],
              pitches: [],
              related: [],
            }
          }
          searchState={
            search === undefined || search === null ? "error" : "ready"
          }
          sectors={sectors}
        />
      </PageContainer>
    );
  }

  const initial =
    session === null ? null : await exploreSlate(session, {}).catch(() => null);
  return (
    <PageContainer className="flex flex-col gap-4">
      <h1 className="cq-title-md lg:sr-only">Explore</h1>
      <ExploreScreen initial={initial} sectors={sectors} />
    </PageContainer>
  );
}
