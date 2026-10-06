import type { Metadata } from "next";

import { exploreSlate, listTaxonomyNodes } from "@capital-q/api-client";

import { loadExploreSearch } from "@/features/explore/explore-search";
import { searchTabOf } from "@/features/explore/explore-search-view";
import { ExploreScreen } from "@/features/explore/explore-screen";
import { authorisePostersAction } from "@/features/discover/feed/playback-source";
import { apiSession } from "@/features/q/context";
import { withTimeout } from "@/pwa/resilient";

export const metadata: Metadata = { title: "Explore" };
export const dynamic = "force-dynamic";

/** Two rows on a wide screen, three or four on a phone. */
const FIRST_SCREEN_POSTERS = 10;
const POSTER_BUDGET_MS = 1200;

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
  // P9: the sector words and the first page are independent reads, asked
  // side by side rather than one after the other.
  const sectorsRead =
    session === null
      ? Promise.resolve([])
      : listTaxonomyNodes(session, "industry", {
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
  const slateRead =
    query.length > 0 || session === null
      ? Promise.resolve(null)
      : exploreSlate(session, {}).catch(() => null);
  const sectors = await sectorsRead;

  if (query.length > 0) {
    const search = await loadExploreSearch({
      query,
      tab: searchTabOf(params.tab),
      sectors,
    }).catch(() => undefined);
    return (
      <div className="flex w-full flex-col gap-4 px-4 pt-4 pb-[calc(var(--cq-bottom-nav-height)+88px)] sm:px-6 lg:px-8 lg:pt-7 lg:pb-16">
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
      </div>
    );
  }

  const initial = await slateRead;
  // P9: the first screen's posters are authorised here, with the page, so
  // they start loading as the HTML arrives instead of after hydration and
  // a queue of per-tile actions. Bounded: a slow grant leaves the tile's
  // reserved box for the client to fill, it never holds the page.
  const initialPosters =
    initial === null || initial.items.length === 0
      ? {}
      : await withTimeout(
          authorisePostersAction(
            initial.items.slice(0, FIRST_SCREEN_POSTERS).map((tile) => ({
              companyId: tile.companyId,
              mediaAssetId: tile.pitch.mediaAssetId,
            })),
          ),
          POSTER_BUDGET_MS,
        ).catch(() => ({}));
  return (
    <div className="flex w-full flex-col gap-4 px-4 pt-4 pb-[calc(var(--cq-bottom-nav-height)+88px)] sm:px-6 lg:px-8 lg:pt-7 lg:pb-16">
      <h1 className="cq-title-md lg:sr-only">Explore</h1>
      <ExploreScreen
        initial={initial}
        initialPosters={initialPosters}
        sectors={sectors}
      />
    </div>
  );
}
