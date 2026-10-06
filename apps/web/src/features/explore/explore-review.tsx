"use client";

import { useMemo } from "react";

import type { ExploreSearchTab } from "@capital-q/contracts";

import {
  FIXTURE_POSTERS,
  FIXTURE_SECTORS,
  fixturePage,
  fixtureRelated,
  fixtureSearch,
} from "./explore-fixtures";
import { ExploreScreen, type ExploreDataSource } from "./explore-screen";

/**
 * Explore with fictional fixtures, for design review and screenshots
 * (dev route only). Nothing is fetched, played or saved: posters are drawn
 * locally and the player waits for an explicit Play.
 */
export function ExploreReview({
  view,
  state,
  tab,
}: {
  readonly view: "grid" | "feed" | "related" | "search";
  readonly state: "full" | "loading" | "empty" | "error" | "limited";
  readonly tab: ExploreSearchTab;
}) {
  const source = useMemo<ExploreDataSource>(
    () => ({
      loadPage: () =>
        state === "error"
          ? Promise.resolve({
              ok: false,
              message: "The connection dropped before it finished.",
            })
          : state === "loading"
            ? new Promise(() => undefined)
            : Promise.resolve({ ok: true, value: fixturePage(state) }),
      loadRelated: (mediaAssetId) => {
        const related = fixtureRelated(mediaAssetId);
        return Promise.resolve(
          related === null
            ? { ok: false, message: "That pitch isn't available." }
            : { ok: true, value: related },
        );
      },
      authorize: (_companyId, mediaAssetId) =>
        Promise.resolve({
          mediaAssetId,
          playbackUrl: "https://video.example.invalid/fixture.m3u8",
          posterUrl: FIXTURE_POSTERS[mediaAssetId] ?? null,
          expiresAt: "2099-01-01T00:00:00.000Z",
        }),
      save: () => Promise.resolve({ ok: true }),
    }),
    [state],
  );
  const search =
    view === "search" && state !== "loading" && state !== "error"
      ? fixtureSearch(state, tab)
      : view === "search"
        ? { ...fixtureSearch("full", tab) }
        : null;
  return (
    <ExploreScreen
      source={source}
      sectors={FIXTURE_SECTORS}
      search={search}
      searchState={
        view !== "search"
          ? "ready"
          : state === "loading"
            ? "loading"
            : state === "error"
              ? "error"
              : "ready"
      }
      forceLoading={view !== "search" && state === "loading"}
      limitedOrganisation={state === "limited" ? "Northbound Capital" : null}
      startOnRequest
      openOnArrival={
        view === "feed"
          ? { index: 0, at: 0 }
          : view === "related"
            ? { index: 0, at: 1 }
            : null
      }
    />
  );
}
