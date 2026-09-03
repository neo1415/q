/**
 * @capital-q/permissions
 *
 * Owns: deterministic disclosure -- who may receive which information, in
 * which context, at which access level, under which active grant, until
 * when: the disclosure vocabularies, DisclosurePolicyId, the policy table
 * (permissions.disclosure_policies), the resource resolver registry, the
 * pure evaluator, the access service (single and batch), the grant/revoke
 * manager, owner inspection and the capability + disclosure guard.
 *
 * Does not own: company, investor, capital, relationship or Q truth
 * (reached only through public query ports), capability authorization
 * (consumed from @capital-q/security), authentication, verification,
 * sensitivity inheritance, combination risk, the Q Context Firewall, Data
 * Room, signed URLs, recommendations, notifications or any UI. Zero LLM
 * calls.
 *
 *   Authentication ≠ Authorization ≠ Disclosure ≠ Sensitivity
 *   ≠ Verification ≠ Data-use policy
 *   Q knows ≠ user may know ≠ user may share ≠ Q may execute
 *
 * Deliberately absent: any policy update, any policy delete, any HTTP
 * route, any ambient authority for Q, SYSTEM, CONNECTED_SYSTEM or the
 * database service role.
 */

export {
  accessLevelSatisfies,
  actorPrincipal,
  ANONYMOUS_PRINCIPAL,
  DISCLOSURE_ACCESS_LEVELS,
  DISCLOSURE_POLICY_STATUSES,
  DISCLOSURE_RECIPIENT_TYPES,
  DISCLOSURE_RESOURCE_TYPES,
  DISCLOSURE_SCOPES,
  DisclosureAccessLevelSchema,
  DisclosurePolicyIdSchema,
  DisclosurePrincipalSchema,
  DisclosureRecipientSchema,
  DisclosureRecipientTypeSchema,
  DisclosureResourceRefSchema,
  DisclosureResourceTypeSchema,
  DisclosureScopeSchema,
  isPolicyActiveAt,
  policyStatusAt,
  sameResource,
  type DisclosureAccessLevel,
  type DisclosurePolicy,
  type DisclosurePolicyId,
  type DisclosurePolicyStatus,
  type DisclosurePrincipal,
  type DisclosureRecipient,
  type DisclosureRecipientType,
  type DisclosureResourceDescriptor,
  type DisclosureResourceRef,
  type DisclosureResourceType,
  type DisclosureScope,
  type RelationshipParties,
  type RelationshipParty,
  type SensitivityClass,
} from "./contracts/index.js";

export {
  DISCLOSURE_ALLOW_REASONS,
  DISCLOSURE_DENY_REASONS,
  type DisclosureAllowReason,
  type DisclosureDecision,
  type DisclosureDenyReason,
  type DisclosurePath,
} from "./domain/decision.js";
export {
  evaluateDisclosure,
  evaluateDisclosureMany,
  type DisclosureEvaluationRequest,
} from "./domain/evaluator.js";
export {
  policyRelationshipId,
  sameCanonicalPolicy,
  sameGrantIdentity,
  validatePolicyShape,
  type DisclosureGrantIdentity,
  type DisclosurePolicyShape,
} from "./domain/policy-rules.js";
export {
  DISCLOSURE_POLICY_INVALID_REASONS,
  DisclosureDeniedError,
  DisclosurePolicyConflictError,
  DisclosurePolicyExistsError,
  DisclosurePolicyInvalidError,
  DisclosurePolicyNotFoundError,
  DisclosureResourceNotFoundError,
  DisclosureResourceTypeUnknownError,
  type DisclosurePolicyInvalidReason,
} from "./domain/errors.js";

export type {
  DisclosureClock,
  DisclosurePolicyRepository,
  DisclosureResourceResolver,
  DisclosureResourceResolverRegistry,
  NewDisclosurePolicy,
  RelationshipPartyResolver,
} from "./application/ports.js";
export { createDisclosureResourceResolverRegistry } from "./application/resolver-registry.js";
export {
  createCapitalObjectiveDisclosureResolver,
  createCompanyDisclosureResolver,
  createDefaultDisclosureResolvers,
  createFounderProfileDisclosureResolver,
  createInvestorMandateDisclosureResolver,
  createInvestorOrganisationDisclosureResolver,
  createRelationshipDisclosureResolver,
  createRelationshipEventDisclosureResolver,
  type DisclosureDomainPorts,
} from "./application/resolvers.js";
export { createRelationshipPartyResolver } from "./application/relationship-parties.js";
export {
  createDisclosureAccessService,
  DISCLOSURE_BATCH_MAX,
  DisclosureAccessRequestSchema,
  type DisclosureAccessRequest,
  type DisclosureAccessService,
  type DisclosureAccessServiceDependencies,
} from "./application/access-service.js";
export {
  createDisclosurePolicyManager,
  DISCLOSURE_INSPECT,
  DISCLOSURE_MANAGE,
  RESOURCE_DISCLOSURE_POLICY,
  type DisclosurePolicyManager,
  type DisclosurePolicyManagerDependencies,
  type GrantDisclosureCommand,
  type GrantDisclosureResult,
  type RevokeDisclosureCommand,
  type RevokeDisclosureResult,
} from "./application/policy-manager.js";
export {
  createInspectResourceDisclosure,
  type DisclosurePolicyInspection,
  type InspectResourceDisclosure,
  type InspectResourceDisclosureQuery,
  type ResourceDisclosureInspection,
} from "./application/inspection.js";
export {
  createProtectedDisclosureGuard,
  type ProtectedDisclosureDecision,
  type ProtectedDisclosureGuard,
  type ProtectedDisclosureRequest,
} from "./application/protected-guard.js";
export type { PermissionsServiceDependencies } from "./application/dependencies.js";
export {
  createPermissionsService,
  systemDisclosureClock,
  type PermissionsService,
  type PermissionsServiceOptions,
} from "./application/service.js";

export { createPostgresDisclosurePolicyRepository } from "./infrastructure/postgres-disclosure-policy-repository.js";

export const PACKAGE_NAME = "@capital-q/permissions" as const;
