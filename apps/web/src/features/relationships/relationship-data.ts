import "server-only";

import {
  listCompanyRelationships,
  listInvestorRelationships,
} from "@capital-q/api-client";
import type { RelationshipSummaryDto } from "@capital-q/contracts";

import { apiSession, type OwnContext } from "@/features/q/context";

/**
 * The side's own relationships (CQ-WEB-030), or undefined when they
 * couldn't be read. A person with neither a company nor an investor
 * organisation has none. Each row is the API's answer from the per-party
 * projection over relationship events: state and "since" are read, never
 * recomputed here, and the API decides which relationships this person
 * may see.
 */
export async function ownRelationships(
  context: OwnContext,
): Promise<readonly RelationshipSummaryDto[] | undefined> {
  if (context.kind !== "FOUNDER" && context.kind !== "INVESTOR") return [];
  const session = await apiSession();
  if (session === null) return undefined;
  try {
    const list =
      context.kind === "FOUNDER"
        ? await listCompanyRelationships(session, context.companyId)
        : await listInvestorRelationships(session);
    return list.items;
  } catch {
    return undefined;
  }
}
