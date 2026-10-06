import type { FastifyInstance, FastifyRequest } from "fastify";

import {
  CreateGatewayRequestSchema,
  ApplicationSummaryDtoSchema,
  GATEQ_GATEWAY_APPLICATIONS_PATH,
  GATEQ_APPLY_MATERIALS_PATH,
  COMPANY_CLAIMABLE_PATH,
  FounderApplicationListDtoSchema,
  GATEQ_MY_APPLICATIONS_PATH,
  ClaimableCompanyListDtoSchema,
  type ClaimableCompanyDto,
  GATEQ_INBOX_ITEM_PATH,
  GATEQ_INBOX_PACK_PATH,
  GATEQ_INBOX_PATH,
  GateqInboxDetailDtoSchema,
  GateqInboxDtoSchema,
  GateqInboxViewSchema,
  ShareApplicationMaterialsRequestSchema,
  ShareApplicationMaterialsResponseSchema,
  GatewayApplicationListDtoSchema,
  GATEQ_GATEWAY_PATH,
  GATEQ_GATEWAY_PUBLISH_PATH,
  GATEQ_GATEWAY_QUALIFY_PATH,
  GATEQ_GATEWAY_VERSION_PATH,
  GATEQ_GATEWAY_VERSIONS_PATH,
  GATEQ_GATEWAYS_PATH,
  GATEQ_PUBLIC_GATEWAY_PATH,
  GatewayDraftRequestSchema,
  GatewayDtoSchema,
  GatewayPolicyDtoSchema,
  GatewayVersionDtoSchema,
  parseContract,
  PublicGatewayDtoSchema,
  QualificationResultDtoSchema,
  QualifyCompanyRequestSchema,
  UuidSchema,
} from "@capital-q/contracts";
import {
  GatewayPublicIdSchema,
  type GatewayPublicId,
  type Gateway,
  type GatewayId,
  type GatewayPolicy,
  type GatewayVersion,
  type GatewayVersionId,
  type GateQService,
  type QualificationResult,
} from "@capital-q/gateq";
import {
  IntakeRefusedError,
  type FounderApplication,
  type InboxService,
  type SubmissionInbox,
} from "@capital-q/gateq-intake";
import {
  billingAccountOf,
  FEATURE_GATEWAYS,
  type EntitlementService,
} from "@capital-q/billing";

import {
  getActorContext,
  requireActorContextHook,
  type ActorContextDependencies,
} from "../security/actor-context.js";
import { sendEntitlementRequired } from "./billing.js";
import {
  MaterialNotSharableError,
  type ApplicationMaterials,
} from "../gateq/application-materials.js";

/**
 * `/v1/gateq` — configuring an organisation's front door, and the one
 * anonymous read of a published one (CQ-GATE-001 §24).
 *
 * Two audiences, and the boundary between them is the point. Everything
 * under `/gateways` is the organisation's own configuration: the service
 * resolves authority from the gateway's owning organisation, never from a
 * field in the request, and answers "no such gateway" for anything that is
 * not the caller's — so an id cannot be probed for existence.
 *
 * `/public/{publicId}` is the only route in the product with no actor at
 * all. It returns a whitelist built from named parts, never a redaction of
 * the private object, and a draft has no representation there whatsoever.
 * A published CLOSED gateway does have one: a founder holding a valid link
 * should be told the door is shut rather than that the link is wrong.
 *
 * Not here: anonymous application creation, document upload, the applicant
 * interview and the investor's applicant workspace. Those are GATE-002 and
 * GATE-003, and a half-built version of any of them would be worse than
 * none.
 */

