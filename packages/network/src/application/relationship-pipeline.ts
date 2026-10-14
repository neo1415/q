import { createHash } from "node:crypto";

import {
  RelationshipPipelineQueryError,
  InterestNotFoundError,
} from "../domain/errors.js";
import { z } from "zod";
import type {
  RelationshipPipelineQuery,
  RelationshipPipelineDto,
  RelationshipSummaryDto,
} from "@capital-q/contracts";

/** These rows have already passed the owning Network party/visibility fold. */
const CursorSchema = z
  .object({
    binding: z.string().length(64),
    id: z.string().uuid(),
    key: z.string().max(240),
  })
  .strict();
function sortedRows(
  rows: readonly RelationshipSummaryDto[],
  query: RelationshipPipelineQuery,
) {
  const q = (query.q ?? "").trim().toLowerCase();
  const sort = query.sort ?? "recent";
  const key = (row: RelationshipSummaryDto) =>
    sort.startsWith("name")
      ? row.counterpart.name.toLowerCase()
      : row.stateSince;
  const direction = sort === "recent" || sort === "name-desc" ? -1 : 1;
  const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  const filtered = rows.filter(
    (row) =>
      (query.state === undefined || row.state === query.state) &&
      row.counterpart.name.toLowerCase().includes(q),
  );
  return {
    rows: filtered.toSorted(
      (a, b) =>
        direction * compare(key(a), key(b)) ||
        compare(a.relationshipId, b.relationshipId),
    ),
    key,
  };
}
export function selectRelationshipPipeline(
  rows: readonly RelationshipSummaryDto[],
  query: RelationshipPipelineQuery,
  actorScope: string,
): RelationshipPipelineDto {
  const sorted = sortedRows(rows, query);
  const binding = createHash("sha256")
    .update(
      JSON.stringify([
        actorScope,
        (query.q ?? "").trim().toLowerCase(),
        query.state ?? null,
        query.sort ?? "recent",
        query.pageSize ?? 25,
        // Bind the same fresh authorized projection, not just the boundary.
        // Otherwise a renamed/reclassified row can jump across that boundary
        // and be omitted or repeated on a later page. Hash stays opaque.
        sorted.rows.map((row) => [row.relationshipId, sorted.key(row), row.state]),
      ]),
    )
    .digest("hex");
  let start = 0;
  if (query.cursor !== undefined) {
    let cursor: z.infer<typeof CursorSchema>;
    try {
      cursor = CursorSchema.parse(
        JSON.parse(Buffer.from(query.cursor, "base64url").toString("utf8")),
      );
    } catch {
      throw new RelationshipPipelineQueryError();
    }
    if (cursor.binding !== binding) throw new RelationshipPipelineQueryError();
    const at = sorted.rows.findIndex(
      (row) =>
        row.relationshipId === cursor.id && sorted.key(row) === cursor.key,
    );
    if (at === -1) throw new RelationshipPipelineQueryError();
    start = at + 1;
  }
  const pageSize = query.pageSize ?? 25;
  const items = sorted.rows.slice(start, start + pageSize);
  const last = items.at(-1);
  return {
    items,
    total: sorted.rows.length,
    nextCursor:
      last === undefined || start + items.length >= sorted.rows.length
        ? null
        : Buffer.from(
            JSON.stringify({
              binding,
              id: last.relationshipId,
              key: sorted.key(last),
            }),
          ).toString("base64url"),
  };
}
export function relationshipPipelineExportRows(
  rows: readonly RelationshipSummaryDto[],
  query: RelationshipPipelineQuery,
  selected: readonly string[],
): readonly RelationshipSummaryDto[] {
  const filtered = sortedRows(rows, query).rows;
  const ids = new Set(selected);
  if (
    ids.size !== selected.length ||
    (ids.size > 0 &&
      filtered.filter((row) => ids.has(row.relationshipId)).length !== ids.size)
  )
    throw new InterestNotFoundError();
  return ids.size === 0
    ? filtered
    : filtered.filter((row) => ids.has(row.relationshipId));
}
