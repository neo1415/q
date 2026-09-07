import type {
  PermittedContextPlan,
  QAuthorisedKnowledgeScope,
  QKnowledgeScopeKind,
  QScopeFilter,
} from "@capital-q/contracts";

/**
 * Reading the Context Firewall's plan (CQ-Q-004) from a tool's side.
 *
 * The plan is the allowlist. A tool may reach a company's profile only
 * through a COMPANY_PROFILE scope bound to that company; a capital
 * objective only through its COMPANY_CAPITAL_OBJECTIVE scope; a mandate
 * only through the INVESTOR_MANDATE scope of its investor organisation;
 * and network discovery only under the actor-wide NETWORK_VISIBLE_DATA
 * scope. Nothing outside the plan is reachable, whatever the actor could
 * otherwise see: Q knowing a path exists is not permission to use it in
 * this conversation.
 */

export function scopesOfKind(
  plan: PermittedContextPlan,
  kind: QKnowledgeScopeKind,
): readonly QAuthorisedKnowledgeScope[] {
  return plan.scopes.filter((scope) => scope.kind === kind);
}

/** The bound scope of `kind` whose filter names the resource, or undefined. */
export function boundScopeFor(
  plan: PermittedContextPlan,
  kind: QKnowledgeScopeKind,
  matches: (filter: QScopeFilter) => boolean,
): QAuthorisedKnowledgeScope | undefined {
  return scopesOfKind(plan, kind).find(
    (scope) => scope.subject !== undefined && matches(scope.filter),
  );
}

/** An actor-wide scope (no subject) of `kind`, or undefined. */
export function actorWideScope(
  plan: PermittedContextPlan,
  kind: QKnowledgeScopeKind,
): QAuthorisedKnowledgeScope | undefined {
  return scopesOfKind(plan, kind).find((scope) => scope.subject === undefined);
}

export function planScopeKinds(
  plan: PermittedContextPlan,
): ReadonlySet<QKnowledgeScopeKind> {
  return new Set(plan.scopes.map((scope) => scope.kind));
}