export type GateQRoutesDependencies = ActorContextDependencies & {
  readonly gateq: GateQService;
  /** F2: the signed-in founder's own applications, as the investor answered them. */
  readonly myApplications?:
    | ((
        actor: ReturnType<typeof getActorContext>,
      ) => Promise<readonly FounderApplication[]>)
    | undefined;
  /** F3: companies a founder may find and claim (what they may already see). */
  readonly claimable?:
    | ((
        actor: ReturnType<typeof getActorContext>,
        text: string,
      ) => Promise<readonly ClaimableCompanyDto[]>)
    | undefined;
  /** F4: the organisation's GateQ inbox (its writes are declared app actions). */
  readonly inboxService?: InboxService | undefined;
  /** F4: the gateway's published reply promise, for its public page. */
  readonly publicReplyPromise?:
    ((publicId: GatewayPublicId) => Promise<number | null>) | undefined;
  /** F1: a signed-in founder sharing their own documents with an application. */
  readonly materials?: ApplicationMaterials | undefined;
  /** Submitted applications, read after GateQ authorises the gateway. */
  readonly inbox?: SubmissionInbox | undefined;
  // BILLING block (ADR 0034): how many gateways the account's plan allows.
  // Absent: no plan control (tests of the GateQ domain alone).
  readonly entitlements?: Pick<EntitlementService, "check"> | undefined;
  // end BILLING block
  /**
   * The organisation's card images for the public page, each under its
   * card's PUBLIC scope. Asked only once the gateway is published.
   * Absent: the page shows none.
   */
  readonly publicImages?:
    | ((publicId: GatewayPublicId) => Promise<{
        readonly photo: string | null;
        readonly cover: string | null;
      }>)
    | undefined;
};

const gatewayIdOf = (request: FastifyRequest): GatewayId =>
  parseContract(
    UuidSchema,
    (request.params as { gatewayId?: string }).gatewayId,
    "The gateway id is not valid.",
  ) as GatewayId;

const versionIdOf = (request: FastifyRequest): GatewayVersionId =>
  parseContract(
    UuidSchema,
    (request.params as { versionId?: string }).versionId,
    "The version id is not valid.",
  ) as GatewayVersionId;

function gatewayDto(gateway: Gateway): unknown {
  return GatewayDtoSchema.parse({
    id: gateway.id,
    publicId: gateway.publicId,
    name: gateway.name,
    status: gateway.status,
    createdAt: gateway.createdAt,
  });
}

function versionDto(version: GatewayVersion): unknown {
  return GatewayVersionDtoSchema.parse({
    id: version.id,
    versionNumber: version.versionNumber,
    status: version.status,
    inboundMode: version.inboundMode,
    publicTitle: version.publicTitle,
    publicDescription: version.publicDescription,
    publishedAt: version.publishedAt,
  });
}

function policyDto(policy: GatewayPolicy): unknown {
  return GatewayPolicyDtoSchema.parse({
    gateway: gatewayDto(policy.gateway),
    version: versionDto(policy.version),
    criteria: policy.criteria.map((criterion) => ({
      id: criterion.id,
      position: criterion.position,
      requiredness: criterion.requiredness,
      label: criterion.label,
      config: criterion.config,
    })),
  });
}

function qualificationDto(result: QualificationResult): unknown {
  return QualificationResultDtoSchema.parse({
    gatewayId: result.gatewayId,
    gatewayVersionNumber: result.gatewayVersionNumber,
    inboundMode: result.inboundMode,
    outcome: result.outcome,
    access: result.access,
    accessReasonCode: result.accessReasonCode,
    // Reason codes and safe observed references only. No score, because
    // there is none; no internal version id, because the version number
    // already identifies the policy for anyone entitled to ask.
    criteria: result.criteria.map((criterion) => ({
      criterionId: criterion.criterionId,
      label: criterion.label,
      requiredness: criterion.requiredness,
      dimension: criterion.type,
      status: criterion.status,
      reasonCode: criterion.reasonCode,
      observed: criterion.observed,
    })),
    evaluatedAt: result.evaluatedAt,
  });
}

