import { createHash, timingSafeEqual } from "node:crypto";

import type { FastifyInstance, FastifyReply } from "fastify";
import {
  CorrelationIdSchema,
  createProblemDetails,
  INBOUND_EMAIL_ADDRESS_PATH,
  INBOUND_EMAIL_POSTMARK_PATH,
  InboundEmailAddressDtoSchema,
  PROBLEM_CONTENT_TYPE,
  type ProblemDetails,
} from "@capital-q/contracts";
import {
  readPostmarkInbound,
  type InboundEmailService,
} from "@capital-q/integrations";
import { createCorrelationId } from "@capital-q/observability";

import {
  getActorContext,
  requireActorContextHook,
  type ActorContextDependencies,
} from "../security/actor-context.js";

/**
 * Inbound email (Postmark Inbound).
 *
 *   POST /v1/inbound/email/postmark   Postmark's inbound webhook. Its only
 *                                     authority is HTTP basic auth carried in
 *                                     the hook URL, checked in constant time
 *                                     before a byte of the body is parsed.
 *   GET  /v1/me/inbound-email         the person's own Q address (issued on
 *                                     first read). A new one is the declared
 *                                     app action `integrations.inbound_email.rotate`.
 *
 * Everything Postmark delivers was written by a stranger: it is validated
 * (body as `unknown` -> schema), stored append-only and never logged. A
 * delivery for an unknown or revoked address is acknowledged with 200 and
 * dropped, so Postmark does not retry it for hours; nothing about who the
 * address belonged to is said either way.
 */

/**
 * Postmark sends attachments inline as base64 (up to 35 MB per message).
 * Capital Q keeps only their names, types and sizes, so a body past this
 * is refused with 413 rather than buffered; Postmark gives up after its
 * retry schedule.
 */
export const INBOUND_EMAIL_BODY_LIMIT_BYTES = 10 * 1024 * 1024;

export type InboundEmailRoutesDependencies = ActorContextDependencies & {
  readonly inboundEmail: InboundEmailService;
  /**
   * The basic-auth password in the hook URL. Absent: the webhook answers
   * 503 to every delivery and never accepts one unauthenticated.
   */
  readonly webhookSecret: string | undefined;
};

function send(reply: FastifyReply, problem: ProblemDetails) {
  return reply
    .status(problem.status)
    .type(PROBLEM_CONTENT_TYPE)
    .header("Cache-Control", "no-store")
    .send(problem);
}

const digest = (value: string): Buffer =>
  createHash("sha256").update(value, "utf8").digest();

/**
 * The password from `Authorization: Basic base64(user:password)`, compared
 * by digest so the comparison is constant-time whatever the lengths. The
 * user name is not a secret and is not checked.
 */
export function basicAuthMatches(
  header: string | undefined,
  secret: string,
): boolean {
  if (header === undefined || header.length > 2048) return false;
  const match = /^Basic\s+([A-Za-z0-9+/=]+)$/i.exec(header.trim());
  if (match?.[1] === undefined) return false;
  const decoded = Buffer.from(match[1], "base64").toString("utf8");
  const colon = decoded.indexOf(":");
  if (colon < 0) return false;
  return timingSafeEqual(digest(decoded.slice(colon + 1)), digest(secret));
}

export function registerInboundEmailRoutes(
  app: FastifyInstance,
  dependencies: InboundEmailRoutesDependencies,
): void {
  const { inboundEmail } = dependencies;
  const withContext = requireActorContextHook(dependencies);
  const parentErrorHandler = app.errorHandler;

  app.get(
    INBOUND_EMAIL_ADDRESS_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const address = await inboundEmail.addressOf(getActorContext(request));
      return reply
        .header("Cache-Control", "no-store")
        .send(
          InboundEmailAddressDtoSchema.parse(
            address === null
              ? { status: "UNAVAILABLE" }
              : { status: "ACTIVE", address },
          ),
        );
    },
  );

  void app.register((scope, _options, done) => {
    // Raw bytes for this scope only: nothing is parsed before the
    // credentials hold. Every other route keeps the application's parser.
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser(
      "*",
      { parseAs: "buffer", bodyLimit: INBOUND_EMAIL_BODY_LIMIT_BYTES },
      (_request, body, parsed) => {
        parsed(null, body);
      },
    );

    scope.setErrorHandler((error, request, reply) => {
      const code = (error as { code?: unknown }).code;
      if (code === "FST_ERR_CTP_BODY_TOO_LARGE") {
        request.log.warn(
          { requestId: request.id },
          "inbound email refused: body over the limit",
        );
        return send(
          reply,
          createProblemDetails({
            code: "INVALID_REQUEST",
            status: 413,
            requestId: request.id,
            detail: "The delivery is larger than this endpoint accepts.",
          }),
        );
      }
      parentErrorHandler(error, request, reply);
      return reply;
    });

    scope.post(
      INBOUND_EMAIL_POSTMARK_PATH,
      { bodyLimit: INBOUND_EMAIL_BODY_LIMIT_BYTES },
      async (request, reply) => {
        const secret = dependencies.webhookSecret;
        if (
          secret === undefined ||
          secret.length === 0 ||
          !inboundEmail.available
        ) {
          request.log.warn(
            { requestId: request.id },
            "inbound email refused: receiving is not configured",
          );
          return send(
            reply,
            createProblemDetails({
              code: "PROVIDER_UNAVAILABLE",
              requestId: request.id,
              detail: "Inbound email is not configured on this deployment.",
            }),
          );
        }
        if (!basicAuthMatches(request.headers.authorization, secret)) {
          request.log.warn(
            { requestId: request.id },
            "inbound email refused: credentials did not match",
          );
          return send(
            reply.header("WWW-Authenticate", 'Basic realm="inbound-email"'),
            createProblemDetails({
              code: "AUTHENTICATION_REQUIRED",
              requestId: request.id,
              detail: "The delivery could not be authenticated.",
            }),
          );
        }

        const raw = Buffer.isBuffer(request.body)
          ? request.body
          : Buffer.alloc(0);
        let body: unknown;
        try {
          body = JSON.parse(raw.toString("utf8"));
        } catch {
          body = null;
        }
        const email = readPostmarkInbound(body);
        if (email === null) {
          request.log.warn(
            { requestId: request.id },
            "inbound email refused: body is not a Postmark inbound message",
          );
          return send(
            reply,
            createProblemDetails({
              code: "INVALID_REQUEST",
              requestId: request.id,
              detail: "The delivery is not a recognised inbound message.",
            }),
          );
        }

        const correlationId = CorrelationIdSchema.parse(createCorrelationId());
        const outcome = await inboundEmail.receive(email, correlationId);
        // Identifiers and outcome only: never the sender, subject or body.
        request.log.info(
          {
            requestId: request.id,
            correlationId,
            providerMessageId: email.providerMessageId,
            outcome: outcome.outcome,
            ...(outcome.outcome === "STORED"
              ? { inboundEmailId: outcome.inboundEmailId }
              : {}),
            attachments: email.attachments.length,
          },
          "inbound email delivery handled",
        );
        return reply
          .header("Cache-Control", "no-store")
          .send({ received: true });
      },
    );

    done();
  });
}
