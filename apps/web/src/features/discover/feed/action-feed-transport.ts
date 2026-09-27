import type { DiscoverFilters } from "@capital-q/contracts";

import type { FeedTransport } from "./feed-transport";
import { loadSlatePageAction, recordDecisionAction } from "./feed-actions";
import { authorisePlaybackAction } from "./playback-source";
import type { AuthorisePlayback } from "./playback-authorizations";
import type { PlaybackSource } from "../player/pitch-playback";

/**
 * The controller's port, resolved to server actions (CQ-WEB-022).
 *
 * The actions answer with a result object rather than throwing, because a
 * server action's rejection reaches the client as an opaque digest and the
 * reason is lost. The controller, though, is built on promises that reject
 * — that is how an optimistic Save knows to revert. So this is where the
 * two conventions meet: a refusal becomes an `Error` with the message the
 * server chose, and the reducer puts the flag back.
 */

/**
 * `filters` are bound for the transport's life: every page of one scroll
 * is asked under the same filters, and a change of filters is a new feed.
 */
export function actionFeedTransport(
  filters: DiscoverFilters | null = null,
): FeedTransport {
  return {
    loadSlate: async ({ cursor }) => {
      const result = await loadSlatePageAction(cursor ?? null, filters);
      if (!result.ok) throw new Error(result.message);
      return result.value;
    },

    decide: async ({ companyId, intent, slateId, clientEventId }) => {
      const result = await recordDecisionAction({
        companyId,
        intent,
        slateId,
        clientEventId,
      });
      if (!result.ok) throw new Error(result.message);
      return result.value;
    },
  };
}

/** Asking for one company's playback, resolved the same way. */
export const authorisePlaybackViaAction: AuthorisePlayback = async (
  companyId,
  mediaAssetId,
) => {
  const result = await authorisePlaybackAction(companyId, mediaAssetId);
  if (!result.ok) throw new Error(result.message);
  return result.value;
};

/** The player's port, resolved the same way. */
export function actionPlaybackSource(companyId: string): PlaybackSource {
  return (mediaAssetId: string) =>
    authorisePlaybackViaAction(companyId, mediaAssetId);
}
