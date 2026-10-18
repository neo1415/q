import {
  ExploreCursorSchema,
  type ExploreCursor,
  type ExploreMode,
} from "@capital-q/contracts";

import {
  EXPLORE_CONFIG_V1,
  exploreSlate,
  type ExploreCandidate,
  type ExploreConfig,
  type ExplorePoolItem,
  type ExploreSignals,
} from "./policy.js";

/**
 * Cursor pages over an Explore slate, never offsets the client chooses.
 *
 * The cursor carries the slate's cut-off (`asOf`, the clock of its first
 * page) and the next position. Later pages recompute the same slate over
 * the pitches posted at or before the cut-off, so a pitch arriving
 * mid-session cannot shift what the person has not yet reached, and going
 * back keeps the order. The end of the slate is "You're up to date".
 */

export const EXPLORE_PAGE_DEFAULT = 18;
export const EXPLORE_PAGE_MAX = 30;

export class ExploreCursorRejectedError extends Error {
  constructor() {
    super("The cursor is not valid.");
    this.name = "ExploreCursorRejectedError";
  }
}

export function encodeExploreCursor(cursor: ExploreCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

export function decodeExploreCursor(raw: string | null): ExploreCursor | null {
  if (raw === null || raw.length === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    throw new ExploreCursorRejectedError();
  }
  const result = ExploreCursorSchema.safeParse(parsed);
  if (!result.success) throw new ExploreCursorRejectedError();
  return result.data;
}

export type ExploreSlatePage<T extends ExplorePoolItem> = {
  readonly items: readonly ExploreCandidate<T>[];
  readonly nextCursor: string | null;
  readonly upToDate: boolean;
};

export function exploreSlatePage<T extends ExplorePoolItem>(input: {
  readonly pool: readonly T[];
  readonly signals: ExploreSignals;
  readonly now: number;
  readonly cursor: string | null;
  readonly limit?: number | undefined;
  readonly config?: ExploreConfig | undefined;
}): ExploreSlatePage<T> {
  const cursor = decodeExploreCursor(input.cursor);
  const mode: ExploreMode = cursor?.mode ?? input.signals.mode;
  if (cursor !== null && cursor.mode !== input.signals.mode) {
    throw new ExploreCursorRejectedError();
  }
  const asOf = cursor?.asOf ?? new Date(input.now).toISOString();
  const cutOff = Date.parse(asOf);
  const limit = Math.max(
    1,
    Math.min(EXPLORE_PAGE_MAX, Math.trunc(input.limit ?? EXPLORE_PAGE_DEFAULT)),
  );
  const pool = input.pool.filter((item) => Date.parse(item.postedAt) <= cutOff);
  // Scores are relative to the cut-off, not the wall clock, so page two
  // is the same slate as page one even a day later.
  const slate = exploreSlate(
    pool,
    { ...input.signals, mode },
    cutOff,
    input.config ?? EXPLORE_CONFIG_V1,
  );
  const position = cursor?.position ?? 0;
  const items = slate.slice(position, position + limit);
  const next = position + items.length;
  const more = next < slate.length;
  return {
    items,
    nextCursor: more
      ? encodeExploreCursor({ v: 1, mode, asOf, position: next })
      : null,
    upToDate: !more,
  };
}
