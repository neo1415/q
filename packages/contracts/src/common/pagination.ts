import { z } from "zod";

/**
 * Capital Q lists paginate by opaque cursor, not offset.
 *
 * Offset pagination skips and duplicates rows whenever the underlying set
 * changes between requests, and gets slower the deeper a client pages. Both
 * matter for feeds and long relationship histories.
 *
 * A cursor is server-generated continuation state tied to a specific ordering.
 * Clients must treat it as opaque and must not decode, construct or reuse one
 * across orderings. Its encoding belongs to the query that issues it, so no
 * decoder is exported here. A valid cursor is also not an authorization: the
 * server re-checks access on every page.
 */
export const CursorSchema = z
  .string()
  .min(1, "expected a non-empty cursor")
  // Structural bound only. Cursors are server-generated and short; an
  // unbounded client-supplied string is needless attack surface.
  .max(2048, "cursor is too long to be one this server issued");

export type Cursor = z.infer<typeof CursorSchema>;

/** Normal list defaults. The feed tunes its own smaller page size separately. */
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/**
 * An explicitly invalid page size fails rather than being clamped. Silently
 * turning a requested 999999 into 100 hides a client bug and makes the response
 * disagree with the request.
 */
export const PageSizeSchema = z
  .number()
  .int("expected a whole number of items")
  .min(1, `expected a page size between 1 and ${String(MAX_PAGE_SIZE)}`)
  .max(
    MAX_PAGE_SIZE,
    `expected a page size between 1 and ${String(MAX_PAGE_SIZE)}`,
  );

export type PageSize = z.infer<typeof PageSizeSchema>;

/**
 * Continuation input for a normal list. Both fields are optional: the first
 * page has no cursor, and an absent limit means the server's default.
 */
export const CursorPageRequestSchema = z.object({
  cursor: CursorSchema.optional(),
  limit: PageSizeSchema.optional(),
});

export type CursorPageRequest = z.infer<typeof CursorPageRequestSchema>;

/**
 * Build the response schema for a cursor-paginated list of `itemSchema`.
 *
 *   { "items": [...], "nextCursor": "..." }
 *
 * An absent nextCursor means the end of the set.
 *
 * There is deliberately no totalCount or pageNumber. An exact count over a
 * filtered, permission-scoped set is expensive and is usually not needed; a
 * list that genuinely requires one asks for it explicitly.
 */
export function createCursorPageSchema<TItem extends z.ZodType>(
  itemSchema: TItem,
) {
  return z.object({
    items: z.array(itemSchema),
    nextCursor: CursorSchema.optional(),
  });
}
