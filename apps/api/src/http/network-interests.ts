import type { FastifyInstance, FastifyRequest } from "fastify";

import {
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
  NETWORK_RELATIONSHIP_DILIGENCE_PATH,
  RelationshipBriefSchema,
  NETWORK_DILIGENCE_DOWNLOAD_PATH,
  DiligenceDtoSchema,
  DiligenceDownloadDtoSchema,
  NETWORK_RELATIONSHIP_PASS_PATH,
  PassReasonListDtoSchema,
  RelationshipListDtoSchema,
  RelationshipPassResponseDtoSchema,
  RelationshipStatusResponseDtoSchema,
  type RelationshipSummaryDto,
} from "@capital-q/contracts";
import {
  InterestNotFoundError,
  toConnectionRequestDto,
  toIncomingConnectionRequestDto,
  toIncomingInterestDto,
  toInterestDto,
  toRelationshipStatusDto,
  toRelationshipSummaryDto,
  type ConnectionService,
  type InterestService,
  type RelationshipBriefSources,
  type RelationshipOutcomeService,
} from "@capital-q/network";
import type { DiligenceService } from "@capital-q/permissions";

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
