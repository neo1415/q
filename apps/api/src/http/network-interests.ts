import type { FastifyInstance, FastifyRequest } from "fastify";

import {
  NETWORK_COMPANY_RELATIONSHIP_VIEWS_PATH,
  NETWORK_RELATIONSHIP_VIEWS_PATH,
  SavedRelationshipViewListSchema,
  CompanyInterestStatusDtoSchema,
  ConnectionStatusDtoSchema,
  IncomingConnectionRequestListDtoSchema,
  NETWORK_CONNECTION_REQUESTS_PATH,
  NETWORK_INVESTOR_CONNECTION_PATH,
  IncomingInterestListDtoSchema,
  NETWORK_COMPANY_INCOMING_INTEREST_PATH,
  NETWORK_COMPANY_INTEREST_PATH,
  NETWORK_COMPANY_RELATIONSHIP_PATH,
  NETWORK_INVESTOR_RELATIONSHIP_PATH,
  NETWORK_INVESTOR_RELATIONSHIPS_PATH,
  NETWORK_COMPANY_RELATIONSHIPS_PATH,
  NETWORK_PASS_REASONS_PATH,
  NETWORK_RELATIONSHIP_BRIEF_PATH,
  NETWORK_RELATIONSHIP_BRIEFS_PATH,
  NETWORK_RELATIONSHIP_GATEQ_APPLICATIONS_PATH,
  RelationshipGateqApplicationsDtoSchema,
  RelationshipBriefListQuerySchema,
  RelationshipBriefListSchema,
  NETWORK_RELATIONSHIP_DILIGENCE_PATH,
  RelationshipBriefSchema,
  NETWORK_DILIGENCE_DOWNLOAD_PATH,
  DiligenceDtoSchema,
  DiligenceDownloadDtoSchema,
  NETWORK_RELATIONSHIP_PASS_PATH,
  PassReasonListDtoSchema,
  RelationshipListDtoSchema,
  parseContract,
  RelationshipSummaryDtoSchema,
  NETWORK_INVESTOR_PIPELINE_PATH,
  NETWORK_COMPANY_PIPELINE_PATH,
  RelationshipPipelineQuerySchema,
  RelationshipPipelineExportQuerySchema,
  RelationshipPipelineDtoSchema,
  RelationshipPassResponseDtoSchema,
  RelationshipStatusResponseDtoSchema,
  type RelationshipSummaryDto,
} from "@capital-q/contracts";
import {
  InterestNotFoundError,
  selectRelationshipPipeline,
  relationshipPipelineScopeBinding,
  RelationshipPipelineLimitError,
  RelationshipPipelineQueryError,
  relationshipPipelineExportRows,
  toConnectionRequestDto,
  toIncomingConnectionRequestDto,
  toIncomingInterestDto,
  toInterestDto,
  toRelationshipStatusDto,
  toRelationshipSummaryDto,
  type ConnectionService,
  type InterestService,
  type RelationshipBriefBatchSources,
  type RelationshipBriefSources,
  type RelationshipOutcomeService,
} from "@capital-q/network";
import { reportCsvRows } from "@capital-q/results";
import type { DiligenceService } from "@capital-q/permissions";

import type { ActorContext } from "@capital-q/security";

import { photoLookup, type NamedPhotos } from "./named-photos.js";

import {
  getActorContext,
  requireActorContextHook,
  type ActorContextDependencies,
} from "../security/actor-context.js";

/**
 * `/v1/network/companies/:companyId/…` — Express Interest (CQ-NET-010).
 *
 * The one consequential command on the relationship spine, and it is
 * server-confirmed: the browser shows "sent" only after this answers.
 * Nothing on the request names an organisation, a tenant or a
 * relationship; the company id is input, and the service decides whether
 * this person, for their investor organisation, may act on it. A company
 * they may not see and one that does not exist are the same 404.
 *
 * CQ-NET-011 adds the company's side: its inbox of incoming interest and
 * the two answers, each a verb in the path. The interest id is input; the
 * service answers only for the company's own members with the capability,
 * and every other caller gets the same 404.
 *
 * Deliberately not here: Save and Pass (`/v1/discovery`, analytics of a
 * recommendation), messaging (CQ-COMM-001), and any read of the
 * relationship's history.
 */