export function registerGateQRoutes(
  app: FastifyInstance,
  dependencies: GateQRoutesDependencies,
): void {
  const withContext = requireActorContextHook(dependencies);
  const gateq = dependencies.gateq;

  app.post(
    GATEQ_GATEWAYS_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const actor = getActorContext(request);
      const input = parseContract(
        CreateGatewayRequestSchema,
        request.body,
        "The gateway is not valid.",
      );
      // BILLING block: a new gateway counts against the plan's gateways.
      if (dependencies.entitlements !== undefined) {
        const existing = await gateq.listGateways({
          actor,
          investorOrganisationId: input.investorOrganisationId,
          organisationId: actor.organisationId ?? "",
        });
        const decision = await dependencies.entitlements.check(
          billingAccountOf(actor),
          FEATURE_GATEWAYS,
          {
            count: existing.filter((gateway) => gateway.status === "ACTIVE")
              .length,
          },
        );
        if (!decision.allowed) {
          return sendEntitlementRequired(request, reply, decision.refusal);
        }
      }
      // end BILLING block
      const gateway = await gateq.createGateway({
        actor,
        investorOrganisationId: input.investorOrganisationId,
        // The organisation is the actor's resolved one, not a body field.
        organisationId: actor.organisationId ?? "",
        name: input.name,
      });
      void reply.code(201).header("Cache-Control", "no-store");
      return gatewayDto(gateway);
    },
  );

  app.get(
    GATEQ_GATEWAYS_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const actor = getActorContext(request);
      const investorOrganisationId = parseContract(
        UuidSchema,
        (request.query as { investorOrganisationId?: string })
          .investorOrganisationId,
        "The investor organisation id is not valid.",
      );
      const gateways = await gateq.listGateways({
        actor,
        investorOrganisationId,
        organisationId: actor.organisationId ?? "",
      });
      void reply.header("Cache-Control", "no-store");
      return { gateways: gateways.map(gatewayDto) };
    },
  );

  const myApplications = dependencies.myApplications;
  if (myApplications !== undefined) {
    app.get(
      GATEQ_MY_APPLICATIONS_PATH,
      { onRequest: withContext },
      async (request, reply) => {
        const rows = await myApplications(getActorContext(request));
        void reply.header("Cache-Control", "no-store");
        return FounderApplicationListDtoSchema.parse({
          applications: rows.map((row) => ({
            applicationId: row.applicationId,
            fund: row.fund,
            sentAt: row.sentAt,
            status: row.status,
            reasonCode: row.reasonCode,
            message: row.message,
          })),
        });
      },
    );
  }

  const claimable = dependencies.claimable;
  if (claimable !== undefined) {
    // F3: "Find my startup". Only companies the caller may already see.
    app.get(
      COMPANY_CLAIMABLE_PATH,
      { onRequest: withContext },
      async (request, reply) => {
        const q = (request.query as { q?: unknown }).q;
        const text = typeof q === "string" ? q.slice(0, 120) : "";
        const companies = await claimable(getActorContext(request), text);
        void reply.header("Cache-Control", "no-store");
        return ClaimableCompanyListDtoSchema.parse({ companies });
      },
    );
  }

  const inboxService = dependencies.inboxService;
  if (inboxService !== undefined) {
    const uuidParam = (request: FastifyRequest, key: string): string =>
      parseContract(
        UuidSchema,
        (request.params as Record<string, string | undefined>)[key],
        "The id is not valid.",
      );

    // F4: the inbox, one view at a time. GateQ's gateway authority decides;
    // a gateway that is not the caller's is the same 404 as none.
    app.get(
      GATEQ_INBOX_PATH,
      { onRequest: withContext },
      async (request, reply) => {
        const view = GateqInboxViewSchema.catch("INBOX").parse(
          (request.query as { view?: string }).view,
        );
        const inbox = await inboxService.list(
          getActorContext(request),
          uuidParam(request, "gatewayId"),
          view,
        );
        if (!("items" in inbox)) {
          reply.callNotFound();
          return undefined;
        }
        void reply.header("Cache-Control", "no-store");
        return GateqInboxDtoSchema.parse(inbox);
      },
    );

    app.get(
      GATEQ_INBOX_ITEM_PATH,
      { onRequest: withContext },
      async (request, reply) => {
        const detail = await inboxService.detail(
          getActorContext(request),
          uuidParam(request, "gatewayId"),
          uuidParam(request, "applicationId"),
        );
        if (!("item" in detail)) {
          reply.callNotFound();
          return undefined;
        }
        void reply.header("Cache-Control", "no-store");
        return GateqInboxDetailDtoSchema.parse(detail);
      },
    );

    // The download pack: only what the founder sent; audited as it is built.
    app.get(
      GATEQ_INBOX_PACK_PATH,
      { onRequest: withContext },
      async (request, reply) => {
        const pack = await inboxService.pack(
          getActorContext(request),
          uuidParam(request, "gatewayId"),
          uuidParam(request, "applicationId"),
        );
        if (!("bytes" in pack)) {
          reply.callNotFound();
          return undefined;
        }
        return reply
          .header("Cache-Control", "no-store")
          .header("Content-Type", "application/zip")
          .header(
            "Content-Disposition",
            `attachment; filename="${pack.fileName.replace(/[^\w.-]/g, "-")}"`,
          )
          .send(Buffer.from(pack.bytes));
      },
    );
  }

  const materials = dependencies.materials;
  if (materials !== undefined) {
    app.post(
      GATEQ_APPLY_MATERIALS_PATH,
      { onRequest: withContext },
      async (request, reply) => {
        const input = parseContract(
          ShareApplicationMaterialsRequestSchema,
          request.body,
          "The request is not valid.",
        );
        try {
          const shared = await materials.share({
            actor: getActorContext(request),
            sessionToken: input.sessionToken,
            documentIds: input.documentIds,
          });
          void reply.header("Cache-Control", "no-store");
          return ShareApplicationMaterialsResponseSchema.parse(shared);
        } catch (error: unknown) {
          // A wrong credential and a document that is not theirs are one
          // answer: neither says which applications or documents exist.
          if (
            error instanceof IntakeRefusedError ||
            error instanceof MaterialNotSharableError
          ) {
            reply.callNotFound();
            return undefined;
          }
          throw error;
        }
      },
    );
  }

  const inbox = dependencies.inbox;
  if (inbox !== undefined) {
    app.get(
      GATEQ_GATEWAY_APPLICATIONS_PATH,
      { onRequest: withContext },
      async (request, reply) => {
        // GateQ's own policy read is the authorisation: a gateway the
        // caller's organisation does not own is the same 404 as none.
        const policy = await gateq.getPolicy({
          actor: getActorContext(request),
          gatewayId: gatewayIdOf(request),
        });
        const rows = await inbox.list({
          tenantId: policy.gateway.tenantId,
          gatewayId: policy.gateway.id,
        });
        void reply.header("Cache-Control", "no-store");
        return GatewayApplicationListDtoSchema.parse({
          applications: rows.flatMap((row) => {
            const application = ApplicationSummaryDtoSchema.safeParse(
              row.snapshot,
            );
            return application.success
              ? [
                  {
                    applicationId: row.applicationId,
                    submittedAt: row.submittedAt,
                    application: application.data,
                  },
                ]
              : [];
          }),
        });
      },
    );
  }

  app.get(
    GATEQ_GATEWAY_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const policy = await gateq.getPolicy({
        actor: getActorContext(request),
        gatewayId: gatewayIdOf(request),
      });
      void reply.header("Cache-Control", "no-store");
      return policyDto(policy);
    },
  );

  app.get(
    GATEQ_GATEWAY_VERSIONS_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const versions = await gateq.listVersions({
        actor: getActorContext(request),
        gatewayId: gatewayIdOf(request),
      });
      void reply.header("Cache-Control", "no-store");
      return { versions: versions.map(versionDto) };
    },
  );

  app.post(
    GATEQ_GATEWAY_VERSIONS_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const input = parseContract(
        GatewayDraftRequestSchema,
        request.body,
        "The draft is not valid.",
      );
      const version = await gateq.createDraft({
        actor: getActorContext(request),
        gatewayId: gatewayIdOf(request),
        inboundMode: input.inboundMode,
        publicTitle: input.publicTitle,
        publicDescription: input.publicDescription ?? null,
        criteria: input.criteria,
      });
      void reply.code(201).header("Cache-Control", "no-store");
      return versionDto(version);
    },
  );

  app.put(
    GATEQ_GATEWAY_VERSION_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const input = parseContract(
        GatewayDraftRequestSchema,
        request.body,
        "The draft is not valid.",
      );
      const version = await gateq.replaceDraft({
        actor: getActorContext(request),
        gatewayId: gatewayIdOf(request),
        versionId: versionIdOf(request),
        inboundMode: input.inboundMode,
        publicTitle: input.publicTitle,
        publicDescription: input.publicDescription ?? null,
        criteria: input.criteria,
      });
      void reply.header("Cache-Control", "no-store");
      return versionDto(version);
    },
  );

  // Publication is its own path and its own capability. It is the act that
  // changes who may approach the organisation, so it is never a side
  // effect of saving a draft.
  app.post(
    GATEQ_GATEWAY_PUBLISH_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const version = await gateq.publishVersion({
        actor: getActorContext(request),
        gatewayId: gatewayIdOf(request),
        versionId: versionIdOf(request),
      });
      void reply.header("Cache-Control", "no-store");
      return versionDto(version);
    },
  );

  app.post(
    GATEQ_GATEWAY_QUALIFY_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const actor = getActorContext(request);
      const input = parseContract(
        QualifyCompanyRequestSchema,
        request.body,
        "The request is not valid.",
      );
      const result = await gateq.qualifyCompany({
        actor,
        gatewayId: gatewayIdOf(request),
        companyId: input.companyId,
        companyTenantId: actor.tenantId,
      });
      void reply.header("Cache-Control", "no-store");
      return qualificationDto(result);
    },
  );

  /**
   * The anonymous read. No `onRequest` hook, deliberately and visibly.
   *
   * An unknown, unpublished or disabled gateway is the same 404: a public
   * identifier must not become an oracle for which organisations have a
   * gateway configured. The response is cacheable for a short time because
   * it is published information, and a CDN absorbing an embed's traffic is
   * the point of having an opaque id in the first place.
   */
  app.get(GATEQ_PUBLIC_GATEWAY_PATH, async (request, reply) => {
    // A malformed id is not a validation error here, it is a 404. A 422
    // would tell a caller their guess was the wrong SHAPE, which is the
    // first thing somebody enumerating would want to know; an unknown, an
    // unpublished, a disabled and a malformed gateway are one answer.
    const publicId = GatewayPublicIdSchema.safeParse(
      (request.params as { publicId?: string }).publicId,
    );
    if (!publicId.success) {
      reply.callNotFound();
      return undefined;
    }
    const projection = await gateq.publicGateway(publicId.data);
    if (projection === null) {
      reply.callNotFound();
      return undefined;
    }
    const images =
      dependencies.publicImages === undefined
        ? null
        : await dependencies.publicImages(publicId.data).catch(() => null);
    const replyWithinDays =
      dependencies.publicReplyPromise === undefined
        ? null
        : await dependencies
            .publicReplyPromise(publicId.data)
            .catch(() => null);
    // Briefly cacheable, well inside the signed URLs' own lifetime.
    void reply.header("Cache-Control", "public, max-age=60");
    return PublicGatewayDtoSchema.parse({
      ...projection,
      ...(replyWithinDays === null ? {} : { replyWithinDays }),
      ...(images === null
        ? {}
        : {
            organisationPhotoUrl: images.photo,
            organisationCoverUrl: images.cover,
          }),
    });
  });
}
