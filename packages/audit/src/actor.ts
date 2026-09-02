import type {
  ActorContext,
  OrganisationId,
  TenantId,
  UserId,
} from "@capital-q/security";

import { AuditActorError } from "./errors.js";

/**
 * The audit attribution fields derived from a trusted server ActorContext
 * for an ordinary direct human action. Never built from HTTP input: the
 * ActorContext was resolved from trusted rows by CQ-SEC-001/CQ-DATA-002.
 *
 * Resource type and id are not here on purpose: they come from the
 * authorised domain operation, and the actor's organisation is never assumed
 * to be the target resource.
 */
export type HumanAuditActor = {
  readonly tenantId: TenantId;
  readonly actorType: "HUMAN";
  readonly actorId: UserId;
  readonly authorityUserId: UserId;
  readonly organisationId: OrganisationId | undefined;
};

export function auditActorFromContext(context: ActorContext): HumanAuditActor {
  if (context.actorType !== "HUMAN") {
    // Q, system and connected-system attribution carry their own authority
    // semantics and are constructed explicitly by the owning code.
    throw new AuditActorError(
      `auditActorFromContext attributes direct human actions only; received ${context.actorType}`,
    );
  }
  return {
    tenantId: context.tenantId,
    actorType: "HUMAN",
    actorId: context.userId,
    authorityUserId: context.userId,
    organisationId: context.organisationId,
  };
}
