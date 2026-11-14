import { randomUUID } from "node:crypto";

import {
  auditActorFromContext,
  occurredNow,
  type MaterialActionAuditWriter,
} from "@capital-q/audit";
import { GatewayAppearanceRequestSchema } from "@capital-q/contracts";
import type { TransactionContext, TransactionManager } from "@capital-q/database";
import {
  ResourceScopeSchema,
  type ActorContext,
  type AuthorizationService,
} from "@capital-q/security";

import {
  GatewayIdSchema,
  type Gateway,
  type GatewayId,
  type GatewayPublicId,
} from "../contracts/index.js";
import type { GatewayRepository } from "./ports.js";
import {
  GATEWAY_PUBLISH,
  GATEWAY_VIEW,
  GatewayNotFoundError,
} from "./use-cases.js";

/**
 * B6 / B7 (2026-11-14): the investor organisation's own gateway, branded,
 * placed and paused by its admins, with no operator in the loop.
 *
 *   gateway appearance ≠ the tenant's brand theme (platform admins only)
 *   gateway status ≠ the published policy (its versions are untouched)
 *
 * Authority is GateQ's own, read from the gateway row: seeing the
 * appearance is investor.gateway.view; changing what the public sees (the
 * colour, who may frame the embed, whether the door is open) is
 * investor.gateway.publish, which only the organisation's admins hold. A
 * gateway in another tenant is "not found", exactly as everywhere in GateQ.
 * Every change is a new revision and a material-action audit line with the
 * values before and after; nothing is overwritten.
 */

export type GatewayAppearance = {
  readonly gatewayId: string;
  /** 0: never set. */
  readonly revision: number;
  readonly accentHex: string | null;
  readonly embedOrigins: readonly string[];
  readonly updatedAt: string | null;
};

export type GatewayAppearanceRepository = {
  /** The newest revision, or null when none was ever set. */
  readonly current: (gatewayId: string) => Promise<GatewayAppearance | null>;
  /**
   * Appends the next revision, under a lock on the gateway row so two
   * admins saving at once get revisions n+1 and n+2, never a collision.
   */
  readonly append: (
    tx: TransactionContext,
    input: {
      readonly gatewayId: string;
      readonly tenantId: string;
      readonly accentHex: string | null;
      readonly embedOrigins: readonly string[];
      readonly userId: string;
    },
  ) => Promise<GatewayAppearance>;
};

type Authorization = Pick<AuthorizationService, "requireCapability">;

export type GatewayAdminDependencies = {
  readonly gateways: GatewayRepository;
  readonly appearances: GatewayAppearanceRepository;
  readonly authorization: Authorization;
  readonly transactions: TransactionManager;
  readonly audit: MaterialActionAuditWriter;
};

export type GatewayAdminService = {
  readonly appearance: (command: {
    readonly actor: ActorContext;
    readonly gatewayId: GatewayId;
  }) => Promise<GatewayAppearance & { readonly canChange: boolean }>;
  readonly setAppearance: (command: {
    readonly actor: ActorContext;
    readonly gatewayId: GatewayId;
    readonly accentHex: string | null;
    readonly embedOrigins: readonly string[];
  }) => Promise<GatewayAppearance>;
  readonly setStatus: (command: {
    readonly actor: ActorContext;
    readonly gatewayId: GatewayId;
    readonly status: Gateway["status"];
  }) => Promise<Gateway>;
  /**
   * Anonymous: the appearance of an OPEN gateway by its public id. Paused
   * or unknown: null (the caller has already answered 404 for those).
   */
  readonly publicAppearance: (
    publicId: GatewayPublicId,
  ) => Promise<GatewayAppearance | null>;
};

const NEVER_SET = (gatewayId: string): GatewayAppearance => ({
  gatewayId,
  revision: 0,
  accentHex: null,
  embedOrigins: [],
  updatedAt: null,
});