export type NetworkInterestRoutesDependencies = ActorContextDependencies & {
  readonly interests: InterestService;
  /** ADR 0023: founders' Connection Requests. Absent: none of those routes register. */
  readonly connections?: ConnectionService | undefined;
  /**
   * Post-meeting outcomes (2026-10-02): the reads behind the Pass dialog
   * and the founder's notice. The commands are ADR 0040 app actions.
   */
  readonly outcomes?: RelationshipOutcomeService | undefined;
  /** Diligence reads: the area and a shared document's signed download. */
  readonly diligence?: DiligenceService | undefined;
  /** The named counterparts' pictures. Absent: every row reads as initials. */
  readonly namedPhotos?: NamedPhotos | undefined;
  /**
   * The Relationship Brief's readers (R1). Absent: the brief route still
   * answers, with those sources UNAVAILABLE (NOT_COMPOSED).
   */
  readonly briefSources?: RelationshipBriefSources | undefined;
  /** The batch readers for the list's briefs (R1). Absent: those sources UNAVAILABLE. */
  readonly briefBatchSources?: RelationshipBriefBatchSources | undefined;
  /**
   * GateQ applications on a relationship (CRM record). The route proves the
   * party and side first; this narrows by side. Absent: route not registered.
   */
  readonly gateqApplications?:
    | ((input: {
        readonly actor: ActorContext;
        readonly relationshipId: string;
        readonly side: "COMPANY" | "INVESTOR";
      }) => Promise<
        readonly {
          readonly applicationId: string;
          readonly reference: string;
          readonly gatewayName: string | null;
          readonly status: "IN_PROGRESS" | "READY_TO_SUBMIT" | "SUBMITTED";
          readonly startedAt: string;
          readonly submittedAt: string | null;
        }[]
      >)
    | undefined;
};

function investorIdOf(request: FastifyRequest): string {
  const raw = (request.params as { investorOrganisationId?: unknown })
    .investorOrganisationId;
  return typeof raw === "string" ? raw : "";
}

function companyIdOf(request: FastifyRequest): string {
  // Validated as a canonical company id by the service; an invalid one is
  // the same not-found as an unknown one.
  const raw = (request.params as { companyId?: unknown }).companyId;
  return typeof raw === "string" ? raw : "";
}

