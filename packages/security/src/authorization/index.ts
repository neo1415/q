/**
 * Deterministic capability authorization.
 *
 *   ActorContext + Capability + exact ResourceScope + policy facts
 *     -> AuthorizationDecision
 *
 * What is never an input: a role name, a business title, UI state, a client
 * claim, a Q or model request, or tenant membership on its own.
 *
 * Deny by default. Explicit denial beats any grant. Cross-tenant never matches.
 * An exact-resource grant never leaks to a sibling. No actor type is a
 * superuser.
 *
 * This sits alongside row-level security, not instead of it: the service is
 * the application's authority decision and RLS is the database's defence in
 * depth. A privileged database connection that bypasses RLS still passes
 * through here.
 */

export {
  capability,
  CapabilitySchema,
  isKnownCapability,
  REFERENCE_CAPABILITIES,
  type Capability,
} from "./capability.js";

export {
  ResourceIdSchema,
  ResourceScopeSchema,
  ResourceTypeSchema,
  scopeCovers,
  type ResourceId,
  type ResourceScope,
  type ResourceType,
} from "./resource-scope.js";

export {
  AUTHORITY_SOURCES,
  AUTHORIZATION_OUTCOMES,
  AUTHORIZATION_REASONS,
  AUTHORIZATION_REQUIREMENTS,
  AuthorizationOutcomeSchema,
  AuthorizationRequirementSchema,
  type AuthoritySource,
  type AuthorizationDecision,
  type AuthorizationOutcome,
  type AuthorizationReason,
  type AuthorizationRequirement,
} from "./decision.js";

export {
  AuthorizationContextSchema,
  AuthorizationRequestSchema,
  type AuthorizationContext,
  type AuthorizationDenial,
  type AuthorizationGrant,
  type AuthorizationPolicyFacts,
  type AuthorizationPolicySource,
  type AuthorizationRequest,
} from "./policy.js";

export { evaluateAuthorization } from "./evaluator.js";

export {
  createAuthorizationService,
  type AuthorizationService,
} from "./service.js";

export {
  AuthorizationDeniedError,
  AuthorizationRequirementError,
} from "./errors.js";
