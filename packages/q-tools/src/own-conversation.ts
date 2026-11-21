import type { PermittedContextPlan } from "@capital-q/contracts";
import type { ActorContext } from "@capital-q/security";

import { actorWideScope } from "./plan.js";

/**
 * W2-A (enterprise audit 21 Nov 2026, finding 8): the one "this is the
 * person's own Q conversation" check. It was copied into 23 tool files and
 * inlined in 4 more, and had drifted (one inline copy did not require a
 * person at all). Every tool that acts in the person's own conversation
 * asks here, with the access context it was given, and nowhere else (the
 * debt guard refuses a new copy).
 *
 * All of these must hold; any one failing is a refusal:
 *   - a person is acting (never Q, the system or a connected system);
 *   - the plan was built for this very person in this very tenant, and for
 *     the organisation they act for now (a plan made under a membership
 *     that has since gone does not carry over to a context without it, and
 *     the reverse);
 *   - the plan holds the actor-wide OWN_Q_CONVERSATION scope, and the
 *     firewall bound that scope to this person and this tenant.
 *
 * The firewall builds every plan from the same actor, so for a legitimate
 * turn the extra bindings always hold; they matter when a plan and an actor
 * do not belong together.
 */
export type OwnConversationAccess = {
  readonly actor: ActorContext;
  readonly plan: PermittedContextPlan;
};

export function ownsConversation(
  access: OwnConversationAccess,
  options: {
    /**
     * The tool also needs the organisation the person acts for (human
     * review files a case against it); acting personally is a refusal.
     */
    readonly requireOrganisation?: boolean | undefined;
  } = {},
): boolean {
  const { actor, plan } = access;
  if (actor.actorType !== "HUMAN") return false;
  if (
    options.requireOrganisation === true &&
    actor.organisationId === undefined
  ) {
    return false;
  }
  if (
    plan.tenantId !== actor.tenantId ||
    plan.actor.userId !== actor.userId ||
    plan.actor.organisationId !== actor.organisationId
  ) {
    return false;
  }
  const scope = actorWideScope(plan, "OWN_Q_CONVERSATION");
  return (
    scope !== undefined &&
    scope.filter.userId === actor.userId &&
    scope.filter.tenantId === actor.tenantId
  );
}
