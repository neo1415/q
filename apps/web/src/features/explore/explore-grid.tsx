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

export function ExploreTile({
  tile,
  poster,
  sectorLabels,
  onOpen,
  onIntent,
  showWhy = true,
  style,
  index,
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
        {...(onIntent === undefined ? {} : intentHandlers(onIntent))}
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
              // The first row is the likely LCP: ask for it ahead of the
              // rest of the page's images (P9).
              fetchPriority={index < 2 ? "high" : "auto"}
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

/** Every column count the grid can take, widest breakpoint last. */
const COLUMN_COUNTS = [2, 3, 4, 5] as const;

/**
 * Before the browser has said how wide it is (the server render, and the
 * first paint before hydration) the grid is laid out for every column
 * count at once, as custom properties, and CSS picks the one matching the
 * viewport (the same breakpoints as `columnsForWidth`). The tiles are
 * therefore on screen from the first byte, and hydration swaps those
 * properties for the identical inline values: no skeleton, no shift (P9).
 */
function responsiveStyles(ratios: readonly number[]): {
  readonly host: React.CSSProperties;
  readonly cells: readonly React.CSSProperties[];
} {
  const host: Record<string, string> = {};
  const cells: Record<string, string>[] = ratios.map(() => ({}));
  for (const count of COLUMN_COUNTS) {
    const layout = placeMasonry(ratios, count);
    host[`--cq-col-${String(count)}`] = columnWidth(count);
    host[`--cq-h-${String(count)}`] = containerHeight(layout);
    for (const placement of layout.placements) {
      const style = placementStyle(placement, count);
      const cell = cells[placement.index];
      if (cell === undefined) continue;
      cell[`--l${String(count)}`] = style.left;
      cell[`--t${String(count)}`] = style.top;
      cell[`--h${String(count)}`] = style.height;
    }
  }
  return { host, cells };
}

export function ExploreGrid({
  tiles,
  posters,
  columns,
  sectorLabels,
  onOpen,
  onIntent,
  label = "Pitches",
}: {
  readonly tiles: readonly ExploreTileDto[];
  readonly posters: Readonly<Record<string, string>>;
  /** Null until the browser has measured: every breakpoint, chosen by CSS. */
  readonly columns: number | null;
  readonly sectorLabels: ReadonlyMap<string, string>;
  readonly onOpen: (index: number) => void;
  readonly onIntent?: ((index: number) => void) | undefined;
  readonly label?: string;
}) {
  const ratios = tiles.map((tile, index) =>
    tileRatioAt(tile.pitch.aspectRatio, index),
  );
  if (columns === null) {
    const responsive = responsiveStyles(ratios);
    return (
      <div className="cq-explore-masonry-host">
        <ul
          className="cq-explore-masonry"
          aria-label={label}
          data-columns="auto"
          style={responsive.host}
        >
          {tiles.map((tile, index) => (
            <ExploreTile
              key={tile.pitch.mediaAssetId}
              tile={tile}
              index={index}
              poster={posters[tile.pitch.mediaAssetId] ?? null}
              sectorLabels={sectorLabels}
              onOpen={() => onOpen(index)}
              onIntent={onIntent && (() => onIntent(index))}
              style={responsive.cells[index]}
            />
          ))}
        </ul>
      </div>
    );
  }
  const layout = placeMasonry(ratios, columns);
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
              onIntent={onIntent && (() => onIntent(placement.index))}
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
