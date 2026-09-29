"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import type {
  DiscoveredCompanyDto,
  NetworkPitchItemDto,
} from "@capital-q/contracts";
import { Button, buttonClassName } from "@capital-q/ui/button";
import { DialogContent, DialogRoot } from "@capital-q/ui/dialog";
import { ChevronRight, ICON_SIZE, Play } from "@capital-q/ui/icons";
import { EmptyState, InlineNotice, Skeleton } from "@capital-q/ui/states";

import { formatDay } from "@/components/date-format";

import { countryLabel, stageLabel } from "../../company/declared-labels";
import { authorisePlaybackViaAction } from "../feed/action-feed-transport";
import { loadNetworkPitchesAction } from "../feed/feed-actions";
import { attachHlsOrNativeSource } from "../player/hls-source";
import { PitchPlayer } from "../player/pitch-player";
import { prefersReducedMotion } from "../player/use-pitch-playback";

/**
 * Founders' videos (ADR 0021): what other founders opened to everyone on
 * Capital Q, newest first, as a short-video grid. Nothing is ranked or
 * counted. One video plays at a time, in a watch view that can step to
 * the next; each company opens its own page.
 *
 * The list, the posters and playback are all the server's: a company is
 * listed only when disclosure lets this person see it, and each poster
 * and stream comes from a signed grant the server decides per video.
 */

