import { randomUUID } from "node:crypto";

import {
  auditActorFromContext,
  occurredNow,
  type MaterialActionAuditWriter,
} from "@capital-q/audit";
import type { TransactionManager } from "@capital-q/database";
import type { Logger } from "@capital-q/observability";
import { capability, type ActorContext } from "@capital-q/security";

import {
  GatewayIdSchema,
  GatewayPolicySchema,
  NewGatewayCriterionSchema,
  type Gateway,
  type GatewayId,
  type GatewayInboundMode,
  type GatewayPolicy,
  type GatewayPublicId,
  type GatewayVersion,
  type GatewayVersionId,
  type NewGatewayCriterion,
  type PublicGateway,
  type QualificationResult,
} from "../contracts/index.js";
import { generateGatewayPublicId } from "../domain/public-id.js";
import { publicProjectionOf } from "../domain/public-projection.js";
import {
  qualify,
  QUALIFICATION_POLICY_VERSION,
} from "../domain/qualification.js";
import type {
  CompanyQualificationProjectionPort,
  GatewayPolicyPort,
  GatewayRepository,
  GatewayVersionRepository,
  InvestorOrganisationDisplayPort,
} from "./ports.js";

/**
 * GateQ use cases (CQ-GATE-001 §6, §24).
 *
 * Every authenticated path resolves the actor's authority against the
 * OWNING investor organisation, read from the gateway row — never from a
 * field the caller supplied, and never from who created it. A person who
 * set a gateway up and then left the organisation has no more authority
 * over it than any other stranger, and the organisation's other admins
 * have no less.
 */

export const GATEWAY_CREATE = capability("investor.gateway.create");
export const GATEWAY_VIEW = capability("investor.gateway.view");
export const GATEWAY_EDIT = capability("investor.gateway.edit");
export const GATEWAY_PUBLISH = capability("investor.gateway.publish");

export class GatewayNotFoundError extends Error {
  constructor() {
    // Indistinguishable from "not yours": a caller must not learn that an
    // id exists in somebody else's organisation.
    super("No such gateway.");
    this.name = "GatewayNotFoundError";
  }
}

export class GatewayVersionNotDraftError extends Error {
  constructor() {
    super("Only a draft version can be edited or published.");
    this.name = "GatewayVersionNotDraftError";
  }
}

export class GateQNoPublishedPolicyError extends Error {
  constructor() {
    super("This gateway has no published policy.");
    this.name = "GateQNoPublishedPolicyError";
  }
}

export class CompanyProjectionUnavailableError extends Error {
  constructor() {
    super("No qualification projection is available for that company.");
    this.name = "CompanyProjectionUnavailableError";
  }
}

type Authorization = {
  readonly requireCapability: (input: {
    readonly actor: ActorContext;
    readonly capability: ReturnType<typeof capability>;
    readonly resource: {
      readonly kind: "RESOURCE";
      readonly tenantId: string;
      readonly organisationId: string;
      readonly resourceType: string;
      readonly resourceId: string;
    };
  }) => Promise<unknown>;
};

export type GateQDependencies = {
  readonly gateways: GatewayRepository;
  readonly versions: GatewayVersionRepository;
  readonly policies: GatewayPolicyPort;
  readonly companies: CompanyQualificationProjectionPort;
  readonly organisations: InvestorOrganisationDisplayPort;
  readonly authorization: Authorization;
  readonly transactions: TransactionManager;
  readonly audit: MaterialActionAuditWriter;
  readonly clock?: (() => Date) | undefined;
  readonly logger?: Logger | undefined;
};

export type GateQService = {
  readonly createGateway: (command: {
    readonly actor: ActorContext;
    readonly investorOrganisationId: string;
    readonly organisationId: string;
    readonly name: string;
  }) => Promise<Gateway>;
  readonly listGateways: (command: {
    readonly actor: ActorContext;
    readonly investorOrganisationId: string;
    readonly organisationId: string;
    readonly limit?: number | undefined;
  }) => Promise<readonly Gateway[]>;
  readonly getPolicy: (command: {
    readonly actor: ActorContext;
    readonly gatewayId: GatewayId;
    readonly versionId?: GatewayVersionId | undefined;
  }) => Promise<GatewayPolicy>;
  readonly listVersions: (command: {
    readonly actor: ActorContext;
    readonly gatewayId: GatewayId;
  }) => Promise<readonly GatewayVersion[]>;
  readonly createDraft: (command: {
    readonly actor: ActorContext;
    readonly gatewayId: GatewayId;
    readonly inboundMode: GatewayInboundMode;
    readonly publicTitle: string;
    readonly publicDescription?: string | null | undefined;
    readonly criteria: readonly NewGatewayCriterion[];
  }) => Promise<GatewayVersion>;
  readonly replaceDraft: (command: {
    readonly actor: ActorContext;
    readonly gatewayId: GatewayId;
    readonly versionId: GatewayVersionId;
    readonly inboundMode: GatewayInboundMode;
    readonly publicTitle: string;
    readonly publicDescription?: string | null | undefined;
    readonly criteria: readonly NewGatewayCriterion[];
  }) => Promise<GatewayVersion>;
  readonly publishVersion: (command: {
    readonly actor: ActorContext;
    readonly gatewayId: GatewayId;
    readonly versionId: GatewayVersionId;
  }) => Promise<GatewayVersion>;
  readonly qualifyCompany: (command: {
    readonly actor: ActorContext;
    readonly gatewayId: GatewayId;
    readonly companyId: string;
    readonly companyTenantId: string;
  }) => Promise<QualificationResult>;
  /** Anonymous. No actor, no authority, and only ever a published gateway. */
  readonly publicGateway: (
    publicId: GatewayPublicId,
  ) => Promise<PublicGateway | null>;
};

