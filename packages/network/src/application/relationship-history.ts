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
