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

/**
 * Batch 17 (owner live 9 Nov): the task classes of the actor's OWN
 * organisation whose scopes this plan holds, beside whatever the turn is
 * about. Their own company: a COMPANY_PROFILE under its owner label
 * (organisation_private; a disclosed one never carries it). Their own
 * investor organisation: an INVESTOR_MANDATE, which the firewall admits to
 * its owner alone, or (batch 19, a plan preparing an action holds no
 * mandate) an INVESTOR_PROFILE under an owner's label. Read from the plan,
 * never from the request.
 */
/** The labels the firewall gives a scope only on its owner's side. */
const OWNER_LABELS: ReadonlySet<string> = new Set([
  "organisation_private",
  "investor_private",
]);

export function ownOrganisationPurposes(
  plan: Pick<PermittedContextPlan, "scopes">,
): readonly ("OWN_COMPANY_QUESTION" | "INVESTOR_QUESTION")[] {
  const out: ("OWN_COMPANY_QUESTION" | "INVESTOR_QUESTION")[] = [];
  if (
    plan.scopes.some(
      (scope) =>
        scope.kind === "COMPANY_PROFILE" &&
        scope.contextLabel === "organisation_private",
    )
  ) {
    out.push("OWN_COMPANY_QUESTION");
  }
  if (
    plan.scopes.some(
      (scope) =>
        scope.kind === "INVESTOR_MANDATE" ||
        (scope.kind === "INVESTOR_PROFILE" &&
          OWNER_LABELS.has(scope.contextLabel)),
    )
  ) {
    out.push("INVESTOR_QUESTION");
  }
  return out;
}
