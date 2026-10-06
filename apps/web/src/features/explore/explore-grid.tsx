"use client";

import type { ExploreTileDto } from "@capital-q/contracts";
import { ICON_SIZE, Play } from "@capital-q/ui/icons";

import {
  REASON_WORDS,
  durationLabel,
  tileHook,
  tileMeta,
} from "./explore-words";
import { FitGlyph } from "./fit-glyph";
import {
  columnWidth,
  containerHeight,
  placeMasonry,
  placementStyle,
  tileRatioAt,
} from "./masonry";

/**
 * Explore's masonry grid (E2): posters only, never autoplay. Each box is
 * reserved from the stored aspect ratio before its poster arrives, and the
 * DOM order is the rank order the tiles were placed in.
 */

export function ExploreTile({
  tile,
  poster,
  sectorLabels,
  onOpen,
  showWhy = true,
  style,
  index,
}: {
  readonly tile: ExploreTileDto;
  readonly poster: string | null;
  readonly sectorLabels: ReadonlyMap<string, string>;
  readonly onOpen: () => void;
  readonly showWhy?: boolean;
  readonly style?: React.CSSProperties | undefined;
  readonly index: number;
}) {
  const meta = tileMeta(tile, sectorLabels);
  const reason = REASON_WORDS[tile.reason];
  const duration = durationLabel(tile.pitch.durationSeconds);
  const hook = tileHook(tile);
  return (
    <li
      className="cq-explore-cell"
      style={style}
      data-explore-tile={tile.pitch.mediaAssetId}
      data-rank={index}
    >
      <button
        type="button"
        onClick={onOpen}
        className="cq-explore-tile group"
        aria-label={`${tile.canonicalName}: ${hook}. ${meta}${duration === null ? "" : `. ${duration}`}. ${reason.text}`}
      >
        <span
          className="cq-explore-poster"
          style={{
            aspectRatio: `1 / ${tileRatioAt(tile.pitch.aspectRatio, index).toFixed(4)}`,
          }}
        >
          {poster === null ? (
            <span className="absolute inset-0 grid place-items-center text-(--cq-stage-text-muted)">
              <Play size={ICON_SIZE.prominent} aria-hidden="true" />
            </span>
          ) : (
            // A signed poster straight from the video CDN (doc 20); never
            // through the app origin.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={poster}
              alt=""
              loading={index < 6 ? "eager" : "lazy"}
              decoding="async"
              className="cq-explore-img"
            />
          )}
          {duration === null ? null : (
            <span className="cq-explore-duration" aria-hidden="true">
              {duration}
            </span>
          )}
          <span className="cq-explore-overlay" aria-hidden="true">
            <b>{tile.canonicalName}</b>
            <span>{hook}</span>
          </span>
        </span>
        {showWhy ? (
          <span
            className="cq-explore-why"
            aria-hidden="true"
            data-reason={tile.reason}
          >
            <FitGlyph kind={reason.fit} className="mt-px size-[13px]" />
            <span className="min-w-0">
              <span className="block truncate">{meta}</span>
              <span className="block truncate">{reason.text}</span>
            </span>
          </span>
        ) : null}
      </button>
    </li>
  );
}

export function ExploreGrid({
  tiles,
  posters,
  columns,
  sectorLabels,
  onOpen,
  label = "Pitches",
}: {
  readonly tiles: readonly ExploreTileDto[];
  readonly posters: Readonly<Record<string, string>>;
  readonly columns: number;
  readonly sectorLabels: ReadonlyMap<string, string>;
  readonly onOpen: (index: number) => void;
  readonly label?: string;
}) {
  const layout = placeMasonry(
    tiles.map((tile, index) => tileRatioAt(tile.pitch.aspectRatio, index)),
    columns,
  );
  return (
    <div className="cq-explore-masonry-host">
      <ul
        className="cq-explore-masonry"
        aria-label={label}
        data-columns={columns}
        style={
          {
            "--cq-col": columnWidth(columns),
            height: containerHeight(layout),
          } as React.CSSProperties
        }
      >
        {layout.placements.map((placement) => {
          const tile = tiles[placement.index];
          if (tile === undefined) return null;
          return (
            <ExploreTile
              key={tile.pitch.mediaAssetId}
              tile={tile}
              index={placement.index}
              poster={posters[tile.pitch.mediaAssetId] ?? null}
              sectorLabels={sectorLabels}
              onOpen={() => onOpen(placement.index)}
              style={{
                ...placementStyle(placement, columns),
              }}
            />
          );
        })}
      </ul>
    </div>
  );
}

/** The loading grid: the same boxes, reserved, so nothing jumps on arrival. */
export function ExploreGridSkeleton({ columns }: { readonly columns: number }) {
  const ratios = Array.from({ length: 10 }, (_, index) =>
    tileRatioAt(null, index),
  );
  const layout = placeMasonry(ratios, columns);
  return (
    <div
      className="cq-explore-masonry-host"
      aria-busy="true"
      aria-label="Loading pitches"
    >
      <div
        className="cq-explore-masonry"
        style={
          {
            "--cq-col": columnWidth(columns),
            height: containerHeight(layout),
          } as React.CSSProperties
        }
      >
        {layout.placements.map((placement) => (
          <div
            key={placement.index}
            className="cq-explore-cell"
            style={placementStyle(placement, columns)}
          >
            <div
              className="cq-explore-skeleton"
              style={{ aspectRatio: `1 / ${placement.ratio.toFixed(4)}` }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
