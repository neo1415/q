import {
  AuditResourceTypeSchema,
  createAuditEventId,
  occurredNow,
  SecurityEventTypeSchema,
} from "@capital-q/audit";
import type { CorrelationId } from "@capital-q/contracts";
import {
  ActorContextDeniedError,
  ActorContextResolutionError,
  resolveHumanActorContext,
  type ActorContext,
  type AuthenticatedPrincipal,
  type OrganisationId,
} from "@capital-q/security";

import type { MembershipView } from "../domain/organisation.js";
import type { OrganisationServiceDependencies } from "./dependencies.js";

const CONTEXT_CHANGED = SecurityEventTypeSchema.parse(
  "organisation_context_changed",
);
const ORGANISATION_RESOURCE = AuditResourceTypeSchema.parse("organisation");

export type ActivateOrganisationCommand = {
  readonly principal: AuthenticatedPrincipal;
  /** Untrusted selector: the organisation the caller wants to act for. */
  readonly organisationId: OrganisationId;
  readonly correlationId: CorrelationId;
};

export type ActivatedOrganisationContext = {
  readonly view: MembershipView;
  /** Freshly resolved from the database after the switch. */
  readonly context: ActorContext;
};

/**
 * Switch the caller's active organisation context.
 *
 * Person-scoped: it cannot require the target to already be the context.
 * The existing ActiveOrganisationContextStore validates -- inside its own
 * transaction -- that the Person holds an *active* membership in the target
 * and persists that membership; anything else (no such organisation, never a
 * member, revoked, left) is one indistinguishable refusal. The ActorContext
 * is then re-resolved from rows, so tenant, membership and (through the
 * policy source) capabilities are re-evaluated for the new context.
 *
 * Future hooks documented here, deliberately not simulated: Q knowledge
 * scope, active company/investor, connector availability and data-use
 * policy will also re-evaluate at this boundary when they exist.
 *
 * A context switch is security-context activity, not business truth: it
 * records a security event, never a domain event.
 */
export function createActivateOrganisation(
  dependencies: OrganisationServiceDependencies,
) {
  const {
    sql,
    identities,
    activeContexts,
    resolver,
    securityEvents,
    onWarning,
    repositories,
  } = dependencies;

  return async (
    command: ActivateOrganisationCommand,
  ): Promise<ActivatedOrganisationContext> => {
    const identity = await identities(sql).lookup(command.principal);
    if (identity === null) {
      throw new ActorContextDeniedError();
    }

    const result = await activeContexts.setActiveContext({
      userId: identity.userId,
      organisationId: command.organisationId,
    });
    if (result.status !== "ACTIVE_CONTEXT_SET") {
      throw new ActorContextDeniedError();
    }

    const resolution = await resolveHumanActorContext(resolver, {
      principal: command.principal,
      selection: { organisationId: command.organisationId },
    });
    if (resolution.status !== "RESOLVED") {
      // Persisted a moment ago and now not resolvable: revoked in between,
      // or an integrity problem. Fail closed either way.
      throw resolution.status === "INVALID_CONTEXT"
        ? new ActorContextResolutionError()
        : new ActorContextDeniedError();
    }

    const view = await repositories.memberships.findActiveForUser(
      sql,
      identity.userId,
      command.organisationId,
    );
    if (view === null) {
      throw new ActorContextDeniedError();
    }

    if (securityEvents !== undefined) {
      try {
        await securityEvents.record({
          auditEventId: createAuditEventId(),
          tenantId: resolution.context.tenantId,
          userId: identity.userId,
          eventType: CONTEXT_CHANGED,
          severity: "INFO",
          resourceType: ORGANISATION_RESOURCE,
          resourceId: command.organisationId,
          occurredAt: occurredNow(),
          metadata: { membershipId: result.membershipId },
          correlationId: command.correlationId,
        });
      } catch (error) {
        // The switch has happened and is correct; a monitoring write that
        // fails must not undo it or turn it into an error for the caller.
        onWarning?.("organisation context change security event failed", error);
      }
    }

    return { view, context: resolution.context };
  };
}
