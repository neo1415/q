"use client";

import { useRef, useState } from "react";

import type { ExploreTileDto } from "@capital-q/contracts";
import { Play } from "@capital-q/ui/icons";

import { companyPhotoPath } from "@/features/entity/entity-avatar";

import {
  REASON_WORDS,
  durationLabel,
  tileHook,
  tileMeta,
} from "./explore-words";
import {
  GridPreviewVideo,
  useGridPreview,
  type AuthorizePreview,
} from "./grid-preview-player";
import { mosaicCellStyle, mosaicLayouts } from "./mosaic";

/**
 * Explore's grid (E2; owner 2026-10-16, "the Instagram Explore feel"): one
 * dense mosaic of full-bleed posters with a 2px gutter, no cards, no
 * captions, no stage labels. Posters, and at most one muted preview at a
 * time, chosen by the grid's controller (grid-preview.ts). Each box is reserved from the tile's
 * rank before its poster arrives, and the DOM order is the rank order.
 * Why a tile is shown is still said on every tile: in its accessible
 * name, and on hover or keyboard focus.
 */

/** A pointer resting this long on a tile is intent, not a pass across it. */
const HOVER_INTENT_MS = 120;

function intentHandlers(onIntent: () => void) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  return {
    onPointerEnter: (event: React.PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      cancel();
      timer = setTimeout(onIntent, HOVER_INTENT_MS);
    },
    onPointerLeave: cancel,
    onPointerDown: () => {
      cancel();
      onIntent();
    },
    onFocus: onIntent,
  };
}

/**
 * The picture under a tile with no poster yet (or none at all): the
 * company's own photo where this viewer may see it (the photo route
 * answers 404 otherwise), drawn over its initial on the stage canvas, so
 * a tile is never an empty box.
 */
function TileFallback({
  companyId,
  name,
}: {
  readonly companyId: string;
  readonly name: string;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <>
      <span className="cq-explore-initial" aria-hidden="true">
        {name.trim().slice(0, 1).toUpperCase()}
      </span>
      {failed ? null : (
        // The browser's own lazy request to the photo route (never proxied
        // bytes); a refusal leaves the initial showing.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={companyPhotoPath(companyId)}
          alt=""
          loading="lazy"
          decoding="async"
          className="cq-explore-img"
          onError={() => setFailed(true)}
        />
      )}
    </>
  );
}

export function ExploreTile({
  tile,
  poster,
  sectorLabels,
  onOpen,
  onIntent,
  style,
  index,
  preview = null,
}: {
  readonly tile: ExploreTileDto;
  readonly poster: string | null;
  readonly sectorLabels: ReadonlyMap<string, string>;
  readonly onOpen: () => void;
  /**
   * The person is about to open this pitch (a resting pointer, a press, or
   * keyboard focus): its first seconds are fetched before the click.
   */
  readonly onIntent?: (() => void) | undefined;
  readonly style?: React.CSSProperties | undefined;
  readonly index: number;
  /**
   * The grid's preview controller: `playing` when this is the one tile it
   * chose, `onHover` to tell it a mouse is over this tile.
   */
  readonly preview?: {
    readonly playing: boolean;
    readonly authorize: AuthorizePreview;
    readonly onHover: () => void;
    readonly onLeave: () => void;
  } | null;
}) {
  const meta = tileMeta(tile, sectorLabels);
  const reason = REASON_WORDS[tile.reason];
  const duration = durationLabel(tile.pitch.durationSeconds);
  const hook = tileHook(tile);
  const label = [
    `${tile.canonicalName}: ${hook}`,
    meta,
    duration === null ? "Pitch video" : `Pitch video, ${duration}`,
    reason.text,
  ]
    .filter((part) => part.length > 0)
    .join(". ");
  return (
    <li
      className="cq-explore-cell"
      style={style}
      data-explore-tile={tile.pitch.mediaAssetId}
      data-rank={index}
      {...(preview === null
        ? {}
        : {
            onPointerEnter: (event: React.PointerEvent) => {
              if (event.pointerType === "mouse") preview.onHover();
            },
            onPointerLeave: preview.onLeave,
          })}
    >
      <button
        type="button"
        onClick={onOpen}
        {...(onIntent === undefined ? {} : intentHandlers(onIntent))}
        className="cq-explore-tile"
        aria-label={label}
      >
        {poster === null ? (
          <TileFallback companyId={tile.companyId} name={tile.canonicalName} />
        ) : (
          // A signed poster straight from the video CDN (doc 20); never
          // through the app origin.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={poster}
            alt=""
            loading={index < 9 ? "eager" : "lazy"}
            // The first row is the likely LCP: ask for it ahead of the
            // rest of the page's images (P9).
            fetchPriority={index < 3 ? "high" : "auto"}
            decoding="async"
            className="cq-explore-img"
          />
        )}
        {preview?.playing === true ? (
          <GridPreviewVideo
            companyId={tile.companyId}
            mediaAssetId={tile.pitch.mediaAssetId}
            authorize={preview.authorize}
          />
        ) : null}
        <Play className="cq-explore-play" aria-hidden="true" />
        <span className="cq-explore-name" aria-hidden="true">
          {tile.canonicalName}
          <span className="cq-explore-why" data-reason={tile.reason}>
            {reason.text}
          </span>
        </span>
      </button>
    </li>
  );
}

