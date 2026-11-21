import type {
  PermittedContextPlan,
  QKnowledgeScopeKind,
} from "@capital-q/contracts";
import type { ActorContext } from "@capital-q/security";

/**
 * W2-A and W2-B (enterprise audit 21 Nov 2026, finding 8): the one check
 * that "this is the person's own conversation / own onboarding". Copies had
 * spread into 27 tool sites, the voice tools, Q's answer path and memory
 * recall, and drifted (some never required a person). Every caller asks
 * here, with the access context it was given, and nowhere else: the debt
 * guard refuses a new copy. It lives with the conversations it guards
 * (q-runtime), below every package that asks.
 *
 * All of these must hold; any one failing is a refusal:
 *   - a person is acting (never Q, the system or a connected system);
 *   - the plan was built for this very person in this very tenant, and for
 *     the organisation they act for now (a plan made under a membership
 *     that has since gone does not carry over to a context without it, and
 *     the reverse);
 *   - the plan holds the actor-wide scope of that kind, and the firewall
 *     bound it to this person and this tenant.
 *
 * The firewall builds every plan from the same actor, so for a legitimate
 * turn the bindings always hold, a founder with no organisation included;
 * they matter when a plan and an actor do not belong together.
 */
export type OwnScopeAccess = {
  readonly actor: ActorContext;
  readonly plan: PermittedContextPlan;
};

export type OwnScopeOptions = {
  /**
   * The caller also needs the organisation the person acts for (human
   * review files a case against it); acting personally is a refusal.
   */
  readonly requireOrganisation?: boolean | undefined;
};

/** The actor-wide own scopes this check guards. */
export type OwnActorScopeKind = Extract<
  QKnowledgeScopeKind,
  "OWN_Q_CONVERSATION" | "OWN_ONBOARDING"
>;

export function ownsActorScope(
  access: OwnScopeAccess,
  kind: OwnActorScopeKind,
  options: OwnScopeOptions = {},
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
  // The first actor-wide scope of the kind decides (as actorWideScope
  // reads it): a second one never rescues a first that names someone else.
  const scope = plan.scopes.find(
    (candidate) => candidate.kind === kind && candidate.subject === undefined,
  );
  return (
    scope !== undefined &&
    scope.filter.userId === actor.userId &&
    scope.filter.tenantId === actor.tenantId
  );
}

/** The person's own Q conversation (OWN_Q_CONVERSATION). */
export function ownsConversation(
  access: OwnScopeAccess,
  options: OwnScopeOptions = {},
): boolean {
  return ownsActorScope(access, "OWN_Q_CONVERSATION", options);
}

/** The person's own onboarding (OWN_ONBOARDING). */
export function ownsOnboarding(
  access: OwnScopeAccess,
  options: OwnScopeOptions = {},
): boolean {
  return ownsActorScope(access, "OWN_ONBOARDING", options);
}
