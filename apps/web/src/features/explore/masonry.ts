/**
 * Explore's masonry (E2, ADR 0055): pure layout math, no DOM.
 *
 * Every tile's box is known from the pitch's stored aspect ratio before a
 * single poster loads, so nothing shifts (CLS). Tiles are placed in rank
 * order into the shortest column, and the DOM keeps that same order, so
 * keyboard and screen-reader order follow the rank and stay close to what
 * the eye reads (WCAG 2.4.3). Positions are expressed against the column
 * width as CSS, so the browser lays them out with no measuring script.
 */

/** Height ÷ width, clamped: no tile is a sliver (4:5) or a tower (9:16). */
export const TILE_RATIO_MIN = 5 / 4;
export const TILE_RATIO_MAX = 16 / 9;
const DEFAULT_RATIO = TILE_RATIO_MAX;

/** The two-line "why" under each poster, in px; fixed so heights are known. */
export const TILE_CAPTION_PX = 44;
/** Gap between tiles: 6px on phone, 10px from 1024px. */
export const gapFor = (columns: number): number => (columns >= 4 ? 10 : 6);
/** Width used only to compare columns; positions use the real width. */
const NOMINAL_COLUMN_PX = 180;

const RATIO = /^\s*(\d{1,4}(?:\.\d+)?)\s*(?::|\/|x)\s*(\d{1,4}(?:\.\d+)?)\s*$/;

/** A stored "9:16" (width:height) as a clamped height ÷ width. */
export function tileRatio(aspectRatio: string | null | undefined): number {
  const match = aspectRatio == null ? null : RATIO.exec(aspectRatio);
  const width = match === null ? 0 : Number(match[1]);
  const height = match === null ? 0 : Number(match[2]);
  const ratio = width > 0 && height > 0 ? height / width : DEFAULT_RATIO;
  return Math.min(TILE_RATIO_MAX, Math.max(TILE_RATIO_MIN, ratio));
}

/** 2 columns on phone, 3 on tablet, 4 on a laptop, 5 on a wide screen. */
export function columnsForWidth(viewportPx: number): 2 | 3 | 4 | 5 {
  if (viewportPx < 640) return 2;
  if (viewportPx < 1024) return 3;
  if (viewportPx < 1400) return 4;
  return 5;
}

export type MasonryPlacement = {
  /** The item's rank, which is also its DOM position. */
  readonly index: number;
  readonly column: number;
  /** Sum of the height ratios of the tiles above it in its column. */
  readonly ratiosAbove: number;
  /** How many tiles sit above it in its column. */
  readonly tilesAbove: number;
  readonly ratio: number;
};

export type MasonryLayout = {
  readonly columns: number;
  readonly placements: readonly MasonryPlacement[];
  /** The tallest column, for the container's reserved height. */
  readonly height: { readonly ratios: number; readonly tiles: number };
};

/** Shortest-column placement in rank order; ties go to the leftmost column. */
export function placeMasonry(
  ratios: readonly number[],
  columns: number,
): MasonryLayout {
  const cols = Math.max(1, Math.trunc(columns));
  const step = (TILE_CAPTION_PX + gapFor(cols)) / NOMINAL_COLUMN_PX;
  const sums = Array.from({ length: cols }, () => 0);
  const counts = Array.from({ length: cols }, () => 0);
  const placements: MasonryPlacement[] = [];
  ratios.forEach((ratio, index) => {
    let column = 0;
    for (let k = 1; k < cols; k++) {
      const here = (sums[k] ?? 0) + (counts[k] ?? 0) * step;
      const best = (sums[column] ?? 0) + (counts[column] ?? 0) * step;
      if (here < best - 1e-9) column = k;
    }
    placements.push({
      index,
      column,
      ratiosAbove: sums[column] ?? 0,
      tilesAbove: counts[column] ?? 0,
      ratio,
    });
    sums[column] = (sums[column] ?? 0) + ratio;
    counts[column] = (counts[column] ?? 0) + 1;
  });
  let tallest = 0;
  for (let k = 1; k < cols; k++) {
    const here = (sums[k] ?? 0) + (counts[k] ?? 0) * step;
    const best = (sums[tallest] ?? 0) + (counts[tallest] ?? 0) * step;
    if (here > best) tallest = k;
  }
  return {
    columns: cols,
    placements,
    height: { ratios: sums[tallest] ?? 0, tiles: counts[tallest] ?? 0 },
  };
}

/**
 * The CSS for one placement. `--cq-col` is the column width, defined on
 * the grid from its container width (`100cqw`), so these are exact at any
 * width with no script measuring anything.
 */
export function placementStyle(
  placement: MasonryPlacement,
  columns: number,
): {
  readonly left: string;
  readonly top: string;
  readonly width: string;
  readonly height: string;
} {
  const gap = gapFor(columns);
  return {
    left: `calc(${String(placement.column)} * (var(--cq-col) + ${String(gap)}px))`,
    top: `calc(${placement.ratiosAbove.toFixed(4)} * var(--cq-col) + ${String(placement.tilesAbove * (TILE_CAPTION_PX + gap))}px)`,
    width: "var(--cq-col)",
    height: `calc(${placement.ratio.toFixed(4)} * var(--cq-col) + ${String(TILE_CAPTION_PX)}px)`,
  };
}

export function containerHeight(layout: MasonryLayout): string {
  const gap = gapFor(layout.columns);
  return `calc(${layout.height.ratios.toFixed(4)} * var(--cq-col) + ${String(layout.height.tiles * (TILE_CAPTION_PX + gap))}px)`;
}

export function columnWidth(columns: number): string {
  return `calc((100cqw - ${String((columns - 1) * gapFor(columns))}px) / ${String(columns)})`;
}
