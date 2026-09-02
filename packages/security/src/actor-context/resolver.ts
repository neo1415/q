import type { AuthenticatedPrincipal } from "../identity/principal.js";
import { ActorContextSchema, type ActorContext } from "./actor-context.js";
import {
  ActorContextDeniedError,
  ActorContextRequiredError,
  ActorContextResolutionError,
} from "./errors.js";
import type { UntrustedContextSelection } from "./selector.js";

/**
 * Why context resolution ended the way it did.
 *
 * Kept distinct because the caller reacts differently to each, and because
 * "denied" and "none selected" are genuinely different situations for a user:
 * one is a dead end, the other is a prompt to choose an organisation.
 */
export const ACTOR_CONTEXT_RESOLUTIONS = [
  "RESOLVED",
  /** Authenticated, but no Capital Q person record exists for this identity. */
  "NO_APPLICATION_IDENTITY",
  /** No organisation context was selected and none could be established. */
  "CONTEXT_REQUIRED",
  /** The requested context is not available to this account. */
  "CONTEXT_NOT_ACCESSIBLE",
  /** The resolver produced something inconsistent. Server-side integrity failure. */
  "INVALID_CONTEXT",
] as const;

export type ActorContextResolutionStatus =
  (typeof ACTOR_CONTEXT_RESOLUTIONS)[number];

export type ActorContextResolution =
  | { readonly status: "RESOLVED"; readonly context: ActorContext }
  | { readonly status: Exclude<ActorContextResolutionStatus, "RESOLVED"> };

export type ResolveHumanActorContextInput = {
  /** Trusted: produced by the authentication adapter. */
  readonly principal: AuthenticatedPrincipal;
  /** Untrusted: what the caller asked for. */
  readonly selection?: UntrustedContextSelection | undefined;
};

/**
 * The port through which server-owned identity and membership are consulted.
 *
 * Deliberately free of Supabase, SQL, HTTP and Fastify: the production
 * implementation reads authenticated user, application profile, active
 * membership, organisation and tenant, and arrives with CQ-DATA-002.
 *
 * An implementation MUST NOT resolve context by taking the first membership it
 * finds. Active organisation context is explicit. A user who belongs to three
 * organisations has no default one, and array order is not a security decision.
 */
export type ActorContextResolver = {
  readonly resolveHumanContext: (
    input: ResolveHumanActorContextInput,
  ) => Promise<ActorContextResolution>;
};

/**
 * Resolve context and enforce the invariants a resolver cannot be trusted to
 * honour on its own.
 *
 * The resolver is server-side, but it is still an adapter: a bug or a
 * compromised implementation must not be able to hand back a context that
 * silently disagrees with what was asked for. These checks are cheap and they
 * are the difference between "the server decided" and "something decided".
 */
export async function resolveHumanActorContext(
  resolver: ActorContextResolver,
  input: ResolveHumanActorContextInput,
): Promise<ActorContextResolution> {
  const resolution = await resolver.resolveHumanContext(input);

  if (resolution.status !== "RESOLVED") {
    return resolution;
  }

  const parsed = ActorContextSchema.safeParse(resolution.context);

  if (!parsed.success) {
    return { status: "INVALID_CONTEXT" };
  }

  const context = parsed.data;

  // Only human requests travel this path. A browser must never be able to
  // obtain a Q, SYSTEM or CONNECTED_SYSTEM context; those are constructed at
  // their own trusted execution boundaries, once those boundaries exist.
  if (context.actorType !== "HUMAN") {
    return { status: "INVALID_CONTEXT" };
  }

  // Organisation and membership travel together. An organisation context with
  // no membership behind it is an assertion with nothing supporting it.
  const hasOrganisation = context.organisationId !== undefined;
  const hasMembership = context.membershipId !== undefined;

  if (hasOrganisation !== hasMembership) {
    return { status: "INVALID_CONTEXT" };
  }

  // If the caller asked for a specific organisation, that is the only one they
  // may be given. Silently switching them to another organisation they happen
  // to belong to would execute their action against the wrong tenant.
  const requested = input.selection?.organisationId;

  if (requested !== undefined && context.organisationId !== requested) {
    return { status: "INVALID_CONTEXT" };
  }

  return { status: "RESOLVED", context };
}

/**
 * Resolve, or throw the matching security error.
 *
 * Fails closed in every non-resolved case. There is no fallback to a first
 * membership, a default organisation, or another tenant.
 */
export async function requireHumanActorContext(
  resolver: ActorContextResolver,
  input: ResolveHumanActorContextInput,
): Promise<ActorContext> {
  const resolution = await resolveHumanActorContext(resolver, input);

  switch (resolution.status) {
    case "RESOLVED":
      return resolution.context;
    case "CONTEXT_REQUIRED":
      throw new ActorContextRequiredError();
    case "NO_APPLICATION_IDENTITY":
    case "CONTEXT_NOT_ACCESSIBLE":
      // Both surface identically: whether the account has no profile or simply
      // no access to this organisation is not a caller's business to learn.
      throw new ActorContextDeniedError();
    case "INVALID_CONTEXT":
      throw new ActorContextResolutionError();
  }
}
