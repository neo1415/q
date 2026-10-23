import {
  BOARD_COLUMNS,
  type BoardItem,
  type BoardItemStatus,
} from "@capital-q/contracts";

/**
 * The work board's arrangement in the browser (owner 2026-10-23): the
 * server's items by column, a move applied at once while the server
 * confirms it (and undone if it refuses), and where a keyboard move goes.
 * Pure, so the same rules hold for a drag, a key and the Move menu.
 */

export type BoardColumns = Readonly<
  Record<BoardItemStatus, readonly BoardItem[]>
>;

/** Items by column, in the server's order (position, then creation). */
export function columnsOf(items: readonly BoardItem[]): BoardColumns {
  const columns: Record<BoardItemStatus, BoardItem[]> = {
    TODO: [],
    DOING: [],
    DONE: [],
  };
  for (const item of items) columns[item.status].push(item);
  return columns;
}

export type BoardPlace = {
  readonly status: BoardItemStatus;
  /** From 0, after the item has left its old place. */
  readonly index: number;
};

/** Where an item is now. Null: it is not on the board. */
export function placeOf(
  columns: BoardColumns,
  itemId: string,
): BoardPlace | null {
  for (const status of BOARD_COLUMNS) {
    const index = columns[status].findIndex((item) => item.id === itemId);
    if (index >= 0) return { status, index };
  }
  return null;
}

/** The board with one item moved (past a column's end is its end). */
export function moved(
  columns: BoardColumns,
  itemId: string,
  to: BoardPlace,
): BoardColumns {
  const from = placeOf(columns, itemId);
  if (from === null) return columns;
  const item = columns[from.status][from.index];
  if (item === undefined) return columns;
  const without: Record<BoardItemStatus, BoardItem[]> = {
    TODO: columns.TODO.filter((one) => one.id !== itemId),
    DOING: columns.DOING.filter((one) => one.id !== itemId),
    DONE: columns.DONE.filter((one) => one.id !== itemId),
  };
  const target = without[to.status];
  const at = Math.max(0, Math.min(to.index, target.length));
  target.splice(at, 0, { ...item, status: to.status });
  return without;
}

/** A move that changes nothing is not sent. */
export function isSamePlace(
  columns: BoardColumns,
  itemId: string,
  to: BoardPlace,
): boolean {
  const from = placeOf(columns, itemId);
  if (from === null) return true;
  const last = columns[to.status].length - (from.status === to.status ? 1 : 0);
  return from.status === to.status && from.index === Math.min(to.index, last);
}

export type BoardKey = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight";

/**
 * A keyboard step for a grabbed item: up and down within its column, left
 * and right to the neighbouring column (keeping its place where it can).
 * Null: it cannot go that way.
 */
export function stepped(
  columns: BoardColumns,
  place: BoardPlace,
  key: BoardKey,
): BoardPlace | null {
  const column = BOARD_COLUMNS.indexOf(place.status);
  switch (key) {
    case "ArrowUp":
      return place.index > 0 ? { ...place, index: place.index - 1 } : null;
    case "ArrowDown":
      return place.index < columns[place.status].length - 1
        ? { ...place, index: place.index + 1 }
        : null;
    case "ArrowLeft":
    case "ArrowRight": {
      const next = BOARD_COLUMNS[column + (key === "ArrowLeft" ? -1 : 1)];
      if (next === undefined) return null;
      return {
        status: next,
        index: Math.min(place.index, columns[next].length),
      };
    }
  }
}

/** The column names as the person reads them. */
export const COLUMN_LABELS: Readonly<Record<BoardItemStatus, string>> = {
  TODO: "To do",
  DOING: "Doing",
  DONE: "Done",
};

/** What a screen reader hears after a move, in plain words. */
export function movedWords(
  title: string,
  to: BoardPlace,
  total: number,
  t: (english: string) => string = (english) => english,
): string {
  return `${title}: ${t("moved to")} ${t(COLUMN_LABELS[to.status])}, ${t("position")} ${String(to.index + 1)} ${t("of")} ${String(total)}.`;
}
