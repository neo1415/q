import type { DatabaseExecutor, TransactionManager } from "@capital-q/database";
import { GatewayIdSchema, type GateQService } from "@capital-q/gateq";
import type { ActorContext } from "@capital-q/security";

import { createPostgresInboxRepository } from "../infrastructure/postgres-inbox.js";
import type { InboxAuthority, SharedDocumentPort } from "./ports.js";
import { createInboxService, type InboxService } from "./service.js";
import type { GateqEmailEvent, GateqOutboundSender } from "./founder-mail.js";

/**
 * F4: the GateQ inbox, composed. GateQ's own gateway authority decides who
 * may see and act; the inbox service and store hold what the firm does.
 * Shared by the API (routes) and the Q API (tools and approved actions) so
 * the two cannot drift.
 */
export function gateqInboxAuthority(
  gateq: Pick<GateQService, "gatewayAccess">,
): InboxAuthority {
  return {
    authorise: async (actor, gatewayId) => {
      const id = GatewayIdSchema.safeParse(gatewayId);
      if (!id.success) return null;
      // Any refusal (not found, not theirs, no capability) is the same null.
      const access = await gateq
        .gatewayAccess({ actor, gatewayId: id.data })
        .catch(() => null);
      if (access === null) return null;
      return {
        gateway: {
          gatewayId: access.gateway.id,
          tenantId: access.gateway.tenantId,
          organisationId: access.gateway.organisationId,
          name: access.gateway.name,
          publicId: access.gateway.publicId,
          fund: access.organisationDisplayName ?? access.gateway.name,
        },
        canDecide: access.canEdit,
      };
    },
  };
}

export function createGateqInbox(options: {
  readonly sql: DatabaseExecutor;
  readonly transactions: TransactionManager;
  readonly gateq: Pick<GateQService, "gatewayAccess">;
  readonly documents?: SharedDocumentPort | undefined;
  readonly founderMail?: GateqOutboundSender | undefined;
  readonly onEmail?: ((event: GateqEmailEvent) => void) | undefined;
}): InboxService {
  return createInboxService({
    repository: createPostgresInboxRepository({ sql: options.sql }),
    authority: gateqInboxAuthority(options.gateq),
    transactions: options.transactions,
    documents: options.documents,
    founderMail: options.founderMail,
    onEmail: options.onEmail,
  });
}

/**
 * The inbox as the declared actions reach it (ADR 0040), plus the two
 * lookups Q needs because it has no screen: the actor's own gateway, and
 * an application or colleague by name.
 */
export function gateqInboxActionsPort(
  service: InboxService,
  ownGatewayId: (actor: ActorContext) => Promise<string | null>,
) {
  return {
    star: service.star,
    archive: service.archive,
    label: service.label,
    assign: service.assign,
    note: service.note,
    pass: service.pass,
    reply: service.reply,
    setReplyPromise: service.setReplyPromise,
    triage: service.triage,
    list: service.list,
    detail: service.detail,
    draftPass: service.draftPass,
    findApplication: service.findApplication,
    findMember: service.findMember,
    ownGatewayId,
  };
}

/** The investor organisation's first active gateway, through GateQ's own read. */
export function ownGatewayIdFrom(dependencies: {
  readonly gateq: Pick<GateQService, "listGateways">;
  readonly ownInvestorOrganisationId: (
    actor: ActorContext,
  ) => Promise<string | null>;
}) {
  return async (actor: ActorContext): Promise<string | null> => {
    const investorOrganisationId = await dependencies
      .ownInvestorOrganisationId(actor)
      .catch(() => null);
    if (investorOrganisationId === null) return null;
    const gateways = await dependencies.gateq
      .listGateways({
        actor,
        investorOrganisationId,
        organisationId: actor.organisationId ?? "",
      })
      .catch(() => []);
    return gateways.find((gateway) => gateway.status === "ACTIVE")?.id ?? null;
  };
}
