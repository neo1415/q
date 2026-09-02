import { z } from "zod";
import { UuidSchema } from "@capital-q/contracts";

import {
  ActorContextSchema,
  type ActorContext,
} from "../actor-context/actor-context.js";
import { CapabilitySchema, type Capability } from "./capability.js";
import type { AuthoritySource, AuthorizationRequirement } from "./decision.js";
import { ResourceScopeSchema, type ResourceScope } from "./resource-scope.js";

/**
 * The limited situational context the security architecture anticipates
 * (doc 15, 12). Opaque references, validated as UUIDs.
 *
 * Supplying a relationshipId does not assert the actor belongs to that
 * relationship. It is input a policy may consult; the policy establishes the
 * facts. There is deliberately no open metadata field.
 */
export const AuthorizationContextSchema = z.object({
  relationshipId: UuidSchema.optional(),
  capitalObjectiveId: UuidSchema.optional(),
});

export type AuthorizationContext = z.infer<typeof AuthorizationContextSchema>;

/**
 * "May this actor perform this capability on this exact target?"
 *
 * The actor is the server-resolved ActorContext from CQ-SEC-001. It is never
 * accepted from a request body or query string.
 */
export const AuthorizationRequestSchema = z.object({
  actor: ActorContextSchema,
  capability: CapabilitySchema,
  resource: ResourceScopeSchema,
  context: AuthorizationContextSchema.optional(),
});

export type AuthorizationRequest = {
  readonly actor: ActorContext;
  readonly capability: Capability;
  readonly resource: ResourceScope;
  readonly context?: AuthorizationContext | undefined;
};

/** Policy says: this actor holds `capability` over `scope`. */
export type AuthorizationGrant = {
  readonly capability: Capability;
  readonly scope: ResourceScope;
  readonly source?: Exclude<AuthoritySource, "EXPLICIT_DENIAL"> | undefined;
};

/**
 * Policy says: this actor is refused `capability` over `scope`, regardless of
 * any grant. A confidentiality restriction on one document must beat a broad
 * role grant, so denials are evaluated first and always win.
 */
export type AuthorizationDenial = {
  readonly capability: Capability;
  readonly scope: ResourceScope;
  readonly source?: "EXPLICIT_DENIAL" | undefined;
};

/**
 * Everything the evaluator needs, already resolved to facts.
 *
 * Role templates, business titles, JWT claims and UI state are expanded into
 * grants and denials before they get here. The evaluator contains no
 * `if (role === ...)` because it never sees a role.
 */
export type AuthorizationPolicyFacts = {
  readonly grants: readonly AuthorizationGrant[];
  readonly denials: readonly AuthorizationDenial[];
  /** Conditions this actor has not yet satisfied for this request. */
  readonly unmetRequirements: readonly AuthorizationRequirement[];
};

/**
 * The port through which trusted policy is consulted.
 *
 * A future DB-backed implementation expands membership, role templates,
 * explicit grants, explicit denials and verification state into facts. None of
 * that is here: there is no production policy source in this packet and no
 * permissive in-memory stand-in. Where no source exists, protected operations
 * fail closed.
 */
export type AuthorizationPolicySource = {
  readonly getPolicyFacts: (
    request: AuthorizationRequest,
  ) => Promise<AuthorizationPolicyFacts>;
};
