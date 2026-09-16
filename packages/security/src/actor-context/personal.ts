import type { ActorContext } from "./actor-context.js";
import { TenantIdSchema, type UserId } from "../identity/ids.js";

/**
 * A person acting personally, before any organisation exists for them.
 *
 * The actor context schema already allows a context with no organisation
 * and no membership; what such a person lacked was a tenant to be
 * attributed to, and every ledger and run row demands one. This is that
 * tenant: one well-known row, created by migration, owned by Capital Q,
 * holding nothing of anyone's but the attribution of what they asked Q
 * before setting up. It grants no organisation, no membership and no
 * subject; a route that accepts it must be one whose work needs none.
 */
export const PERSONAL_BOOTSTRAP_TENANT_ID = TenantIdSchema.parse(
  "b0075742-0000-4000-8000-000000000001",
);

export function personalActorContext(userId: UserId): ActorContext {
  return {
    userId,
    tenantId: PERSONAL_BOOTSTRAP_TENANT_ID,
    actorType: "HUMAN",
  };
}
