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
  NETWORK_RELATIONSHIP_PASS_PATH,
  PassReasonListDtoSchema,
  RelationshipListDtoSchema,
  RelationshipPassResponseDtoSchema,
  RelationshipStatusResponseDtoSchema,
} from "@capital-q/contracts";
import {
  toConnectionRequestDto,
  toIncomingConnectionRequestDto,
  toIncomingInterestDto,
  toInterestDto,
  toRelationshipStatusDto,
  toRelationshipSummaryDto,
  type ConnectionService,
  type InterestService,
  type RelationshipOutcomeService,
} from "@capital-q/network";

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
        items: listings.map((listing) =>
          toRelationshipSummaryDto(listing, "INVESTOR"),
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
        items: listings.map((listing) =>
          toRelationshipSummaryDto(listing, "COMPANY"),
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
      return IncomingInterestListDtoSchema.parse({
        items: incoming.map(({ interest, investor }) =>
          toIncomingInterestDto(interest, investor),
        ),
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
