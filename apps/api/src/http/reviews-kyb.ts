import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import {
  createProblemDetails,
  CorrelationIdSchema,
  HumanReviewDtoSchema,
  HumanReviewListDtoSchema,
  HumanReviewRequestSchema,
  IDEMPOTENCY_KEY_HEADER,
  IdempotencyKeyHeaderSchema,
  KYB_PATH,
  KybDtoSchema,
  KybRequestSchema,
  parseContract,
  PROBLEM_CONTENT_TYPE,
  REVIEWS_PATH,
  type CorrelationId,
  type KnownErrorCode,
} from "@capital-q/contracts";
import type { PlatformAdmin } from "@capital-q/platform-admin";
import type { KybService } from "@capital-q/verification";

import {
  getActorContext,
  requireActorContextHook,
  type ActorContextDependencies,
} from "../security/actor-context.js";

/**
 * ADMIN-3: a person asks for a human review (appeals Stage 4, PADL #050),
 * and an organisation submits its business details for verification
 * (manual KYB). Who asks is the server-resolved actor only; nothing in the
 * body names a tenant, an organisation or a person.
 */

export type ReviewsKybRoutesDependencies = ActorContextDependencies & {
  readonly reviews: Pick<PlatformAdmin, "requestReview" | "ownReviews">;
  readonly kyb: KybService;
  readonly newCorrelationId?: (() => CorrelationId) | undefined;
};

function send(
  request: FastifyRequest,
  reply: FastifyReply,
  code: KnownErrorCode,
  detail: string,
) {
  const problem = createProblemDetails({ code, requestId: request.id, detail });
  return reply
    .status(problem.status)
    .type(PROBLEM_CONTENT_TYPE)
    .header("Cache-Control", "no-store")
    .send(problem);
}

function idempotencyKeyOf(request: FastifyRequest, what: string): string {
  const raw = request.headers[IDEMPOTENCY_KEY_HEADER];
  return parseContract(
    IdempotencyKeyHeaderSchema,
    typeof raw === "string" ? raw : undefined,
    `An Idempotency-Key header is required to ${what}.`,
  );
}

export function registerReviewsKybRoutes(
  app: FastifyInstance,
  dependencies: ReviewsKybRoutesDependencies,
): void {
  const withContext = requireActorContextHook(dependencies);
  const correlation =
    dependencies.newCorrelationId ??
    (() => CorrelationIdSchema.parse(`cor_${crypto.randomUUID()}`));

  app.get(REVIEWS_PATH, { onRequest: withContext }, async (request, reply) => {
    const actor = getActorContext(request);
    void reply.header("Cache-Control", "no-store");
    return HumanReviewListDtoSchema.parse({
      rows: await dependencies.reviews.ownReviews(actor.userId),
    });
  });

  app.post(REVIEWS_PATH, { onRequest: withContext }, async (request, reply) => {
    const actor = getActorContext(request);
    const key = idempotencyKeyOf(request, "ask for a review");
    const input = parseContract(
      HumanReviewRequestSchema,
      request.body,
      "Say what you want reviewed and why.",
    );
    const outcome = await dependencies.reviews.requestReview(
      {
        tenantId: actor.tenantId,
        userId: actor.userId,
        organisationId: actor.organisationId,
      },
      {
        subjectType: input.subjectType,
        subjectRef: input.subjectRef ?? null,
        reason: input.reason,
        idempotencyKey: key,
      },
    );
    if (outcome.kind === "TOO_MANY_OPEN") {
      return send(
        request,
        reply,
        "RESOURCE_CONFLICT",
        "You have 5 reviews waiting already. A person will answer those first.",
      );
    }
    if (outcome.kind === "INVALID") {
      return send(
        request,
        reply,
        "VALIDATION_FAILED",
        "Say what you want reviewed and why.",
      );
    }
    void reply
      .status(outcome.kind === "CREATED" ? 201 : 200)
      .header("Cache-Control", "no-store");
    return HumanReviewDtoSchema.parse(outcome.review);
  });

  app.get(KYB_PATH, { onRequest: withContext }, async (request, reply) => {
    const view = await dependencies.kyb.current(getActorContext(request));
    if (view === null) {
      return send(
        request,
        reply,
        "PERMISSION_DENIED",
        "Choose your organisation first.",
      );
    }
    void reply.header("Cache-Control", "no-store");
    return KybDtoSchema.parse(view);
  });

  app.post(KYB_PATH, { onRequest: withContext }, async (request, reply) => {
    const key = idempotencyKeyOf(request, "submit your business details");
    const input = parseContract(
      KybRequestSchema,
      request.body,
      "Check your business details and try again.",
    );
    const outcome = await dependencies.kyb.submit({
      actor: getActorContext(request),
      input: {
        legalName: input.legalName,
        registrationNumber: input.registrationNumber,
        jurisdictionCode: input.jurisdictionCode,
        registeredAddress: input.registeredAddress ?? null,
        websiteUrl: input.websiteUrl ?? null,
        documentId: input.documentId ?? null,
      },
      idempotencyKey: key,
      correlationId: correlation(),
    });
    switch (outcome.kind) {
      case "SUBMITTED":
      case "REPLAYED":
        void reply
          .status(outcome.kind === "SUBMITTED" ? 201 : 200)
          .header("Cache-Control", "no-store");
        return KybDtoSchema.parse(outcome.view);
      case "ALREADY_OPEN":
        return send(
          request,
          reply,
          "RESOURCE_CONFLICT",
          "Your business details are already with Capital Q.",
        );
      case "ALREADY_VERIFIED":
        return send(
          request,
          reply,
          "RESOURCE_CONFLICT",
          "Your organisation is already verified.",
        );
      case "DOCUMENT_NOT_FOUND":
        return send(
          request,
          reply,
          "VALIDATION_FAILED",
          "That document isn't one of your organisation's uploads.",
        );
      case "NO_ORGANISATION":
        return send(
          request,
          reply,
          "PERMISSION_DENIED",
          "Choose your organisation first.",
        );
    }
  });
}
