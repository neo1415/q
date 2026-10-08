import { useCallback, useEffect, useRef } from "react";

import type { PlaybackAuthorizationDto } from "@capital-q/contracts";

import { CONSTRAINED_PREFETCH_BUDGET } from "../feed/feed-state";
import { useFeedBudget } from "../feed/use-feed-budget";
import { warmPitch } from "./pitch-warmup";

/**
 * Warm a pitch the person is about to open (Explore's grid: a resting
 * pointer, a press, keyboard focus), so the player's first fragments come
 * from the device cache when the click lands (ADR 0064 §3-4).
 *
 * The same grant read the player makes, then the start rendition's init
 * segment and first fragments plus the audio; nothing plays and nothing is
 * recorded (viewing is not interest). Bounded: each pitch once, at most
 * MAX_PER_PAGE per page, never on Save-Data, a slow link or a stalling
 * one, and aborted when the page goes.
 */
const MAX_PER_PAGE = 8;

export function useIntentWarmup(
  authorize: (
    companyId: string,
    mediaAssetId: string,
  ) => Promise<PlaybackAuthorizationDto>,
): (companyId: string, mediaAssetId: string) => void {
  const budget = useFeedBudget();
  const warmed = useRef(new Set<string>());
  const controller = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      controller.current?.abort();
      controller.current = null;
    },
    [],
  );
  return useCallback(
    (companyId: string, mediaAssetId: string) => {
      if (typeof caches === "undefined") return;
      if (budget === CONSTRAINED_PREFETCH_BUDGET) return;
      if (warmed.current.has(mediaAssetId)) return;
      if (warmed.current.size >= MAX_PER_PAGE) return;
      warmed.current.add(mediaAssetId);
      controller.current ??= new AbortController();
      const { signal } = controller.current;
      void authorize(companyId, mediaAssetId)
        .then((grant) =>
          signal.aborted
            ? undefined
            : warmPitch(grant.playbackUrl, mediaAssetId, signal),
        )
        .catch(() => undefined);
    },
    [authorize, budget],
  );
}
