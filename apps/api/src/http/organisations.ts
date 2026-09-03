import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  ActivateOrganisationResponseSchema,
  CreateOrganisationRequestSchema,
  CreateOrganisationResponseSchema,
  IDEMPOTENCY_KEY_HEADER,
  IdempotencyKeyHeaderSchema,
  ListMyOrganisationsQuerySchema,
  ListMyOrganisationsResponseSchema,
  ORGANISATIONS_PATH,
  OrganisationDtoSchema,
  parseContract,
  UpdateOrganisationRequestSchema,
  CorrelationIdSchema,
  type CorrelationId,
  type OrganisationMembershipSummary,
} from "@capital-q/contracts";
import { createCorrelationId } from "@capital-q/observability";
import {
  toOrganisationDto,
  type MembershipView,
  type OrganisationService,
} from "@capital-q/organisations";
import { OrganisationIdSchema, type OrganisationId } from "@capital-q/security";

import {
  getActorContext,
  requireActorContextHook,
  type ActorContextDependencies,
} from "../security/actor-context.js";
import {
  getPrincipal,
  requireAuthenticationHook,
} from "../security/authentication.js";

/**
 * `/v1/organisations`. Thin on purpose: authenticate, resolve the context
 * the operation needs, parse the contract, call the application service,
 * map the result. No organisation rule lives here.
 *
 * Person-scoped operations (create, list, activate) use the authentication
 * hook: a new Person has no organisation yet. Organisation-scoped
 * operations (read, update) use the actor-context hook and fail closed
 * without a resolved context.
 */

export type OrganisationRoutesDependencies = ActorContextDependencies & {
  readonly organisations: OrganisationService;
};

function correlationFor(_request: FastifyRequest): CorrelationId {
  // Inbound correlation headers are not trusted yet; every command gets a
  // fresh workflow id that ties audit, events and logs together.
  return CorrelationIdSchema.parse(createCorrelationId());
}

function organisationIdParam(request: FastifyRequest): OrganisationId {
  const params = request.params as Record<string, unknown>;
  return parseContract(
    OrganisationIdSchema,
    params["organisationId"],
    "The organisation identifier is not valid.",
  );
}

function toSummary(view: MembershipView): OrganisationMembershipSummary {
  return {
    organisation: toOrganisationDto(view.organisation),
    membership: {
      id: view.membership.id,
      status: view.membership.status,
      joinedAt: view.membership.joinedAt,
      roleCodes: [...view.roleCodes],
      isActiveContext: view.isActiveContext,
    },
  };
}

export function registerOrganisationRoutes(
  app: FastifyInstance,
  dependencies: OrganisationRoutesDependencies,
): void {
  const authenticated = requireAuthenticationHook({
    authenticator: dependencies.authenticator,
  });
  const withContext = requireActorContextHook(dependencies);
  const service = dependencies.organisations;

  app.post(
    ORGANISATIONS_PATH,
    { onRequest: authenticated },
    async (request, reply) => {
      const principal = getPrincipal(request);
      const rawKey = request.headers[IDEMPOTENCY_KEY_HEADER];
      const idempotencyKey = parseContract(
        IdempotencyKeyHeaderSchema,
        typeof rawKey === "string" ? rawKey : undefined,
        "An Idempotency-Key header is required to create an organisation.",
      );
      const input = parseContract(
        CreateOrganisationRequestSchema,
        request.body,
        "The organisation request is not valid.",
      );

      const view = await service.createOrganisation({
        principal,
        input,
        idempotencyKey,
        correlationId: correlationFor(request),
      });

      void reply
        .status(201)
        .header("Location", `${ORGANISATIONS_PATH}/${view.organisation.id}`)
        .header("Cache-Control", "no-store");
      return CreateOrganisationResponseSchema.parse(toSummary(view));
    },
  );

  app.get(
    ORGANISATIONS_PATH,
    { onRequest: authenticated },
    async (request, reply) => {
      const principal = getPrincipal(request);
      const query = parseContract(
        ListMyOrganisationsQuerySchema,
        request.query,
        "The list query is not valid.",
      );

      const page = await service.listMyOrganisations({
        principal,
        cursor: query.cursor,
        limit: query.limit,
      });

      void reply.header("Cache-Control", "no-store");
      return ListMyOrganisationsResponseSchema.parse({
        items: page.items.map(toSummary),
        ...(page.nextCursor === undefined
          ? {}
          : { nextCursor: page.nextCursor }),
      });
    },
  );

  app.get(
    `${ORGANISATIONS_PATH}/:organisationId`,
    { onRequest: withContext },
    async (request, reply) => {
      const actor = getActorContext(request);
      const organisation = await service.getOrganisation({
        actor,
        organisationId: organisationIdParam(request),
      });
      void reply.header("Cache-Control", "no-store");
      return OrganisationDtoSchema.parse(toOrganisationDto(organisation));
    },
  );

  app.patch(
    `${ORGANISATIONS_PATH}/:organisationId`,
    { onRequest: withContext },
    async (request, reply) => {
      const actor = getActorContext(request);
      const input = parseContract(
        UpdateOrganisationRequestSchema,
        request.body,
        "The organisation update is not valid.",
      );
      const organisation = await service.updateOrganisation({
        actor,
        organisationId: organisationIdParam(request),
        input,
        correlationId: correlationFor(request),
      });
      void reply.header("Cache-Control", "no-store");
      return OrganisationDtoSchema.parse(toOrganisationDto(organisation));
    },
  );

  app.post(
    `${ORGANISATIONS_PATH}/:organisationId/activate`,
    { onRequest: authenticated },
    async (request, reply) => {
      const principal = getPrincipal(request);
      const activated = await service.activateOrganisation({
        principal,
        organisationId: organisationIdParam(request),
        correlationId: correlationFor(request),
      });
      void reply.header("Cache-Control", "no-store");
      return ActivateOrganisationResponseSchema.parse(
        toSummary(activated.view),
      );
    },
  );
}