export function registerNetworkInterestRoutes(
  app: FastifyInstance,
  dependencies: NetworkInterestRoutesDependencies,
): void {
  const withContext = requireActorContextHook(dependencies);
  const service = dependencies.interests;

  // Each row names its counterpart to this party, so the counterpart's
  // logo is signed with it, in one batch for the whole list.
  const withCounterpartPhotos = async (
    items: readonly RelationshipSummaryDto[],
  ): Promise<RelationshipSummaryDto[]> => {
    const subjectOf = (item: RelationshipSummaryDto) => ({
      subjectType: item.counterpart.kind,
      subjectId: item.counterpart.id,
    });
    const photo = await photoLookup(
      dependencies.namedPhotos,
      items.map(subjectOf),
    );
    return items.map((item) => ({
      ...item,
      counterpart: { ...item.counterpart, photoUrl: photo(subjectOf(item)) },
    }));
  };

  app.get(
    NETWORK_COMPANY_INTEREST_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const interest = await service.getOwnInterest({
        actor: getActorContext(request),
        companyId: companyIdOf(request),
      });
      void reply.header("Cache-Control", "no-store");
      return CompanyInterestStatusDtoSchema.parse({
        interest: interest === null ? null : toInterestDto(interest),
      });
    },
  );

  // Where are we (CQ-NET-012): each party's view, folded from what it may read.
  app.get(
    NETWORK_COMPANY_RELATIONSHIP_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const status = await service.relationshipForInvestor({
        actor: getActorContext(request),
        companyId: companyIdOf(request),
      });
      void reply.header("Cache-Control", "no-store");
      return RelationshipStatusResponseDtoSchema.parse({
        relationship: status === null ? null : toRelationshipStatusDto(status),
      });
    },
  );
  app.get(
    NETWORK_INVESTOR_RELATIONSHIP_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const raw = (request.params as { investorOrganisationId?: unknown })
        .investorOrganisationId;
      const status = await service.relationshipForCompany({
        actor: getActorContext(request),
        investorOrganisationId: typeof raw === "string" ? raw : "",
      });
      void reply.header("Cache-Control", "no-store");
      return RelationshipStatusResponseDtoSchema.parse({
        relationship: status === null ? null : toRelationshipStatusDto(status),
      });
    },
  );

  // Post-meeting outcomes (2026-10-02): the reason categories, and the
  // current pass as the asking side may see it (a founder: only when the
  // investor shared the reason; otherwise null).
  const outcomes = dependencies.outcomes;
  if (outcomes !== undefined) {
    app.get(
      NETWORK_PASS_REASONS_PATH,
      { onRequest: withContext },
      async (_request, reply) => {
        void reply.header("Cache-Control", "private, max-age=300");
        return PassReasonListDtoSchema.parse({
          items: await outcomes.passReasons(),
        });
      },
    );
    app.get(
      NETWORK_RELATIONSHIP_PASS_PATH,
      { onRequest: withContext },
      async (request, reply) => {
        const params = request.params as Record<string, unknown>;
        const raw = params["relationshipId"];
        const pass = await outcomes.latestPass({
          actor: getActorContext(request),
          relationshipId: typeof raw === "string" ? raw : "",
        });
        void reply.header("Cache-Control", "no-store");
        return RelationshipPassResponseDtoSchema.parse({ pass });
      },
    );
  }

  // Diligence (2026-10-02): the relationship's area for the side asking, and
  // a shared document's short-lived download, decided by the disclosure
  // layer for this person. Writes are ADR 0040 app actions.
  // The Relationship Brief (R1): the same read Q's get_relationship uses.
  app.get(
    NETWORK_RELATIONSHIP_BRIEF_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const raw = (request.params as { relationshipId?: unknown })
        .relationshipId;
      const brief = await service.relationshipBrief({
        actor: getActorContext(request),
        relationshipId: typeof raw === "string" ? raw : "",
        sources: dependencies.briefSources ?? {},
      });
      // A relationship this person is not a party to is the same 404 as
      // one that does not exist.
      if (brief === null) throw new InterestNotFoundError();
      void reply.header("Cache-Control", "no-store");
      return RelationshipBriefSchema.parse(brief);
    },
  );

  const gateqApplications = dependencies.gateqApplications;
  if (gateqApplications !== undefined) {
    app.get(
      NETWORK_RELATIONSHIP_GATEQ_APPLICATIONS_PATH,
      { onRequest: withContext },
      async (request, reply) => {
        const raw = (request.params as { relationshipId?: unknown })
          .relationshipId;
        const relationshipId = typeof raw === "string" ? raw : "";
        const actor = getActorContext(request);
        // Party and side from the actor's own membership; a relationship
        // they are not party to is the same 404 as one that does not exist.
        const view = await service.relationshipById({ actor, relationshipId });
        if (view === null) throw new InterestNotFoundError();
        const items = await gateqApplications({
          actor,
          relationshipId,
          side: view.side,
        });
        void reply.header("Cache-Control", "no-store");
        return RelationshipGateqApplicationsDtoSchema.parse({
          relationshipId,
          side: view.side,
          items,
        });
      },
    );
  }

  // Every brief on one page of the viewer's own list (R1 batching): one
  // call instead of a thread, calls and diligence read per relationship.
  // A malformed query is the same not-found as a list that is not theirs.
  app.get(
    NETWORK_RELATIONSHIP_BRIEFS_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const briefs = service.relationshipBriefs;
      if (briefs === undefined) throw new InterestNotFoundError();
      const parsed = RelationshipBriefListQuerySchema.safeParse(
        request.query ?? {},
      );
      if (!parsed.success) throw new InterestNotFoundError();
      const items = await briefs({
        actor: getActorContext(request),
        companyId: parsed.data.companyId,
        relationshipIds:
          parsed.data.ids === undefined
            ? undefined
            : parsed.data.ids.split(",").filter((id) => id.length > 0),
        sources: dependencies.briefBatchSources ?? {},
      });
      void reply.header("Cache-Control", "no-store");
      return RelationshipBriefListSchema.parse({ items });
    },
  );

  const diligence = dependencies.diligence;
  if (diligence !== undefined) {
    const param = (request: FastifyRequest, key: string) => {
      const value = (request.params as Record<string, unknown>)[key];
      return typeof value === "string" ? value : "";
    };
    app.get(
      NETWORK_RELATIONSHIP_DILIGENCE_PATH,
      { onRequest: withContext },
      async (request, reply) => {
        const view = await diligence.view({
          actor: getActorContext(request),
          relationshipId: param(request, "relationshipId"),
        });
        if (view === null) {
          // The one not-found: a relationship or a share this person
          // cannot see is indistinguishable from none.
          throw new InterestNotFoundError();
        }
        void reply.header("Cache-Control", "no-store");
        return DiligenceDtoSchema.parse(view);
      },
    );
    app.get(
      NETWORK_DILIGENCE_DOWNLOAD_PATH,
      { onRequest: withContext },
      async (request, reply) => {
        const link = await diligence.download({
          actor: getActorContext(request),
          relationshipId: param(request, "relationshipId"),
          documentId: param(request, "documentId"),
          // View opens it in the browser; anything else saves it.
          disposition:
            (request.query as Record<string, unknown> | undefined)?.[
              "disposition"
            ] === "inline"
              ? "INLINE"
              : "ATTACHMENT",
        });
        if (link === null) {
          // The one not-found: a relationship or a share this person
          // cannot see is indistinguishable from none.
          throw new InterestNotFoundError();
        }
        void reply.header("Cache-Control", "no-store");
        return DiligenceDownloadDtoSchema.parse(link);
      },
    );
  }

  // Filter/page/export the same fresh authorised per-party projections. No
  // cached all-party state, private notes, events or document payloads leave.
  const pipelineRows = async (request: FastifyRequest, company: boolean) => {
    const actor = getActorContext(request);
    const listings = company
      ? await service.listRelationshipsForCompany({
          actor,
          companyId: companyIdOf(request),
          scanLimit: 1001,
        })
      : await service.listRelationshipsForInvestor({ actor, scanLimit: 1001 });
    return listings.map((listing) =>
      RelationshipSummaryDtoSchema.parse(
        toRelationshipSummaryDto(listing, company ? "COMPANY" : "INVESTOR"),
      ),
    );
  };
  const pipelineScope = (request: FastifyRequest, company: boolean) => {
    const actor = getActorContext(request);
    return [
      actor.userId,
      actor.tenantId,
      actor.organisationId,
      company ? companyIdOf(request) : "INVESTOR",
    ].join(":");
  };
  // Slice 3b: the read model when it is ready for this party; null keeps
  // the bounded in-memory path (never a page missing relationships).
  const pipelineFromReadModel = async (
    request: FastifyRequest,
    query: Parameters<typeof selectRelationshipPipeline>[1],
    company: boolean,
  ) => {
    try {
      return (
        (await service.relationshipPipeline?.page({
          actor: getActorContext(request),
          companyId: company ? companyIdOf(request) : undefined,
          query,
          actorScope: pipelineScope(request, company),
        })) ?? null
      );
    } catch (error: unknown) {
      // A refusal or a bad cursor is the caller's answer, as before.
      if (
        error instanceof RelationshipPipelineQueryError ||
        error instanceof RelationshipPipelineLimitError
      )
        throw error;
      // Otherwise (e.g. the read model's migration not yet applied) the
      // bounded path answers, which re-runs every authorisation itself.
      request.log.warn({ err: error }, "pipeline read model unavailable");
      return null;
    }
  };
  app.get(
    NETWORK_INVESTOR_PIPELINE_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const query = parseContract(
        RelationshipPipelineQuerySchema,
        request.query,
      );
      const page =
        (await pipelineFromReadModel(request, query, false)) ??
        selectRelationshipPipeline(
          await pipelineRows(request, false),
          query,
          pipelineScope(request, false),
        );
      void reply.header("Cache-Control", "no-store");
      return RelationshipPipelineDtoSchema.parse({
        ...page,
        items: await withCounterpartPhotos(page.items),
      });
    },
  );
  app.get(
    NETWORK_COMPANY_PIPELINE_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const query = parseContract(
        RelationshipPipelineQuerySchema,
        request.query,
      );
      const page =
        (await pipelineFromReadModel(request, query, true)) ??
        selectRelationshipPipeline(
          await pipelineRows(request, true),
          query,
          pipelineScope(request, true),
        );
      void reply.header("Cache-Control", "no-store");
      return RelationshipPipelineDtoSchema.parse({
        ...page,
        items: await withCounterpartPhotos(page.items),
      });
    },
  );
  const exportPipeline = async (
    request: FastifyRequest,
    reply: import("fastify").FastifyReply,
    company: boolean,
  ) => {
    const query = parseContract(
      RelationshipPipelineExportQuerySchema,
      request.query,
    );
    const fromReadModel = await service.relationshipPipeline
      ?.all({
        actor: getActorContext(request),
        companyId: company ? companyIdOf(request) : undefined,
        query,
      })
      .catch((error: unknown) => {
        if (error instanceof RelationshipPipelineLimitError) throw error;
        request.log.warn({ err: error }, "pipeline read model unavailable");
        return null;
      });
    const authorisedRows =
      fromReadModel ?? (await pipelineRows(request, company));
    if (
      query.scope !==
      relationshipPipelineScopeBinding(query, pipelineScope(request, company))
    )
      throw new RelationshipPipelineQueryError();
    const rows = relationshipPipelineExportRows(
      authorisedRows,
      query,
      query.selected,
    );
    void reply.header("Cache-Control", "no-store");
    void reply.header("Content-Type", "text/csv; charset=utf-8");
    void reply.header(
      "Content-Disposition",
      'attachment; filename="capital-q-relationships.csv"',
    );
    return reportCsvRows([
      [
        "Counterpart",
        "Relationship state",
        "Since",
        "Next step",
        "Relationship ID",
      ],
      ...rows.map((row) => [
        row.counterpart.name,
        row.state,
        row.stateSince,
        row.nextStep,
        row.relationshipId,
      ]),
    ]);
  };
  app.get(
    `${NETWORK_INVESTOR_PIPELINE_PATH}/export`,
    { onRequest: withContext },
    (request, reply) => exportPipeline(request, reply, false),
  );
  app.get(
    `${NETWORK_COMPANY_PIPELINE_PATH}/export`,
    { onRequest: withContext },
    (request, reply) => exportPipeline(request, reply, true),
  );

  // CRM saved views (2026-10-15): the list read. Saving and deleting are
  // app actions (ADR 0040; @capital-q/app-actions relationship-views).
  const views = service.relationshipViews;
  if (views !== undefined) {
    for (const [listPath, company] of [
      [NETWORK_RELATIONSHIP_VIEWS_PATH, false],
      [NETWORK_COMPANY_RELATIONSHIP_VIEWS_PATH, true],
    ] as const) {
      const party = (request: FastifyRequest) =>
        company ? companyIdOf(request) : undefined;
      app.get(listPath, { onRequest: withContext }, async (request, reply) => {
        void reply.header("Cache-Control", "no-store");
        return SavedRelationshipViewListSchema.parse(
          await views.list(getActorContext(request), party(request)),
        );
      });
    }
  }

  // Each side's own relationships (CQ-WEB-030), each row the per-party fold.
  app.get(
    NETWORK_INVESTOR_RELATIONSHIPS_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const listings = await service.listRelationshipsForInvestor({
        actor: getActorContext(request),
      });
      void reply.header("Cache-Control", "no-store");
      return RelationshipListDtoSchema.parse({
        items: await withCounterpartPhotos(
          listings.map((listing) =>
            toRelationshipSummaryDto(listing, "INVESTOR"),
          ),
        ),
      });
    },
  );
  app.get(
    NETWORK_COMPANY_RELATIONSHIPS_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const listings = await service.listRelationshipsForCompany({
        actor: getActorContext(request),
        companyId: companyIdOf(request),
      });
      void reply.header("Cache-Control", "no-store");
      return RelationshipListDtoSchema.parse({
        items: await withCounterpartPhotos(
          listings.map((listing) =>
            toRelationshipSummaryDto(listing, "COMPANY"),
          ),
        ),
      });
    },
  );

  // The company's inbox (CQ-NET-011).
  app.get(
    NETWORK_COMPANY_INCOMING_INTEREST_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const incoming = await service.listIncomingInterest({
        actor: getActorContext(request),
        companyId: companyIdOf(request),
      });
      void reply.header("Cache-Control", "no-store");
      // The inbox names each investor, so their logo shows with the name.
      const photo = await photoLookup(
        dependencies.namedPhotos,
        incoming.map(({ interest }) => ({
          subjectType: "INVESTOR_ORGANISATION" as const,
          subjectId: interest.investorOrganisationId,
        })),
      );
      return IncomingInterestListDtoSchema.parse({
        items: incoming.map(({ interest, investor }) => ({
          ...toIncomingInterestDto(interest, investor),
          investorPhotoUrl: photo({
            subjectType: "INVESTOR_ORGANISATION",
            subjectId: interest.investorOrganisationId,
          }),
        })),
      });
    },
  );

  // Express Interest, the answers and Connection Requests are generated
  // from the action registry (ADR 0040, http/app-actions.ts).
  const connections = dependencies.connections;
  if (connections === undefined) return;

  app.get(
    NETWORK_INVESTOR_CONNECTION_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const status = await connections.connectionStatus({
        actor: getActorContext(request),
        investorOrganisationId: investorIdOf(request),
      });
      void reply.header("Cache-Control", "no-store");
      return ConnectionStatusDtoSchema.parse({
        canRequest: status.canRequest,
        notAccepted: status.notAccepted,
        request:
          status.request === null
            ? null
            : toConnectionRequestDto(status.request),
      });
    },
  );

  // The investor's inbox and answers.
  app.get(
    NETWORK_CONNECTION_REQUESTS_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const listed = await connections.listConnectionRequests({
        actor: getActorContext(request),
      });
      void reply.header("Cache-Control", "no-store");
      return IncomingConnectionRequestListDtoSchema.parse({
        items: listed.map(({ interest, company }) =>
          toIncomingConnectionRequestDto(interest, company),
        ),
      });
    },
  );
}