export function createGatewayAdminService(
  dependencies: GatewayAdminDependencies,
): GatewayAdminService {
  const { gateways, appearances, authorization, transactions, audit } =
    dependencies;

  const scopeOf = (gateway: Gateway) =>
    ResourceScopeSchema.parse({
      kind: "RESOURCE",
      tenantId: gateway.tenantId,
      organisationId: gateway.organisationId,
      resourceType: "investor_gateway",
      resourceId: gateway.id,
    });

  const authorised = async (
    actor: ActorContext,
    gatewayId: GatewayId,
    required: typeof GATEWAY_VIEW,
  ): Promise<Gateway> => {
    const gateway = await gateways.findById(gatewayId);
    if (gateway === null || gateway.tenantId !== actor.tenantId) {
      throw new GatewayNotFoundError();
    }
    await authorization.requireCapability({
      actor,
      capability: required,
      resource: scopeOf(gateway),
    });
    return gateway;
  };

  const record = (
    tx: TransactionContext,
    actor: ActorContext,
    gateway: Gateway,
    actionType: string,
    metadata: Readonly<Record<string, string | number | boolean>>,
  ) =>
    audit.record(tx, {
      auditEventId: randomUUID(),
      ...auditActorFromContext(actor),
      // The gateway's own tenant and organisation, from the row.
      tenantId: gateway.tenantId,
      organisationId: gateway.organisationId,
      actionType,
      resourceType: "investor_gateway",
      resourceId: gateway.id,
      occurredAt: occurredNow(),
      outcome: "SUCCEEDED",
      metadata,
    });

  return {
    appearance: async ({ actor, gatewayId }) => {
      const gateway = await authorised(actor, gatewayId, GATEWAY_VIEW);
      let canChange = true;
      try {
        await authorization.requireCapability({
          actor,
          capability: GATEWAY_PUBLISH,
          resource: scopeOf(gateway),
        });
      } catch {
        canChange = false;
      }
      const current =
        (await appearances.current(gateway.id)) ?? NEVER_SET(gateway.id);
      return { ...current, canChange };
    },

    setAppearance: async ({ actor, gatewayId, accentHex, embedOrigins }) => {
      // Validated here too, not only at the route: Q's tool reaches this
      // service without HTTP, and the database check is the last line.
      const input = GatewayAppearanceRequestSchema.parse({
        accentHex,
        embedOrigins,
      });
      const gateway = await authorised(actor, gatewayId, GATEWAY_PUBLISH);
      const before =
        (await appearances.current(gateway.id)) ?? NEVER_SET(gateway.id);
      return transactions.run(async (tx) => {
        const next = await appearances.append(tx, {
          gatewayId: gateway.id,
          tenantId: gateway.tenantId,
          accentHex: input.accentHex,
          embedOrigins: input.embedOrigins,
          userId: actor.userId,
        });
        await record(tx, actor, gateway, "gateq.gateway.appearance_set", {
          revision: next.revision,
          accentBefore: before.accentHex ?? "none",
          accentAfter: next.accentHex ?? "none",
          embedOriginsBefore: before.embedOrigins.join(" ") || "any",
          embedOriginsAfter: next.embedOrigins.join(" ") || "any",
        });
        return next;
      });
    },

    setStatus: async ({ actor, gatewayId, status }) => {
      const gateway = await authorised(actor, gatewayId, GATEWAY_PUBLISH);
      if (gateway.status === status) return gateway;
      return transactions.run(async (tx) => {
        const changed = await gateways.setStatus(tx, gateway.id, status);
        await record(
          tx,
          actor,
          gateway,
          status === "ACTIVE" ? "gateq.gateway.reopened" : "gateq.gateway.paused",
          { statusBefore: gateway.status, statusAfter: changed.status },
        );
        return changed;
      });
    },

    publicAppearance: async (publicId) => {
      const gateway = await gateways.findByPublicId(publicId);
      if (gateway === null || gateway.status !== "ACTIVE") return null;
      return appearances.current(gateway.id);
    },
  };
}

/** A refusal Q and the route answer alike: never which of the two it was. */
const isRefusal = (error: unknown): boolean =>
  error instanceof GatewayNotFoundError ||
  (error instanceof Error && error.name === "AuthorizationDeniedError");

export type GatewayAdminResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false };

/**
 * The gateway's administration as the declared app actions reach it (ADR
 * 0040): the screen's routes and Q's tools call the same service as the
 * same person. A gateway that is not theirs, or that they may not change,
 * is one refusal. `ownGateway` is the lookup Q needs because it has no
 * screen: their organisation's open gateway, else its paused one.
 */
export function gatewayAdminActionsPort(dependencies: {
  readonly admin: GatewayAdminService;
  readonly listGateways: (command: {
    readonly actor: ActorContext;
    readonly investorOrganisationId: string;
    readonly organisationId: string;
  }) => Promise<readonly Gateway[]>;
  readonly ownInvestorOrganisationId: (
    actor: ActorContext,
  ) => Promise<string | null>;
}) {
  const refusing = async <T>(
    work: () => Promise<T>,
  ): Promise<GatewayAdminResult<T>> => {
    try {
      return { ok: true, value: await work() };
    } catch (error: unknown) {
      if (isRefusal(error)) return { ok: false };
      throw error;
    }
  };
  const idOf = (gatewayId: string): GatewayId | null => {
    const parsed = GatewayIdSchema.safeParse(gatewayId);
    return parsed.success ? parsed.data : null;
  };
  return {
    ownGateway: async (
      actor: ActorContext,
    ): Promise<{
      readonly id: string;
      readonly status: Gateway["status"];
    } | null> => {
      const investorOrganisationId = await dependencies
        .ownInvestorOrganisationId(actor)
        .catch(() => null);
      if (investorOrganisationId === null) return null;
      const gateways = await dependencies
        .listGateways({
          actor,
          investorOrganisationId,
          organisationId: actor.organisationId ?? "",
        })
        .catch(() => []);
      const gateway =
        gateways.find((item) => item.status === "ACTIVE") ?? gateways[0];
      return gateway === undefined
        ? null
        : { id: gateway.id, status: gateway.status };
    },
    appearance: (actor: ActorContext, gatewayId: string) => {
      const id = idOf(gatewayId);
      return id === null
        ? Promise.resolve({ ok: false } as const)
        : refusing(() => dependencies.admin.appearance({ actor, gatewayId: id }));
    },
    setAppearance: (
      actor: ActorContext,
      gatewayId: string,
      input: {
        readonly accentHex: string | null;
        readonly embedOrigins: readonly string[];
      },
    ) => {
      const id = idOf(gatewayId);
      return id === null
        ? Promise.resolve({ ok: false } as const)
        : refusing(() =>
            dependencies.admin.setAppearance({
              actor,
              gatewayId: id,
              accentHex: input.accentHex,
              embedOrigins: input.embedOrigins,
            }),
          );
    },
    setStatus: (
      actor: ActorContext,
      gatewayId: string,
      status: Gateway["status"],
    ) => {
      const id = idOf(gatewayId);
      return id === null
        ? Promise.resolve({ ok: false } as const)
        : refusing(() =>
            dependencies.admin.setStatus({ actor, gatewayId: id, status }),
          );
    },
  };
}
