import {
  Q_SENSITIVITY_RANK,
  type MarketplaceVisibility,
  type MessageSensitivity,
  type PermittedContextPlan,
  type QAuthorisedKnowledgeScope,
} from "@capital-q/contracts";

import type {
  RetrievalPermissionEnvelope,
  RetrievalScopeConstraint,
} from "./contracts.js";

/**
 * The deterministic projection from the Context Firewall's plan to what
 * retrieval may search (CQ-RAG-004 §10-§11).
 *
 * This is a projection, never a second policy. It reads a plan and drops
 * everything that is not a way into the derived chunk corpus; it cannot add
 * a scope, widen a label set, raise a ceiling or reach a subject the plan
 * did not name. If the firewall's answer is wrong, this is wrong in exactly
 * the same direction — which is the point: there is one place where "may
 * this actor see this?" is decided, and it is not here.
 */

/**
 * Which knowledge scopes are answered by derived chunks at all.
 *
 * The rest of the catalogue is canonical structured state (company profile,
 * capital objective, investor mandate), conversation history, or the model's
 * own general knowledge. Searching a pitch deck for the current raise when a
 * canonical Capital Objective exists would be a worse answer, not a better
 * one (§7), so those scopes are deliberately absent from this map rather
 * than merely unimplemented.
 */
const CHUNK_BACKED_SCOPE_KINDS = new Set([
  "EVIDENCE_DOCUMENTS",
  "NETWORK_VISIBLE_DATA",
  "PUBLIC_EXTERNAL_DATA",
]);

function weakerSensitivity(
  a: MessageSensitivity,
  b: MessageSensitivity,
): MessageSensitivity {
  return Q_SENSITIVITY_RANK[a] <= Q_SENSITIVITY_RANK[b] ? a : b;
}

/**
 * The subjects one scope reaches, or null when it is not narrowed by
 * subject. Null is not "every subject": it is only ever produced for
 * actor-wide scopes whose label is `network_visible` or `public_external`,
 * where the tenant and the label are the whole constraint.
 */
function subjectsFor(
  scope: QAuthorisedKnowledgeScope,
): readonly string[] | null {
  const fromFilter = scope.filter.companyId;
  if (fromFilter !== undefined) {
    return [fromFilter];
  }
  if (scope.subject?.kind === "COMPANY") {
    return [scope.subject.companyId];
  }
  return null;
}

/**
 * The disclosure scopes one plan scope admits. `filter.contextLabels` is the
 * firewall's explicit statement where it made one; otherwise the scope's own
 * label is the only one, because a scope classified `network_visible` grants
 * network-visible content and nothing quieter.
 */
function labelsFor(
  scope: QAuthorisedKnowledgeScope,
): readonly MarketplaceVisibility[] {
  const labels = scope.filter.contextLabels;
  if (labels !== undefined && labels.length > 0) {
    return labels;
  }
  return [scope.contextLabel];
}

export function retrievalConstraintsFor(
  plan: PermittedContextPlan,
): readonly RetrievalScopeConstraint[] {
  const allowedLayers = new Set(plan.allowedLayers);
  const constraints: RetrievalScopeConstraint[] = [];
  for (const scope of plan.scopes) {
    if (!CHUNK_BACKED_SCOPE_KINDS.has(scope.kind)) {
      continue;
    }
    // Defensive: the firewall already derives allowedLayers from the very
    // scopes it permitted, so a scope whose layer is absent would mean the
    // two disagree. Retrieval then trusts the narrower of the two.
    if (!allowedLayers.has(scope.layer)) {
      continue;
    }
    // AGGREGATE says policy requires a coarser projection than the raw
    // material. A chunk is raw material, so there is no honest way to serve
    // this scope from the corpus: it is dropped rather than approximated.
    if (scope.projection !== "FULL") {
      continue;
    }
    const visibilityScopes = labelsFor(scope);
    if (visibilityScopes.length === 0) {
      continue;
    }
    constraints.push({
      scopeKind: scope.kind,
      layer: scope.layer,
      subjectIds: subjectsFor(scope),
      visibilityScopes,
      // Two ceilings, and the weaker wins: what this scope classifies, and
      // what the whole run may reason over.
      sensitivityCeiling: weakerSensitivity(
        scope.sensitivity,
        plan.maxSensitivity,
      ),
      canDiscloseExistence: scope.rights.canDiscloseExistence,
      canQuote: scope.rights.canQuote,
      canProvideLink: scope.rights.canProvideLink,
    });
  }
  return constraints;
}

/**
 * Projects a plan into the envelope retrieval obeys.
 *
 * An envelope with no constraints is a valid, meaningful answer: this actor
 * has no authorised way into the corpus for this purpose. It is not an
 * error, and the response it produces is indistinguishable from "nothing
 * matched" — a distinction that would itself disclose existence (§14).
 */
export function envelopeFromPlan(
  plan: PermittedContextPlan,
): RetrievalPermissionEnvelope {
  return {
    planId: plan.planId,
    planFingerprint: plan.fingerprint,
    policyVersion: plan.policyVersion,
    tenantId: plan.tenantId,
    actorUserId: plan.actor.userId,
    organisationId: plan.actor.organisationId ?? null,
    taskClass: plan.purpose.taskClass,
    constraints: retrievalConstraintsFor(plan),
    maxSensitivity: plan.maxSensitivity,
    evaluatedAt: plan.evaluatedAt,
    revalidateAfter: plan.revalidateAfter,
  };
}

/**
 * Whether an envelope is still a decision rather than a memory (§12).
 *
 * A resumed run re-plans through the firewall before retrieval; this is the
 * belt to that brace, so a plan that somehow survives in a checkpoint cannot
 * be spent later as though it were a bearer token.
 */
export function envelopeIsCurrent(
  envelope: RetrievalPermissionEnvelope,
  now: Date,
): boolean {
  return now.getTime() < Date.parse(envelope.revalidateAfter);
}