export function createGateQService(
  dependencies: GateQDependencies,
): GateQService {
  const {
    gateways,
    versions,
    policies,
    companies,
    organisations,
    authorization,
    transactions,
    audit,
    logger,
  } = dependencies;
  const clock = dependencies.clock ?? (() => new Date());

  /**
   * Resolve a gateway and check the actor may act on it.
   *
   * The organisation comes off the row. Nothing the caller sent is trusted
   * for authority, and "not found" is returned for a gateway in another
   * organisation so an id cannot be probed for existence.
   */
  const authorised = async (
    actor: ActorContext,
    gatewayId: GatewayId,
    required: ReturnType<typeof capability>,
  ): Promise<Gateway> => {
    const gateway = await gateways.findById(gatewayId);
    if (gateway === null || gateway.tenantId !== actor.tenantId) {
      throw new GatewayNotFoundError();
    }
    await authorization.requireCapability({
      actor,
      capability: required,
      resource: {
        kind: "RESOURCE",
        tenantId: gateway.tenantId,
        organisationId: gateway.organisationId,
        resourceType: "investor_gateway",
        resourceId: gateway.id,
      },
    });
    return gateway;
  };

  const recordAudit = async (
    tx: Parameters<MaterialActionAuditWriter["record"]>[0],
    actor: ActorContext,
    gateway: Pick<Gateway, "id" | "tenantId" | "organisationId">,
    actionType: string,
    metadata: Readonly<Record<string, string | number | boolean>>,
  ): Promise<void> => {
    await audit.record(tx, {
      auditEventId: randomUUID(),
      ...auditActorFromContext(actor),
      // The gateway's own tenant and organisation, from the row: an audit
      // line that recorded the caller's claimed context would be evidence
      // of nothing.
      tenantId: gateway.tenantId,
      organisationId: gateway.organisationId,
      actionType,
      resourceType: "investor_gateway",
      resourceId: gateway.id,
      occurredAt: occurredNow(),
      outcome: "SUCCEEDED",
      metadata,
    });
  };

  return {
    createGateway: async (command) => {
      const { actor } = command;
      await authorization.requireCapability({
        actor,
        capability: GATEWAY_CREATE,
        resource: {
          kind: "RESOURCE",
          tenantId: actor.tenantId,
          organisationId: command.organisationId,
          resourceType: "investor_organisation",
          resourceId: command.investorOrganisationId,
        },
      });
      return transactions.run(async (tx) => {
        const gateway = await gateways.create(tx, {
          id: GatewayIdSchema.parse(randomUUID()),
          tenantId: actor.tenantId,
          investorOrganisationId: command.investorOrganisationId,
          organisationId: command.organisationId,
          publicId: generateGatewayPublicId(),
          name: command.name,
          status: "ACTIVE",
          createdByUserId: actor.userId,
        });
        await recordAudit(tx, actor, gateway, "gateq.gateway.created", {
          investorOrganisationId: gateway.investorOrganisationId,
        });
        logger?.info(
          { gatewayId: gateway.id, organisationId: gateway.organisationId },
          "gateq gateway created",
        );
        return gateway;
      });
    },

    listGateways: async (command) => {
      await authorization.requireCapability({
        actor: command.actor,
        capability: GATEWAY_VIEW,
        resource: {
          kind: "RESOURCE",
          tenantId: command.actor.tenantId,
          organisationId: command.organisationId,
          resourceType: "investor_organisation",
          resourceId: command.investorOrganisationId,
        },
      });
      return gateways.listForInvestorOrganisation({
        tenantId: command.actor.tenantId,
        investorOrganisationId: command.investorOrganisationId,
        limit: Math.min(50, Math.max(1, command.limit ?? 20)),
      });
    },

    getPolicy: async (command) => {
      const gateway = await authorised(
        command.actor,
        command.gatewayId,
        GATEWAY_VIEW,
      );
      const version =
        command.versionId === undefined
          ? await versions.findPublished(gateway.id)
          : await versions.findById(command.versionId);
      if (version === null || version.gatewayId !== gateway.id) {
        throw new GateQNoPublishedPolicyError();
      }
      return GatewayPolicySchema.parse({
        gateway,
        version,
        criteria: await versions.criteriaFor(version.id),
      });
    },

    listVersions: async (command) => {
      const gateway = await authorised(
        command.actor,
        command.gatewayId,
        GATEWAY_VIEW,
      );
      return versions.listForGateway(gateway.id);
    },

    createDraft: async (command) => {
      const gateway = await authorised(
        command.actor,
        command.gatewayId,
        GATEWAY_EDIT,
      );
      const criteria = command.criteria.map((c) =>
        NewGatewayCriterionSchema.parse(c),
      );
      return transactions.run(async (tx) => {
        const version = await versions.createDraft(tx, {
          gatewayId: gateway.id,
          tenantId: gateway.tenantId,
          inboundMode: command.inboundMode,
          publicTitle: command.publicTitle,
          publicDescription: command.publicDescription ?? null,
          qualificationPolicyVersion: QUALIFICATION_POLICY_VERSION,
          createdByUserId: command.actor.userId,
          criteria,
        });
        await recordAudit(tx, command.actor, gateway, "gateq.draft.created", {
          versionNumber: version.versionNumber,
          criteria: criteria.length,
        });
        return version;
      });
    },

    replaceDraft: async (command) => {
      const gateway = await authorised(
        command.actor,
        command.gatewayId,
        GATEWAY_EDIT,
      );
      const existing = await versions.findById(command.versionId);
      if (existing === null || existing.gatewayId !== gateway.id) {
        throw new GatewayNotFoundError();
      }
      // Editing a draft must never move the public gateway (§5). The
      // published version is a different row and is not touched here.
      if (existing.status !== "DRAFT") throw new GatewayVersionNotDraftError();
      const criteria = command.criteria.map((c) =>
        NewGatewayCriterionSchema.parse(c),
      );
      return transactions.run(async (tx) => {
        const version = await versions.replaceDraft(tx, {
          versionId: command.versionId,
          inboundMode: command.inboundMode,
          publicTitle: command.publicTitle,
          publicDescription: command.publicDescription ?? null,
          criteria,
        });
        await recordAudit(tx, command.actor, gateway, "gateq.draft.updated", {
          versionNumber: version.versionNumber,
          criteria: criteria.length,
        });
        return version;
      });
    },

    publishVersion: async (command) => {
      // Publication is the consequential act: it changes what the world
      // sees and who may approach the organisation. It carries its own
      // capability rather than riding on edit.
      const gateway = await authorised(
        command.actor,
        command.gatewayId,
        GATEWAY_PUBLISH,
      );
      const existing = await versions.findById(command.versionId);
      if (existing === null || existing.gatewayId !== gateway.id) {
        throw new GatewayNotFoundError();
      }
      if (existing.status !== "DRAFT") throw new GatewayVersionNotDraftError();
      return transactions.run(async (tx) => {
        const published = await versions.publish(tx, {
          versionId: command.versionId,
          publishedByUserId: command.actor.userId,
          publishedAt: clock().toISOString(),
        });
        await recordAudit(
          tx,
          command.actor,
          gateway,
          "gateq.version.published",
          {
            versionNumber: published.version.versionNumber,
            inboundMode: published.version.inboundMode,
            ...(published.supersededVersionId === null
              ? {}
              : { supersededVersionId: published.supersededVersionId }),
          },
        );
        logger?.info(
          {
            gatewayId: gateway.id,
            versionNumber: published.version.versionNumber,
            inboundMode: published.version.inboundMode,
          },
          "gateq version published",
        );
        return published.version;
      });
    },

    qualifyCompany: async (command) => {
      const gateway = await authorised(
        command.actor,
        command.gatewayId,
        GATEWAY_VIEW,
      );
      const policy = await policies.publishedPolicy(gateway.id);
      if (policy === null) throw new GateQNoPublishedPolicyError();
      const projection = await companies.projectionFor({
        tenantId: command.companyTenantId,
        companyId: command.companyId,
      });
      if (projection === null) throw new CompanyProjectionUnavailableError();
      // Deterministic, in memory, from one bounded projection: no model, no
      // ranker, no second read per criterion.
      return qualify({
        policy,
        projection,
        evaluatedAt: clock().toISOString(),
      });
    },

    publicGateway: async (publicId) => {
      const policy = await policies.publishedPolicyByPublicId(publicId);
      if (policy === null) return null;
      const organisationDisplayName = await organisations.displayNameFor({
        tenantId: policy.gateway.tenantId,
        investorOrganisationId: policy.gateway.investorOrganisationId,
      });
      if (organisationDisplayName === null) return null;
      return publicProjectionOf({ policy, organisationDisplayName });
    },
  };
}
