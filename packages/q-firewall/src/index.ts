/**
 * @capital-q/q-firewall
 *
 * Owns: the Q Context Firewall — the deterministic boundary between what
 * Capital Q can technically access and the bounded context Q is permitted
 * to reason over for one actor, in one organisation, for one purpose,
 * about resolved subjects (doc 12 §15-16, doc 14 §30-31, doc 15 §19-22).
 * The scope catalogue, the purpose policy, the combination-risk rules, the
 * subject resolution and the plan assembly live here as small pure
 * policies in an explicit, monotonic order.
 *
 * Does not own: authorization (`@capital-q/security`), disclosure
 * (`@capital-q/permissions`), retrieval, ranking, the Data Room, Q
 * knowledge, model routing, or output filtering. No SQL, no model, no
 * cache.
 *
 *   Available knowledge ≠ authorised reasoning context
 *   Requested scope ≠ permitted scope     Authorisation ≠ truth
 *   Reasoning access ≠ disclosure access  Firewall ≠ RLS ≠ UI
 *
 * Server-side only.
 */

export {
  relationshipLabelsFor,
  rightsFor,
  SCOPE_CATALOGUE,
  SUBJECT_RELATIONS,
  type ScopeSpec,
  type SubjectRelation,
} from "./catalogue.js";
export {
  applyCombinationRules,
  COMBINATION_RISK_RULES,
  type CombinationOutcome,
  type CombinationRiskRule,
} from "./combination.js";
export {
  createContextFirewall,
  type ContextFirewallDependencies,
} from "./firewall.js";
export {
  actorWideScopeKinds,
  candidateScopeKinds,
  deriveTaskClass,
  sensitivityCeiling,
  type SubjectSummary,
} from "./purpose.js";
export {
  resolveSubject,
  type ResolvedSubject,
  type SubjectResolution,
  type SubjectResolutionPorts,
} from "./resolve.js";
export {
  CONTEXT_FIREWALL_POLICY_VERSION,
  CONTEXT_PLAN_REVALIDATE_AFTER_MS,
} from "./version.js";

export const PACKAGE_NAME = "@capital-q/q-firewall" as const;
