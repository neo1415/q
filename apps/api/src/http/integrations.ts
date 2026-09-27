import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  createProblemDetails,
  GOOGLE_CONNECT_PATH,
  GOOGLE_GMAIL_PUSH_PATH,
  GOOGLE_INTEGRATION_PATH,
  GOOGLE_OAUTH_CALLBACK_PATH,
  GOOGLE_RELATIONSHIP_MAIL_PATH,
  GoogleConnectionDtoSchema,
  parseContract,
  PROBLEM_CONTENT_TYPE,
  RelationshipMailListSchema,
  StartGoogleConnectRequestSchema,
  StartGoogleConnectResponseSchema,
  UuidSchema,
  type ProblemDetails,
} from "@capital-q/contracts";
import {
  decodeGmailNotification,
  PushTokenError,
  verifyGooglePushToken,
  type GoogleKeySource,
  type IntegrationsService,
} from "@capital-q/integrations";
import { createCorrelationId } from "@capital-q/observability";

import {
  getActorContext,
  requireActorContextHook,
  type ActorContextDependencies,
} from "../security/actor-context.js";

/**
 * `/v1/integrations/google` — a person's own connected Gmail (BIZ-007).
 *
 *   GET    /v1/integrations/google            own connection status
 *   POST   /v1/integrations/google/connect    start OAuth (PKCE + state)
 *   GET    /v1/integrations/google/callback   Google's redirect; the state
 *                                             is the only authority here
 *   DELETE /v1/integrations/google            revoke and forget
 *   GET    /v1/integrations/google/relationships/:id/mail   own mail on it
 *   POST   /v1/integrations/google/gmail-push Pub/Sub push; authority is
 *                                             Google's OIDC token for our
 *                                             audience and push account
 *
 * No route returns or accepts a token. The callback redirects the browser
 * to the web app with an outcome word and nothing else.
 */

export type IntegrationRoutesDependencies = ActorContextDependencies & {
  readonly integrations: IntegrationsService;
  /** Where the browser lands after the OAuth callback. */
  readonly webOrigin: string;
  /** Pub/Sub push verification; absent: the push route answers 503. */
  readonly push:
    | {
        readonly audience: string;
        readonly serviceAccountEmail: string;
        readonly keys: GoogleKeySource;
      }
    | undefined;
};

function send(reply: FastifyReply, problem: ProblemDetails) {
  return reply
    .status(problem.status)
    .type(PROBLEM_CONTENT_TYPE)
    .header("Cache-Control", "no-store")
    .send(problem);
}

function unavailable(request: FastifyRequest) {
  return createProblemDetails({
    code: "PROVIDER_UNAVAILABLE",
    requestId: request.id,
    detail: "Gmail isn't connected on this deployment yet.",
  });
}

function queryValue(request: FastifyRequest, name: string): string | undefined {
  const value = (request.query as Record<string, unknown> | undefined)?.[name];
  return typeof value === "string" && value.length <= 2048 ? value : undefined;
}

export function registerIntegrationRoutes(
  app: FastifyInstance,
  dependencies: IntegrationRoutesDependencies,
): void {
  const withContext = requireActorContextHook(dependencies);
  const { integrations } = dependencies;

  app.get(
    GOOGLE_INTEGRATION_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const actor = getActorContext(request);
      return reply
        .header("Cache-Control", "no-store")
        .send(
          GoogleConnectionDtoSchema.parse(
            await integrations.status(actor.userId),
          ),
        );
    },
  );

  app.post(
    GOOGLE_CONNECT_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      if (!integrations.available) return send(reply, unavailable(request));
      const input = parseContract(
        StartGoogleConnectRequestSchema,
        request.body ?? {},
        "The connect request is not valid.",
      );
      const actor = getActorContext(request);
      const started = await integrations.startConnect({
        tenantId: actor.tenantId,
        userId: actor.userId,
        returnTo: input.returnTo,
      });
      return reply
        .header("Cache-Control", "no-store")
        .send(StartGoogleConnectResponseSchema.parse(started));
    },
  );

  // The browser arrives from Google. No session header travels on a
  // top-level redirect; the one-time state binds this to the person who
  // started it, and is consumed before anything else happens.
  app.get(GOOGLE_OAUTH_CALLBACK_PATH, async (request, reply) => {
    if (!integrations.available) return send(reply, unavailable(request));
    const outcome = await integrations.completeConnect({
      state: queryValue(request, "state"),
      code: queryValue(request, "code"),
      error: queryValue(request, "error"),
    });
    const target = new URL(outcome.returnTo, dependencies.webOrigin);
    target.searchParams.set("google", outcome.outcome.toLowerCase());
    return reply
      .header("Cache-Control", "no-store")
      .header("Referrer-Policy", "no-referrer")
      .redirect(target.toString(), 303);
  });

  app.delete(
    GOOGLE_INTEGRATION_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      if (!integrations.available) return send(reply, unavailable(request));
      await integrations.disconnect(getActorContext(request).userId);
      return reply.status(204).header("Cache-Control", "no-store").send();
    },
  );

  app.get(
    GOOGLE_RELATIONSHIP_MAIL_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const relationshipId = parseContract(
        UuidSchema,
        (request.params as Record<string, unknown>)["relationshipId"],
        "The relationship identifier is not valid.",
      );
      const items = await integrations.listRelationshipMail(
        getActorContext(request).userId,
        relationshipId,
      );
      return reply
        .header("Cache-Control", "no-store")
        .send(RelationshipMailListSchema.parse({ items }));
    },
  );

  app.post(
    GOOGLE_GMAIL_PUSH_PATH,
    { bodyLimit: 16 * 1024 },
    async (request, reply) => {
      const push = dependencies.push;
      if (push === undefined || !integrations.available) {
        return send(reply, unavailable(request));
      }
      const header = request.headers.authorization;
      const token =
        typeof header === "string" && header.startsWith("Bearer ")
          ? header.slice("Bearer ".length).trim()
          : "";
      try {
        await verifyGooglePushToken(token, {
          audience: push.audience,
          serviceAccountEmail: push.serviceAccountEmail,
          keys: push.keys,
        });
      } catch (error: unknown) {
        request.log.warn(
          {
            requestId: request.id,
            reason: error instanceof PushTokenError ? error.reason : "ERROR",
          },
          "gmail push refused: token not verified",
        );
        return send(
          reply,
          createProblemDetails({
            code: "AUTHENTICATION_REQUIRED",
            requestId: request.id,
            detail: "The delivery could not be verified.",
          }),
        );
      }
      const notification = decodeGmailNotification(request.body);
      if (notification === null) {
        // Acknowledged: a retry cannot make a malformed message readable.
        request.log.warn(
          { requestId: request.id },
          "gmail push not a Gmail notification",
        );
        return reply.status(204).send();
      }
      try {
        const replies = await integrations.handlePush(
          notification,
          createCorrelationId(),
        );
        request.log.info(
          { requestId: request.id, replies },
          "gmail push applied",
        );
        return reply.status(204).send();
      } catch {
        // Not acknowledged: Pub/Sub retries, and the poller catches up anyway.
        request.log.warn({ requestId: request.id }, "gmail push sync failed");
        return send(
          reply,
          createProblemDetails({
            code: "PROVIDER_UNAVAILABLE",
            requestId: request.id,
            detail: "The mailbox could not be read right now.",
          }),
        );
      }
    },
  );
}
