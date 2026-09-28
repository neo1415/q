"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import type { MediaAssetDto } from "@capital-q/contracts";
import { buttonClassName } from "@capital-q/ui/button";
import { ICON_SIZE, Play, Plus } from "@capital-q/ui/icons";
import { InlineNotice, Skeleton } from "@capital-q/ui/states";

import { formatDay } from "@/components/date-format";

import {
  authorisePitchPlaybackAction,
  listPitchMediaAction,
} from "./pitch-actions";
import { phaseOf } from "./pitch-library-state";

/**
 * Pitch & media (ADR 0022): every live video the company has, newest
 * first, as a grid of posters, each opening its own page to edit, replace,
 * preview or delete it. A video stays online until its owner deletes it.
 *
 * Nothing is decided here: the list is the server's `GET /media` under the
 * founder's own session (replaced and deleted videos are left out, they
 * are no longer live), and each poster comes from the owner's own signed
 * playback grant, never a guessed URL.
 */

/** Posters are minted grants: ask for the ones on the first screen. */
const POSTER_BUDGET = 12;

export function PitchGrid({ companyId }: { readonly companyId: string }) {
  const [videos, setVideos] = useState<readonly MediaAssetDto[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [posters, setPosters] = useState<Readonly<Record<string, string>>>({});

  useEffect(() => {
    let cancelled = false;
    void listPitchMediaAction(companyId).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setLoadError(result.message);
        return;
      }
      setVideos(
        result.value
          .filter((video) => video.live && video.purpose === "FOUNDER_PITCH")
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  const wanted = (videos ?? [])
    .filter((video) => video.status === "READY")
    .slice(0, POSTER_BUDGET)
    .map((video) => video.mediaAssetId)
    .join(",");
  useEffect(() => {
    if (wanted === "") return;
    let cancelled = false;
    for (const mediaAssetId of wanted.split(",")) {
      void authorisePitchPlaybackAction(companyId, mediaAssetId).then(
        (result) => {
          const url = result.ok ? result.value.posterUrl : null;
          if (cancelled || url === null) return;
          setPosters((known) => ({ ...known, [mediaAssetId]: url }));
        },
      );
    }
    return () => {
      cancelled = true;
    };
  }, [companyId, wanted]);

  if (loadError !== null) {
    return (
      <InlineNotice tone="warning" title="Your videos couldn't load">
        {loadError}
      </InlineNotice>
    );
  }
  if (videos === null) return <Skeleton lines={4} />;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="cq-body-sm text-(--cq-text-secondary)">
          {videos.length === 0
            ? "No videos yet. Your first one is what investors watch before they read anything else."
            : `${String(videos.length)} ${videos.length === 1 ? "video" : "videos"}, each online until you delete it.`}
        </p>
        <Link
          href="/pitch/new"
          className={buttonClassName("primary")}
          data-pitch-new
        >
          <Plus size={ICON_SIZE.regular} aria-hidden="true" />
          New video
        </Link>
      </div>
      {videos.length === 0 ? null : (
        <ul
          // A short-video profile grid: three across on every screen,
          // hairline gaps, posters edge to edge.
          className="grid grid-cols-3 gap-0.5 overflow-hidden rounded-(--cq-radius-md) md:gap-1 lg:grid-cols-4"
          data-pitch-grid
        >
          {videos.map((video) => (
            <li key={video.mediaAssetId}>
              <VideoTile
                video={video}
                poster={posters[video.mediaAssetId] ?? null}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function VideoTile({
  video,
  poster,
}: {
  readonly video: MediaAssetDto;
  readonly poster: string | null;
}) {
  const state = tileState(video);
  return (
    <Link
      href={`/pitch/${video.mediaAssetId}`}
      aria-label={`${video.title ?? "Pitch"}: ${state}, ${
        video.audience === "NETWORK"
          ? "everyone on Capital Q"
          : "investors only"
      }, ${formatDay(video.createdAt)}`}
      className="group relative block aspect-9/16 w-full overflow-hidden bg-(--cq-stage-canvas) focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--cq-focus-ring)"
      data-pitch-tile={video.mediaAssetId}
    >
      {poster !== null ? (
        // A signed poster straight from the video service: no media
        // through the app's image optimiser (doc 20).
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={poster}
          alt=""
          className="absolute inset-0 size-full object-cover transition-transform duration-(--cq-motion-base) group-hover:scale-[1.03]"
          loading="lazy"
          decoding="async"
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-(--cq-stage-text-muted)">
          <Play size={ICON_SIZE.prominent} aria-hidden="true" />
        </div>
      )}
      {/* The state, always in words; the stage is dark in both themes. */}
      <span
        className="cq-caption absolute top-1.5 left-1.5 rounded-(--cq-radius-sm) bg-(--cq-stage-canvas)/80 px-1.5 py-0.5 text-(--cq-stage-text)"
        aria-hidden="true"
      >
        {state}
      </span>
      <span
        className="absolute inset-x-0 bottom-0 flex flex-col gap-0.5 bg-[linear-gradient(to_top,var(--cq-stage-canvas)_0%,transparent_100%)] px-2 pt-8 pb-2 text-left"
        aria-hidden="true"
      >
        <span className="cq-body-sm truncate font-medium text-(--cq-stage-text)">
          {video.title ?? "Pitch"}
        </span>
        <span className="cq-caption truncate text-(--cq-stage-text-muted)">
          {video.audience === "NETWORK" ? "Everyone" : "Investors only"} ·{" "}
          {formatDay(video.createdAt)}
        </span>
      </span>
    </Link>
  );
}

/** Where a video stands, in words (never colour alone). */
function tileState(video: MediaAssetDto): string {
  switch (phaseOf(video)) {
    case "WAITING":
      return "Waiting for the file";
    case "UPLOADING":
      return "Uploading";
    case "PROCESSING":
      return "Processing";
    case "FAILED":
      return "Needs a new file";
    case "WITHDRAWN":
      return "Deleted";
    case "READY":
      if (video.playbackPolicy === "PRIVATE") return "Private";
      return video.moderationStatus === "ALLOWED" ? "Live" : "In review";
  }
}
