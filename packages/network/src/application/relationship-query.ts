import { createHash } from "node:crypto";
import type {
  RelationshipQuery,
  RelationshipSummaryDto,
  RelationshipViewDefinition,
} from "@capital-q/contracts";

export function filterRelationshipView(
  items: readonly RelationshipSummaryDto[],
  query: RelationshipViewDefinition,
): RelationshipSummaryDto[] {
  const name = query.nameQuery.toLocaleLowerCase("en");
  return items
    .filter(
      (item) =>
        (!name ||
          item.counterpart.name.toLocaleLowerCase("en").includes(name)) &&
        (!query.states.length || query.states.includes(item.state)),
    )
    .toSorted((a, b) => {
      const primary =
        query.sort === "NAME"
          ? a.counterpart.name.localeCompare(b.counterpart.name, "en")
          : query.sort === "OLDEST"
            ? a.stateSince.localeCompare(b.stateSince)
            : b.stateSince.localeCompare(a.stateSince);
      return primary || a.relationshipId.localeCompare(b.relationshipId);
    });
}
/** Cursor binds definition and current authorized source; changes require restart. */
// The canonical source limits before visibility filtering, so even a shorter
// authorized result cannot prove exhaustiveness. Conservatively mark bounded.
export function queryRelationships(
  items: readonly RelationshipSummaryDto[],
  query: RelationshipQuery,
) {
  const filtered = filterRelationshipView(items, query);
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        name: query.nameQuery,
        states: [...query.states].sort(),
        sort: query.sort,
        rows: filtered.map((x) => [
          x.relationshipId,
          x.state,
          x.stateSince,
          x.counterpart.name,
        ]),
      }),
    )
    .digest("hex")
    .slice(0, 24);
  let offset = 0;
  if (query.cursor !== null) {
    const [prefix, id] = query.cursor.split("~");
    const index = filtered.findIndex((item) => item.relationshipId === id);
    if (prefix !== fingerprint || index < 0)
      throw new Error("RELATIONSHIP_CURSOR_STALE");
    offset = index + 1;
  }
  const page = filtered.slice(offset, offset + query.limit);
  const last = page.at(-1);
  return {
    items: page,
    nextCursor:
      last !== undefined && offset + page.length < filtered.length
        ? `${fingerprint}~${last.relationshipId}`
        : null,
    sourceLimit: 200 as const,
    sourceMayBeTruncated: true,
  };
}
export function relationshipViewCsv(
  items: readonly RelationshipSummaryDto[],
): string {
  const cell = (value: string) =>
    `"${(/^[\s]*[=+@-]/.test(value) ? "'" + value : value).replaceAll('"', '""')}"`;
  return [
    ["Name", "State", "Since", "Next step"],
    ...items.map((item) => [
      item.counterpart.name,
      item.state,
      item.stateSince,
      item.nextStep,
    ]),
  ]
    .map((row) => row.map(cell).join(","))
    .join("\r\n");
}
