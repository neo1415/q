import type { DatabaseExecutor } from "@capital-q/database";

import { isPolicyActiveAt } from "../contracts/index.js";
import type { DisclosurePolicyRepository } from "./ports.js";

/**
 * The documents one relationship can open now: each has an unrevoked,
 * unexpired disclosure policy naming the relationship. The relationship's
 * history keeps every share; this is what is still shared (live audit
 * 2026-11-15 O3: the deal read a revoked share as shared). An adapter
 * without the recipient read lists nothing, so nothing counts as shared.
 */
export async function stillSharedDocumentIds(
  repository: Pick<DisclosurePolicyRepository, "findUnrevokedForRecipient">,
  executor: DatabaseExecutor,
  relationshipId: string,
  now: Date = new Date(),
): Promise<readonly string[]> {
  const find = repository.findUnrevokedForRecipient;
  if (find === undefined) return [];
  const at = now.toISOString();
  const policies = await find(executor, {
    resourceType: "document",
    recipient: { type: "RELATIONSHIP", id: relationshipId },
  });
  return [
    ...new Set(
      policies
        .filter((policy) => isPolicyActiveAt(policy, at))
        .map((policy) => policy.resource.id),
    ),
  ];
}
