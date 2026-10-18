import {
  DISCOVERY_EXPLORE_PATH,
  DISCOVERY_EXPLORE_RELATED_PATH,
  DISCOVERY_EXPLORE_SEARCH_PATH,
  ExplorePageDtoSchema,
  ExploreRelatedDtoSchema,
  ExploreSearchDtoSchema,
  type ExploreMode,
} from "@capital-q/contracts";

import { call, type ApiSession } from "./request.js";

/** Explore (E1-E5, ADR 0055): one cursor page of the slate. */
export function exploreSlate(
  session: ApiSession,
  page: {
    readonly mode?: ExploreMode | undefined;
    readonly cursor?: string | null | undefined;
    readonly limit?: number | undefined;
  } = {},
) {
  const params = new URLSearchParams();
  if (page.mode !== undefined) params.set("mode", page.mode);
  if (page.cursor != null && page.cursor.length > 0) {
    params.set("cursor", page.cursor);
  }
  if (page.limit !== undefined) params.set("limit", String(page.limit));
  const query = params.toString();
  return call(
    session,
    "GET",
    `${DISCOVERY_EXPLORE_PATH}${query.length === 0 ? "" : `?${query}`}`,
    ExplorePageDtoSchema,
  );
}

/** The opened pitch, then pitches like it ("Related to X"). */
export function exploreRelated(session: ApiSession, mediaAssetId: string) {
  return call(
    session,
    "GET",
    DISCOVERY_EXPLORE_RELATED_PATH.replace(
      ":mediaAssetId",
      encodeURIComponent(mediaAssetId),
    ),
    ExploreRelatedDtoSchema,
  );
}

/** Companies and pitches matching a text and sectors, among what the viewer may see. */
export function exploreSearch(
  session: ApiSession,
  query: { readonly text: string; readonly sectorNodeIds?: readonly string[] },
) {
  const params = new URLSearchParams({ q: query.text.trim().slice(0, 80) });
  if (query.sectorNodeIds !== undefined && query.sectorNodeIds.length > 0) {
    params.set("sector", query.sectorNodeIds.slice(0, 8).join(","));
  }
  return call(
    session,
    "GET",
    `${DISCOVERY_EXPLORE_SEARCH_PATH}?${params.toString()}`,
    ExploreSearchDtoSchema,
  );
}
