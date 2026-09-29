import type { FastifyInstance, FastifyRequest } from "fastify";

import {
  CompanyInterestStatusDtoSchema,
  ConnectionRequestAnswerDtoSchema,
  ConnectionRequestRequestSchema,
  ConnectionRequestResultDtoSchema,
  ConnectionStatusDtoSchema,
  IncomingConnectionRequestListDtoSchema,
  NETWORK_CONNECTION_REQUEST_ACCEPT_PATH,
  NETWORK_CONNECTION_REQUEST_DECLINE_PATH,
  NETWORK_CONNECTION_REQUESTS_PATH,
  NETWORK_INVESTOR_CONNECTION_PATH,
  NETWORK_INVESTOR_CONNECTION_REQUEST_PATH,
  CorrelationIdSchema,
  ExpressInterestRequestSchema,
  ExpressInterestResultDtoSchema,
  IDEMPOTENCY_KEY_HEADER,
  IdempotencyKeyHeaderSchema,
  IncomingInterestListDtoSchema,
  InterestResponseResultDtoSchema,
  NETWORK_COMPANY_EXPRESS_INTEREST_PATH,
  NETWORK_COMPANY_INCOMING_INTEREST_PATH,
  NETWORK_COMPANY_INTEREST_PATH,
  NETWORK_COMPANY_RELATIONSHIP_PATH,
  NETWORK_INTEREST_ACCEPT_PATH,
  NETWORK_INTEREST_DECLINE_PATH,
  NETWORK_INVESTOR_RELATIONSHIP_PATH,
  NETWORK_INVESTOR_RELATIONSHIPS_PATH,
  NETWORK_COMPANY_RELATIONSHIPS_PATH,
  RelationshipListDtoSchema,
  parseContract,
  RelationshipStatusResponseDtoSchema,
  RespondToInterestRequestSchema,
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
} from "@capital-q/network";
import { createCorrelationId } from "@capital-q/observability";

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

function interestIdOf(request: FastifyRequest): string {
  const raw = (request.params as { interestId?: unknown }).interestId;
  return typeof raw === "string" ? raw : "";
}

function idempotencyKeyOf(request: FastifyRequest): string {
  const rawKey = request.headers[IDEMPOTENCY_KEY_HEADER];
  return parseContract(
    IdempotencyKeyHeaderSchema,
    typeof rawKey === "string" ? rawKey : undefined,
    "An Idempotency-Key header is required to answer an interest.",
  );
}

export function registerNetworkInterestRoutes(
  app: FastifyInstance,
  dependencies: NetworkInterestRoutesDependencies,
): void {
  const withContext = requireActorContextHook(dependencies);
  const service = dependencies.interests;

  app.post(
    NETWORK_COMPANY_EXPRESS_INTEREST_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const rawKey = request.headers[IDEMPOTENCY_KEY_HEADER];
      const idempotencyKey = parseContract(
        IdempotencyKeyHeaderSchema,
        typeof rawKey === "string" ? rawKey : undefined,
        "An Idempotency-Key header is required to express interest.",
      );
      const input = parseContract(
        ExpressInterestRequestSchema,
        request.body,
        "The interest request is not valid.",
      );

      const result = await service.expressInterest({
        actor: getActorContext(request),
        companyId: companyIdOf(request),
        surface: input.surface,
        idempotencyKey,
        correlationId: CorrelationIdSchema.parse(createCorrelationId()),
      });

      void reply
        .status(result.deduplicated ? 200 : 201)
        .header("Cache-Control", "no-store");
      return ExpressInterestResultDtoSchema.parse({
        interest: toInterestDto(result.interest),
        deduplicated: result.deduplicated,
      });
    },
  );

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

  // The company's answer: the verb is the path, never a body field.
  for (const [path, decision] of [
    [NETWORK_INTEREST_ACCEPT_PATH, "ACCEPTED"],
    [NETWORK_INTEREST_DECLINE_PATH, "DECLINED"],
  ] as const) {
    app.post(path, { onRequest: withContext }, async (request, reply) => {
      const idempotencyKey = idempotencyKeyOf(request);
      parseContract(
        RespondToInterestRequestSchema,
        request.body ?? {},
        "An answer carries no body.",
      );
      const result = await service.respondToInterest({
        actor: getActorContext(request),
        interestId: interestIdOf(request),
        decision,
        surface: "INBOX",
        idempotencyKey,
        correlationId: CorrelationIdSchema.parse(createCorrelationId()),
      });
      void reply
        .status(result.deduplicated ? 200 : 201)
        .header("Cache-Control", "no-store");
      return InterestResponseResultDtoSchema.parse({
        interest: toIncomingInterestDto(result.interest, result.investor),
        deduplicated: result.deduplicated,
      });
    });
  }

  const connections = dependencies.connections;
  if (connections === undefined) return;

  // A founder's Connection Request (ADR 0023): server-confirmed, idempotent.
  app.post(
    NETWORK_INVESTOR_CONNECTION_REQUEST_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const rawKey = request.headers[IDEMPOTENCY_KEY_HEADER];
      const idempotencyKey = parseContract(
        IdempotencyKeyHeaderSchema,
        typeof rawKey === "string" ? rawKey : undefined,
        "An Idempotency-Key header is required to send a request.",
      );
      parseContract(
        ConnectionRequestRequestSchema,
        request.body ?? {},
        "A connection request carries no body.",
      );
      const result = await connections.requestConnection({
        actor: getActorContext(request),
        investorOrganisationId: investorIdOf(request),
        idempotencyKey,
        correlationId: CorrelationIdSchema.parse(createCorrelationId()),
      });
      void reply
        .status(result.deduplicated ? 200 : 201)
        .header("Cache-Control", "no-store");
      return ConnectionRequestResultDtoSchema.parse({
        request: toConnectionRequestDto(result.interest),
        deduplicated: result.deduplicated,
      });
    },
  );

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

  for (const [path, decision] of [
    [NETWORK_CONNECTION_REQUEST_ACCEPT_PATH, "ACCEPTED"],
    [NETWORK_CONNECTION_REQUEST_DECLINE_PATH, "DECLINED"],
  ] as const) {
    app.post(path, { onRequest: withContext }, async (request, reply) => {
      const idempotencyKey = idempotencyKeyOf(request);
      parseContract(
        RespondToInterestRequestSchema,
        request.body ?? {},
        "An answer carries no body.",
      );
      const result = await connections.respondToConnectionRequest({
        actor: getActorContext(request),
        interestId: interestIdOf(request),
        decision,
        surface: "INBOX",
        idempotencyKey,
        correlationId: CorrelationIdSchema.parse(createCorrelationId()),
      });
      void reply
        .status(result.deduplicated ? 200 : 201)
        .header("Cache-Control", "no-store");
      return ConnectionRequestAnswerDtoSchema.parse({
        request: toIncomingConnectionRequestDto(
          result.interest,
          result.company,
        ),
        deduplicated: result.deduplicated,
      });
    });
  }
}
