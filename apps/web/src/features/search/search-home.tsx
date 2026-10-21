"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { Play, Search } from "@capital-q/ui/icons";

import { authorisePostersAction } from "@/features/discover/feed/playback-source";
import { useT } from "@/features/i18n/language";

import {
  RECENT_CHANGED,
  openSearch,
  parseRecent,
  readRecentRaw,
  type RecentItem,
  type RecentPerson,
  type RecentVideo,
} from "./recent-opened";
import { NameRow, durationWords } from "./search-palette";

/**
 * The Search page under the palette (app prototype "search", option 2):
 * one bar that opens the palette, then what this person opened recently,
 * people on one side and videos on the other. The lists live in their own
 * browser (recent-opened.ts); each link re-checks access when followed,
 * and each poster is asked for again under their session.
 */

const NONE: readonly RecentItem[] = [];

export function SearchHome({
  viewer,
  initialQuery = "",
}: {
  readonly viewer: string;
  /** An address with `?q=` opens the palette with it. */
  readonly initialQuery?: string | undefined;
}) {
  const t = useT();
  const recent = useRecent(viewer);
  const people = recent.filter(
    (item): item is RecentPerson => item.kind === "person",
  );
  const videos = recent.filter(
    (item): item is RecentVideo => item.kind === "video",
  );

  useEffect(() => {
    if (initialQuery.length > 0) openSearch(initialQuery);
  }, [initialQuery]);

  return (
    <div className="flex flex-col" data-search-home>
      <button
        type="button"
        onClick={() => openSearch("")}
        className="flex min-h-12 w-full max-w-[520px] items-center gap-2.5 rounded-(--cq-radius-lg) border border-(--cq-border) bg-(--cq-surface-raised) px-3.5 text-start text-(--cq-text-tertiary) transition-colors duration-(--cq-motion-fast) hover:border-(--cq-text-tertiary) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--cq-focus-ring)"
        data-search-open
      >
        <Search size={18} aria-hidden="true" />
        <span className="flex-1">{t("Search people and videos")}</span>
        <span
          aria-hidden="true"
          className="rounded-[6px] border border-(--cq-border) px-1.5 text-xs text-(--cq-text-tertiary) max-lg:hidden"
        >
          /
        </span>
      </button>
      <div className="mt-7 grid items-start gap-7 max-lg:gap-3.5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className="min-w-0">
          <h2 className="mb-3 text-[15px] font-semibold text-(--cq-text-primary)">
            {t("Recently opened")}
          </h2>
          {people.length === 0 ? (
            <p className="text-sm text-(--cq-text-secondary)">
              {t(
                "People and cards you open from search appear here, on this device only.",
              )}
            </p>
          ) : (
            <div className="cq-crm-stagger flex flex-col">
              {people.map((person) => (
                <NameRow key={person.href} person={person} />
              ))}
            </div>
          )}
        </section>
        <section className="min-w-0">
          <h2 className="mb-3 text-[15px] font-semibold text-(--cq-text-primary)">
            {t("Videos you opened")}
          </h2>
          {videos.length === 0 ? (
            <p className="text-sm text-(--cq-text-secondary)">
              {t("Pitch videos you open from search appear here.")}
            </p>
          ) : (
            <VideoTiles videos={videos} />
          )}
        </section>
      </div>
    </div>
  );
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(RECENT_CHANGED, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(RECENT_CHANGED, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function useRecent(viewer: string): readonly RecentItem[] {
  // The stored text is the snapshot (a string is stable between changes);
  // the server renders the empty list and the browser fills it in.
  const raw = useSyncExternalStore(
    subscribe,
    () => readRecentRaw(viewer),
    () => null,
  );
  return useMemo(() => (raw === null ? NONE : parseRecent(raw)), [raw]);
}

function VideoTiles({ videos }: { readonly videos: readonly RecentVideo[] }) {
  const t = useT();
  const [posters, setPosters] = useState<Readonly<Record<string, string>>>({});
  const key = videos.map((video) => video.mediaAssetId).join(",");
  useEffect(() => {
    let cancelled = false;
    void authorisePostersAction(
      videos.map((video) => ({
        companyId: video.companyId,
        mediaAssetId: video.mediaAssetId,
      })),
    )
      .catch(() => ({}))
      .then((found) => {
        if (!cancelled) setPosters(found);
      });
    return () => {
      cancelled = true;
    };
    // The list is keyed by its media ids; a re-render with the same ones
    // asks nothing again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return (
    <ul className="cq-crm-stagger grid grid-cols-2 gap-3.5 max-lg:gap-2.5">
      {videos.map((video) => {
        const poster = posters[video.mediaAssetId] ?? null;
        const length = durationWords(video.durationSeconds);
        return (
          <li key={video.mediaAssetId}>
            <Link
              href={`/company/${encodeURIComponent(video.companyId)}`}
              aria-label={`${video.company}: ${video.title ?? t("Pitch")}`}
              className="cq-cinema relative flex aspect-[9/13] flex-col justify-end overflow-hidden rounded-(--cq-radius-lg) bg-(--cq-stage-canvas) p-3 text-start text-(--cq-stage-text) transition-[transform,box-shadow] duration-[180ms] ease-(--cq-ease) motion-reduce:transition-none [@media(hover:hover)_and_(pointer:fine)]:hover:-translate-y-0.5 [@media(hover:hover)_and_(pointer:fine)]:hover:shadow-(--cq-shadow-sm)"
              data-search-tile={video.mediaAssetId}
            >
              {poster === null ? (
                <span className="absolute inset-0 grid place-items-center text-(--cq-stage-text-muted)">
                  <Play size={28} aria-hidden="true" />
                </span>
              ) : (
                // A signed poster straight from the video service (doc 20).
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={poster}
                  alt=""
                  className="absolute inset-0 size-full object-cover"
                  loading="lazy"
                  decoding="async"
                />
              )}
              <span
                aria-hidden="true"
                className="absolute inset-0 bg-[linear-gradient(180deg,transparent_40%,var(--cq-stage-canvas))]"
              />
              <span className="absolute end-2.5 top-2.5 rounded-full bg-(--cq-stage-canvas)/60 px-[7px] py-0.5 text-[11px]">
                {length ?? t("Length not known")}
              </span>
              <span className="relative text-sm leading-[1.3] font-semibold">
                {video.title ?? t("Pitch")}
              </span>
              <span className="relative mt-0.5 text-xs text-(--cq-stage-text-muted)">
                {video.company}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