const POSTER_BUDGET = 12;

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
function subscribeReducedMotion(onChange: () => void): () => void {
  if (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function"
  ) {
    return () => {};
  }
  const media = window.matchMedia(REDUCED_MOTION_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

/** The player's view of one item: a feed card with just this video. */
function asCompany(item: NetworkPitchItemDto): DiscoveredCompanyDto {
  return {
    companyId: item.companyId,
    canonicalName: item.canonicalName,
    websiteUrl: null,
    headquartersCountry: item.headquartersCountry,
    currentStageCode: item.currentStageCode,
    shortDescription: item.shortDescription,
    reasons: [],
    reasonCodes: [],
    pitch: item.pitch,
  };
}

export function NetworkVideos({
  text = "",
}: {
  /** Search: only videos whose company name or line matches (Search page). */
  readonly text?: string | undefined;
} = {}) {
  const [items, setItems] = useState<readonly NetworkPitchItemDto[] | null>(
    null,
  );
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [posters, setPosters] = useState<Readonly<Record<string, string>>>({});
  const [watching, setWatching] = useState<number | null>(null);
  const reducedMotion = useSyncExternalStore(
    subscribeReducedMotion,
    prefersReducedMotion,
    () => false,
  );

  useEffect(() => {
    let cancelled = false;
    void loadNetworkPitchesAction(null, text).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setItems(result.value.items);
      setCursor(result.value.nextCursor);
    });
    return () => {
      cancelled = true;
    };
  }, [text]);

  const more = useCallback(async () => {
    if (cursor === null) return;
    setLoadingMore(true);
    const result = await loadNetworkPitchesAction(cursor, text);
    setLoadingMore(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setItems((known) => [...(known ?? []), ...result.value.items]);
    setCursor(result.value.nextCursor);
  }, [cursor, text]);

  // Posters are minted grants: asked for once per video, a page at a time.
  const asked = useRef(new Set<string>());
  useEffect(() => {
    if (items === null) return;
    let cancelled = false;
    const next = items
      .filter((item) => !asked.current.has(item.pitch.mediaAssetId))
      .slice(0, POSTER_BUDGET);
    for (const item of next) {
      asked.current.add(item.pitch.mediaAssetId);
      authorisePlaybackViaAction(item.companyId, item.pitch.mediaAssetId).then(
        (grant) => {
          const url = grant.posterUrl;
          if (cancelled || url === null) return;
          setPosters((known) => ({ ...known, [item.pitch.mediaAssetId]: url }));
        },
        () => undefined,
      );
    }
    return () => {
      cancelled = true;
    };
  }, [items]);

  if (error !== null && items === null) {
    return (
      <InlineNotice tone="warning" title="Founders' videos couldn't load">
        {error}
      </InlineNotice>
    );
  }
  if (items === null) return <Skeleton lines={4} />;
  if (items.length === 0 && text.trim().length > 0) {
    return (
      <p className="cq-body-sm text-(--cq-text-secondary)" role="status">
        No founder videos match &ldquo;{text.trim()}&rdquo;.
      </p>
    );
  }
  if (items.length === 0) {
    return (
      <EmptyState
        title="No founder has shared a video with everyone yet."
        description="When founders open a video to everyone on Capital Q, it shows here. Yours can too: choose 'Everyone on Capital Q' on any of your videos."
        action={
          <Link href="/pitch" className={buttonClassName("secondary")}>
            Your videos
          </Link>
        }
      />
    );
  }

  const current = watching === null ? undefined : items[watching];
  return (
    <div className="flex flex-col gap-4" data-network-videos>
      <ul className="grid grid-cols-3 gap-0.5 overflow-hidden rounded-(--cq-radius-md) md:gap-1 lg:grid-cols-4">
        {items.map((item, at) => {
          const poster = posters[item.pitch.mediaAssetId] ?? null;
          return (
            <li key={item.pitch.mediaAssetId}>
              <button
                type="button"
                onClick={() => setWatching(at)}
                aria-label={`Watch ${item.pitch.title ?? "the pitch"} from ${item.canonicalName}`}
                className="group relative block aspect-9/16 w-full overflow-hidden bg-(--cq-stage-canvas) text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--cq-focus-ring)"
                data-network-tile={item.pitch.mediaAssetId}
              >
                {poster !== null ? (
                  // A signed poster straight from the video service (doc 20).
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={poster}
                    alt=""
                    className="absolute inset-0 size-full object-cover transition-transform duration-(--cq-motion-base) group-hover:scale-[1.03]"
                    loading="lazy"
                    decoding="async"
                  />
                ) : (
                  <span className="absolute inset-0 flex items-center justify-center text-(--cq-stage-text-muted)">
                    <Play size={ICON_SIZE.prominent} aria-hidden="true" />
                  </span>
                )}
                <span
                  aria-hidden="true"
                  className="absolute inset-x-0 bottom-0 flex flex-col gap-0.5 bg-[linear-gradient(to_top,var(--cq-stage-canvas)_0%,transparent_100%)] px-2 pt-8 pb-2"
                >
                  <span className="cq-body-sm truncate font-medium text-(--cq-stage-text)">
                    {item.canonicalName}
                  </span>
                  <span className="cq-caption truncate text-(--cq-stage-text-muted)">
                    {item.pitch.title ?? "Pitch"}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {error === null ? null : (
        <InlineNotice tone="warning">{error}</InlineNotice>
      )}
      {cursor === null ? null : (
        <div className="flex justify-center">
          <Button
            variant="secondary"
            disabled={loadingMore}
            onClick={() => void more()}
          >
            {loadingMore ? "Loading…" : "More videos"}
          </Button>
        </div>
      )}

      <DialogRoot
        open={current !== undefined}
        onOpenChange={(open) => {
          if (!open) setWatching(null);
        }}
      >
        {current === undefined || watching === null ? null : (
          <DialogContent
            key={current.pitch.mediaAssetId}
            title={current.canonicalName}
            description={[
              current.pitch.title,
              stageLabel(current.currentStageCode),
              countryLabel(current.headquartersCountry),
              `Posted ${formatDay(current.postedAt)}`,
            ]
              .filter((part): part is string => part != null && part !== "")
              .join(" · ")}
            className="max-w-sm"
            actions={
              <>
                <Link
                  href={`/company/${current.companyId}`}
                  className={buttonClassName("quiet")}
                >
                  Open company
                </Link>
                <Button
                  variant="secondary"
                  disabled={watching + 1 >= items.length}
                  onClick={() => setWatching(watching + 1)}
                >
                  Next video
                  <ChevronRight size={ICON_SIZE.regular} aria-hidden="true" />
                </Button>
              </>
            }
          >
            <div className="overflow-hidden rounded-(--cq-radius-lg) bg-(--cq-stage-canvas)">
              <PitchPlayer
                company={asCompany(current)}
                policy="ACTIVE"
                authorize={(mediaAssetId) =>
                  authorisePlaybackViaAction(current.companyId, mediaAssetId)
                }
                reducedMotion={reducedMotion}
                attachSource={attachHlsOrNativeSource}
              />
            </div>
          </DialogContent>
        )}
      </DialogRoot>
    </div>
  );
}
