import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import {
  ClaimHandleRequestSchema,
  CorrelationIdSchema,
  PUBLIC_CARD_CODES_PATH,
  PUBLIC_HANDLES_PATH,
  PublicCardCodeDtoSchema,
  PublicHandleResponseSchema,
  Q_CARD_HANDLE_SEGMENT,
  Q_CARDS_PATH,
  QCardDtoSchema,
  QCardSubjectTypeSchema,
  UpdateQCardRequestSchema,
  UuidSchema,
  parseContract,
  type CorrelationId,
} from "@capital-q/contracts";
import { createCorrelationId } from "@capital-q/observability";
import {
  QCardNotFoundError,
  type PublicIdentityService,
  type QCardSubject,
} from "@capital-q/public-identity";
import type { ApplicationIdentityLookup } from "@capital-q/security/postgres";

import {
  getActorContext,
  requireActorContextHook,
  type ActorContextDependencies,
} from "../security/actor-context.js";

/**
 * Handles and the Q Card (BIZ-004).
 *
 * Two audiences, kept apart the way GateQ keeps them:
 *
 *   /v1/q-cards/...        the organisation's own card: the actor-context
 *                          hook resolves who is acting, the service decides
 *                          (not found outside their organisation;
 *                          handle.manage to change anything)
 *   /v1/public/...         the anonymous reads behind /@handle and the QR
 *                          redirect: an allowlisted projection, never a
 *                          redaction, and one 404 for everything unknown
 *
 * A signed-in Capital Q participant reading a public card additionally
 * sees its network_visible fields; the session is checked here and only
 * decides the audience -- it grants nothing else.
 */

export type QCardRoutesDependencies = ActorContextDependencies & {
  readonly publicIdentity: PublicIdentityService;
  readonly identities: ApplicationIdentityLookup;
};

type SubjectParams = {
  readonly subjectType?: string | undefined;
  readonly subjectId?: string | undefined;
};

function correlation(): CorrelationId {
  return CorrelationIdSchema.parse(createCorrelationId());
}

function subjectOf(request: FastifyRequest): QCardSubject {
  const params = request.params as SubjectParams;
  return {
    subjectType: parseContract(
      QCardSubjectTypeSchema,
      params.subjectType,
      "The profile type is not valid.",
    ),
    subjectId: parseContract(
      UuidSchema,
      params.subjectId,
      "The profile identifier is not valid.",
    ),
  };
}

/** Public reads are never indexed through the API itself. */
function publicHeaders(reply: FastifyReply, cacheable: boolean): void {
  void reply.header("X-Robots-Tag", "noindex, nofollow");
  void reply.header(
    "Cache-Control",
    cacheable ? "public, max-age=60" : "private, no-store",
  );
  void reply.header("Vary", "Authorization");
}

export function registerQCardRoutes(
  app: FastifyInstance,
  dependencies: QCardRoutesDependencies,
): void {
  const withContext = requireActorContextHook(dependencies);
  const service = dependencies.publicIdentity;
  const cardPath = `${Q_CARDS_PATH}/:subjectType/:subjectId`;

  app.get(cardPath, { onRequest: withContext }, async (request, reply) => {
    const card = await service.getCard({
      actor: getActorContext(request),
      subject: subjectOf(request),
    });
    if (card === null) throw new QCardNotFoundError();
    void reply.header("Cache-Control", "no-store");
    return QCardDtoSchema.parse(card);
  });

  // PUT: the desired handle. Claiming the one already held changes nothing,
  // so a retried request is safe by construction.
  app.put(
    `${cardPath}${Q_CARD_HANDLE_SEGMENT}`,
    { onRequest: withContext },
    async (request, reply) => {
      const input = parseContract(
        ClaimHandleRequestSchema,
        request.body,
        "The handle request is not valid.",
      );
      const card = await service.claimHandle({
        actor: getActorContext(request),
        subject: subjectOf(request),
        handle: input.handle,
        correlationId: correlation(),
      });
      void reply.header("Cache-Control", "no-store");
      return QCardDtoSchema.parse(card);
    },
  );

  app.patch(cardPath, { onRequest: withContext }, async (request, reply) => {
    const input = parseContract(
      UpdateQCardRequestSchema,
      request.body,
      "The card update is not valid.",
    );
    const card = await service.updateCard({
      actor: getActorContext(request),
      subject: subjectOf(request),
      input,
      correlationId: correlation(),
    });
    void reply.header("Cache-Control", "no-store");
    return QCardDtoSchema.parse(card);
  });

  /**
   * The anonymous read behind `/@handle`. No `onRequest` hook, deliberately:
   * a session, if present, is verified here and only widens the audience
   * to a signed-in participant. An invalid session is treated as none.
   */
  app.get(`${PUBLIC_HANDLES_PATH}/:handle`, async (request, reply) => {
    const raw = (request.params as { handle?: string }).handle ?? "";
    let participant: boolean;
    try {
      const principal = await dependencies.authenticator.authenticate(request);
      participant =
        principal !== null &&
        (await dependencies.identities.lookup(principal)) !== null;
    } catch {
      participant = false;
    }
    const result = await service.resolveHandle({
      handle: raw,
      audience: participant ? "PARTICIPANT" : "PUBLIC",
    });
    publicHeaders(reply, !participant);
    if (result === null) {
      reply.callNotFound();
      return undefined;
    }
    return PublicHandleResponseSchema.parse(result);
  });

  // The QR hop. Counted (aggregate only) and never cached, so every scan
  // is one count and a revoked code stops working at once.
  app.get(`${PUBLIC_CARD_CODES_PATH}/:code`, async (request, reply) => {
    const code = (request.params as { code?: string }).code ?? "";
    const result = await service.resolveCode(code);
    publicHeaders(reply, false);
    if (result === null) {
      reply.callNotFound();
      return undefined;
    }
    return PublicCardCodeDtoSchema.parse(result);
  });
}