export function ExploreGrid({
  tiles,
  posters,
  sectorLabels,
  onOpen,
  onIntent,
  label = "Pitches",
  preview = null,
}: {
  readonly tiles: readonly ExploreTileDto[];
  readonly posters: Readonly<Record<string, string>>;
  readonly sectorLabels: ReadonlyMap<string, string>;
  readonly onOpen: (index: number) => void;
  readonly onIntent?: ((index: number) => void) | undefined;
  readonly label?: string;
  /**
   * Muted in-grid previews (owner 2026-10-16): one tile at a time, chosen
   * by the controller. Null keeps the grid posters only.
   */
  readonly preview?: {
    readonly authorize: AuthorizePreview;
    /** A pitch is open over the grid: nothing previews. */
    readonly suspended: boolean;
  } | null;
}) {
  const layouts = mosaicLayouts(tiles.length);
  const host = useRef<HTMLUListElement | null>(null);
  const order = tiles.map((tile) => tile.pitch.mediaAssetId);
  const controller = useGridPreview(
    host,
    preview === null ? [] : order,
    preview?.suspended ?? true,
  );
  return (
    <div className="cq-explore-mosaic-host">
      <ul ref={host} className="cq-explore-mosaic" aria-label={label}>
        {tiles.map((tile, index) => (
          <ExploreTile
            key={tile.pitch.mediaAssetId}
            tile={tile}
            index={index}
            poster={posters[tile.pitch.mediaAssetId] ?? null}
            sectorLabels={sectorLabels}
            onOpen={() => onOpen(index)}
            onIntent={onIntent && (() => onIntent(index))}
            style={mosaicCellStyle(layouts, index)}
            preview={
              preview === null
                ? null
                : {
                    playing: controller.active === tile.pitch.mediaAssetId,
                    authorize: preview.authorize,
                    onHover: () => controller.hover(tile.pitch.mediaAssetId),
                    onLeave: () => controller.leave(tile.pitch.mediaAssetId),
                  }
            }
          />
        ))}
      </ul>
    </div>
  );
}

const SKELETON_TILES = 15;

/** The loading grid: the same boxes, reserved, so nothing jumps on arrival. */
export function ExploreGridSkeleton() {
  const layouts = mosaicLayouts(SKELETON_TILES);
  return (
    <div
      className="cq-explore-mosaic-host"
      aria-busy="true"
      aria-label="Loading pitches"
    >
      <div className="cq-explore-mosaic">
        {Array.from({ length: SKELETON_TILES }, (_, index) => (
          <div
            key={index}
            className="cq-explore-cell cq-explore-skeleton"
            style={mosaicCellStyle(layouts, index)}
          />
        ))}
      </div>
    </div>
  );
}
