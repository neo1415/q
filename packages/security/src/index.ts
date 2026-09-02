/**
 * @capital-q/security
 *
 * Owns: reusable security primitives -- actor and tenant context, authorization
 * interfaces, sensitivity and redaction helpers, the Context Firewall boundary
 * (doc 23, 136; ERA-047). Centralised precisely so that no route, worker or Q
 * specialist reimplements its own version.
 * Does not own: business-domain rules unrelated to security.
 *
 * The rule this package exists to enforce:
 *
 *   AUTHENTICATED IDENTITY
 *   + SERVER-RESOLVED MEMBERSHIP
 *   + SERVER-RESOLVED TENANT / ORGANISATION
 *   = ActorContext
 *
 * A client-supplied identifier, role or tenant is never authority. Identifiers
 * arriving from a browser select a resource or request a context; only trusted
 * server resolution can grant one.
 *
 * Transport-neutral: no Fastify, no HTTP status, no database, no auth provider.
 * The HTTP adapter lives in the deployables and maps these errors onto the
 * Problem Details contract.
 *
 * Capabilities and resource authorization are NOT here. Holding an ActorContext
 * means the server knows who is acting and where; it does not mean they may
 * touch a given object. CQ-SEC-002 owns that decision.
 */

export {
  AuthUserIdSchema,
  MembershipIdSchema,
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
  type AuthUserId,
  type MembershipId,
  type OrganisationId,
  type TenantId,
  type UserId,
} from "./identity/ids.js";

export {
  AuthenticatedPrincipalSchema,
  type AuthenticatedPrincipal,
} from "./identity/principal.js";

export {
  ACTOR_TYPES,
  ActorContextSchema,
  ActorTypeSchema,
  type ActorContext,
  type ActorType,
} from "./actor-context/actor-context.js";

export {
  ORGANISATION_CONTEXT_HEADER,
  parseOrganisationSelector,
  UntrustedContextSelectionSchema,
  type UntrustedContextSelection,
} from "./actor-context/selector.js";

export {
  ActorContextDeniedError,
  ActorContextRequiredError,
  ActorContextResolutionError,
  AuthenticationRequiredError,
} from "./actor-context/errors.js";

export {
  ACTOR_CONTEXT_RESOLUTIONS,
  requireHumanActorContext,
  resolveHumanActorContext,
  type ActorContextResolution,
  type ActorContextResolutionStatus,
  type ActorContextResolver,
  type ResolveHumanActorContextInput,
} from "./actor-context/resolver.js";

export { isActorContext, requireActorContext } from "./actor-context/guards.js";

export * from "./authorization/index.js";

export const PACKAGE_NAME = "@capital-q/security" as const;
