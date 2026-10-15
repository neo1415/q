import type { RelationshipEvent, RelationshipId } from "../contracts/index.js";
import type { NetworkServiceDependencies } from "./dependencies.js";

const EVENT_PAGE = 500;

/** The whole ordered history of one relationship, page by page. */
export async function readHistory(
  dependencies: Pick<NetworkServiceDependencies, "sql" | "repositories">,
  relationshipId: RelationshipId,
): Promise<readonly RelationshipEvent[]> {
  const out: RelationshipEvent[] = [];
  let afterSequence = 0;
  for (;;) {
    const page = await dependencies.repositories.events.listByRelationship(
      dependencies.sql,
      relationshipId,
      { afterSequence, limit: EVENT_PAGE },
    );
    out.push(...page);
    const last = page.at(-1);
    if (page.length < EVENT_PAGE || last === undefined) return out;
    afterSequence = last.sequence;
  }
}

/**
 * S5 (lane S): the full ordered history of many relationships, read in one
 * round trip where the repository can (`listFirstByRelationships`): each
 * relationship's first page together, then any relationship whose first
 * page was full continues page by page exactly as readHistory does. Same
 * events, same order, so the deterministic projection is unchanged.
 */
export async function readHistories(
  dependencies: Pick<NetworkServiceDependencies, "sql" | "repositories">,
  relationshipIds: readonly RelationshipId[],
): Promise<ReadonlyMap<RelationshipId, readonly RelationshipEvent[]>> {
  const out = new Map<RelationshipId, RelationshipEvent[]>();
  // A duplicate id must never double a history (it would corrupt the fold).
  const ids = [...new Set(relationshipIds)];
  const batch = dependencies.repositories.events.listFirstByRelationships;
  if (batch === undefined) {
    for (const id of ids) {
      out.set(id, [...(await readHistory(dependencies, id))]);
    }
    return out;
  }
  for (const id of ids) out.set(id, []);
  const first = await batch(dependencies.sql, ids, EVENT_PAGE);
  // The projection depends on order: each history is put in sequence order
  // here whatever order the rows arrived in, and an event seen twice is
  // kept once.
  const seen = new Set<string>();
  for (const event of first) {
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    out.get(event.relationshipId)?.push(event);
  }
  for (const events of out.values()) {
    events.sort((a, b) => a.sequence - b.sequence);
  }
  for (const [id, events] of out) {
    let last = events.at(-1);
    let full = events.length >= EVENT_PAGE;
    while (full && last !== undefined) {
      const page = await dependencies.repositories.events.listByRelationship(
        dependencies.sql,
        id,
        { afterSequence: last.sequence, limit: EVENT_PAGE },
      );
      events.push(...page);
      full = page.length >= EVENT_PAGE;
      last = page.at(-1);
    }
  }
  return out;
}
