/**
 * Explore's mosaic (E2, ADR 0055; owner 2026-10-16: "the Instagram Explore
 * feel"): pure layout math, no DOM.
 *
 * The grid is square cells with a 2px gutter, laid out in two-row bands.
 * Each band has one tall tile (one column, two rows) at an edge, the side
 * alternating band by band, and on a wide screen every other band also
 * has one large tile (two columns, two rows). Every box is known from the
 * tile's rank and the column count alone, before a poster loads, so
 * nothing shifts (CLS) and the server and the browser agree. The DOM
 * keeps rank order and each band is read top-left first, so keyboard and
 * screen-reader order follow the rank and stay close to what the eye
 * reads (WCAG 2.4.3).
 */

/** The column counts the grid takes, narrowest first (see globals.css). */
export const MOSAIC_COLUMNS = [3, 4, 5] as const;
export type MosaicColumns = (typeof MOSAIC_COLUMNS)[number];

/** The grid's container width at which each count starts, in px. */
export const MOSAIC_BREAKPOINTS: Readonly<Record<MosaicColumns, number>> = {
  3: 0,
  4: 600,
  5: 960,
};

/** 3 columns on a phone (as Instagram), 4 on a tablet, 5 on a desktop. */
export function columnsForWidth(containerPx: number): MosaicColumns {
  if (containerPx >= MOSAIC_BREAKPOINTS[5]) return 5;
  if (containerPx >= MOSAIC_BREAKPOINTS[4]) return 4;
  return 3;
}

/** One box in a band: 0-based column and row, spans in cells. */
type Slot = {
  readonly col: number;
  readonly row: 0 | 1;
  readonly cols: 1 | 2;
  readonly rows: 1 | 2;
};

export type MosaicPlacement = {
  /** The tile's rank, which is also its DOM position. */
  readonly index: number;
  /** 1-based CSS grid lines. */
  readonly column: number;
  readonly row: number;
  readonly columnSpan: 1 | 2;
  readonly rowSpan: 1 | 2;
};

const square = (col: number, row: 0 | 1): Slot => ({
  col,
  row,
  cols: 1,
  rows: 1,
});

/** A band with the tall tile on the right and squares filling the rest. */
function tallBand(columns: number): readonly Slot[] {
  const slots: Slot[] = [{ col: columns - 1, row: 0, cols: 1, rows: 2 }];
  for (const row of [0, 1] as const) {
    for (let col = 0; col < columns - 1; col++) slots.push(square(col, row));
  }
  return slots;
}

/** A wide-screen band: a large tile on the left, a tall one on the right. */
function featureBand(columns: number): readonly Slot[] {
  const slots: Slot[] = [
    { col: 0, row: 0, cols: 2, rows: 2 },
    { col: columns - 1, row: 0, cols: 1, rows: 2 },
  ];
  for (const row of [0, 1] as const) {
    for (let col = 2; col < columns - 1; col++) slots.push(square(col, row));
  }
  return slots;
}

function mirror(slots: readonly Slot[], columns: number): readonly Slot[] {
  return slots.map((s) => ({ ...s, col: columns - s.col - s.cols }));
}

/** Reading order inside a band: by top row, then left to right. */
function reading(slots: readonly Slot[]): readonly Slot[] {
  return [...slots].sort((a, b) => a.row - b.row || a.col - b.col);
}

/** The bands a column count cycles through, already in reading order. */
function bandsFor(columns: MosaicColumns): readonly (readonly Slot[])[] {
  if (columns === 5) {
    return [featureBand(5), mirror(tallBand(5), 5)].map(reading);
  }
  return [tallBand(columns), mirror(tallBand(columns), columns)].map(reading);
}

const BANDS: Readonly<Record<MosaicColumns, readonly (readonly Slot[])[]>> = {
  3: bandsFor(3),
  4: bandsFor(4),
  5: bandsFor(5),
};

/** Every tile's box for this many tiles at this column count, in rank order. */
export function placeMosaic(
  count: number,
  columns: MosaicColumns,
): readonly MosaicPlacement[] {
  const bands = BANDS[columns];
  const placements: MosaicPlacement[] = [];
  let band = 0;
  let slot = 0;
  for (let index = 0; index < count; index++) {
    const slots = bands[band % bands.length] ?? [];
    const at = slots[slot];
    if (at === undefined) break;
    placements.push({
      index,
      column: at.col + 1,
      row: band * 2 + at.row + 1,
      columnSpan: at.cols,
      rowSpan: at.rows,
    });
    slot += 1;
    if (slot >= slots.length) {
      band += 1;
      slot = 0;
    }
  }
  return placements;
}

/**
 * One tile's position as custom properties for every column count; CSS
 * picks the set for the grid's width (container queries in globals.css),
 * so the server render is already the final layout and nothing is
 * measured by script.
 */
export function mosaicCellStyle(
  layouts: Readonly<Record<MosaicColumns, readonly MosaicPlacement[]>>,
  index: number,
): Record<string, string> {
  const style: Record<string, string> = {};
  for (const columns of MOSAIC_COLUMNS) {
    const placement = layouts[columns][index];
    if (placement === undefined) continue;
    const n = String(columns);
    style[`--x${n}`] =
      `${String(placement.column)} / span ${String(placement.columnSpan)}`;
    style[`--y${n}`] =
      `${String(placement.row)} / span ${String(placement.rowSpan)}`;
  }
  return style;
}

/** Every column count's layout for this many tiles. */
export function mosaicLayouts(
  count: number,
): Readonly<Record<MosaicColumns, readonly MosaicPlacement[]>> {
  return {
    3: placeMosaic(count, 3),
    4: placeMosaic(count, 4),
    5: placeMosaic(count, 5),
  };
}
