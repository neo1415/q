import type { FastifyInstance, FastifyReply } from "fastify";
import {
  CorrelationIdSchema,
  createProblemDetails,
  PROBLEM_CONTENT_TYPE,
  type ProblemDetails,
} from "@capital-q/contracts";
import {
  CLOUDFLARE_STREAM_WEBHOOK_SIGNATURE_HEADER,
  readCloudflareStreamWebhook,
  verifyCloudflareStreamWebhookSignature,
  type MediaService,
} from "@capital-q/media";
import { createCorrelationId } from "@capital-q/observability";

/**
 * `POST /v1/webhooks/cloudflare-stream` — provider status deliveries
 * (CQ-MEDIA-012; doc 20 §16–§17, doc 22 §129–§135).
 *
 * The only route in the API whose caller is a vendor rather than a person,
 * and so the only one whose authority is a signature. The pipeline is
 *
 *   raw bytes → signature over those bytes, within the replay window
 *             → parse (unknown → schema) → adapter normalisation
 *             → Media's trusted use case → row lock → lifecycle → outbox
 *
 * and nothing is read, parsed or looked up before the signature holds. The
 * work behind it is one short transaction of database writes — no vendor
 * call, no model, no email — so the delivery is applied in the request and
 * acknowledged when it is durable, and a failure leaves Cloudflare to retry.
 *
 * Idempotency is the lifecycle's, not a receipt table's: a duplicate or a
 * late delivery finds the row already past it and changes nothing. That is
 * a deliberate simplification of doc 22 §133's inbox; see the packet notes.
 *
 * What is logged is outcome and identifiers — never the secret, the
 * signature, or the body.
 */

export const CLOUDFLARE_STREAM_WEBHOOK_PATH =
  "/v1/webhooks/cloudflare-stream" as const;

/** A Stream video description is a few kilobytes; nothing honest is larger. */
export const WEBHOOK_BODY_LIMIT_BYTES = 64 * 1024;

export type MediaWebhookRoutesDependencies = {
  readonly media: Pick<MediaService, "applyProviderStatusReport">;
  /**
   * The signing secret Cloudflare issued at registration. Absent means the
   * route is unconfigured: every delivery is refused with 503, and none is
   * ever accepted unsigned.
   */
  readonly cloudflareStreamWebhookSecret: string | undefined;
  /** Test seam for the replay window. */
  readonly now?: (() => Date) | undefined;
};

function send(reply: FastifyReply, problem: ProblemDetails) {
  return reply
    .status(problem.status)
    .type(PROBLEM_CONTENT_TYPE)
    .header("Cache-Control", "no-store")
    .send(problem);
}

export function registerMediaWebhookRoutes(
  app: FastifyInstance,
  dependencies: MediaWebhookRoutesDependencies,
): void {
  const parentErrorHandler = app.errorHandler;

  void app.register((scope, _options, done) => {
    // Raw bytes for this scope only. The signature is over exactly what was
    // sent; a parsed-and-reserialised body is a different message. Every
    // other route keeps the application's JSON parser.
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser(
      "*",
      { parseAs: "buffer", bodyLimit: WEBHOOK_BODY_LIMIT_BYTES },
      (_request, body, parsed) => {
        parsed(null, body);
      },
    );

    scope.setErrorHandler((error, request, reply) => {
      const code = (error as { code?: unknown }).code;
      if (code === "FST_ERR_CTP_BODY_TOO_LARGE") {
        request.log.warn(
          { requestId: request.id },
          "provider webhook refused: body over the limit",
        );
        return send(
          reply,
          createProblemDetails({
            code: "INVALID_REQUEST",
            status: 413,
            requestId: request.id,
            detail: "The delivery is larger than any this endpoint accepts.",
          }),
        );
      }
      parentErrorHandler(error, request, reply);
      return reply;
    });

    scope.post(
      CLOUDFLARE_STREAM_WEBHOOK_PATH,
      { bodyLimit: WEBHOOK_BODY_LIMIT_BYTES },
      async (request, reply) => {
        const secret = dependencies.cloudflareStreamWebhookSecret;
        if (secret === undefined || secret.length === 0) {
          request.log.warn(
            { requestId: request.id },
            "provider webhook refused: no signing secret is configured",
          );
          return send(
            reply,
            createProblemDetails({
              code: "PROVIDER_UNAVAILABLE",
              requestId: request.id,
              detail:
                "Provider webhooks are not configured on this deployment.",
            }),
          );
        }

        const rawBody = Buffer.isBuffer(request.body)
          ? request.body
          : Buffer.alloc(0);
        const verdict = verifyCloudflareStreamWebhookSignature({
          header: request.headers[CLOUDFLARE_STREAM_WEBHOOK_SIGNATURE_HEADER],
          rawBody,
          secret,
          now: dependencies.now?.(),
        });
        if (!verdict.ok) {
          // The reason is for the operator. The caller learns only that the
          // delivery was not accepted — nothing that helps forge the next.
          request.log.warn(
            { requestId: request.id, reason: verdict.reason },
            "provider webhook refused: signature not verified",
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

        const reading = readCloudflareStreamWebhook(rawBody);
        if (reading.kind === "MALFORMED") {
          request.log.warn(
            { requestId: request.id },
            "provider webhook refused: signed body is not a Stream video",
          );
          return send(
            reply,
            createProblemDetails({
              code: "INVALID_REQUEST",
              requestId: request.id,
              detail: "The delivery is not a recognised video status.",
            }),
          );
        }
        if (reading.kind === "UNRECOGNISED_STATE") {
          // Acknowledged, not applied: retrying cannot teach this build a
          // vendor state it does not know, and guessing would corrupt the
          // lifecycle. The founder's poll refuses the same state loudly.
          request.log.warn(
            {
              requestId: request.id,
              providerAssetId: reading.providerAssetId,
              providerState: reading.state,
            },
            "provider webhook ignored: unrecognised provider state",
          );
          return reply.header("Cache-Control", "no-store").send({
            received: true,
          });
        }

        const correlationId = CorrelationIdSchema.parse(createCorrelationId());
        const outcome = await dependencies.media.applyProviderStatusReport({
          provider: "CLOUDFLARE_STREAM",
          report: reading.report,
          mediaAssetId: reading.mediaAssetId,
          correlationId,
        });

        switch (outcome.kind) {
          case "APPLIED":
            request.log.info(
              {
                requestId: request.id,
                correlationId,
                mediaAssetId: outcome.mediaAssetId,
                status: outcome.status,
                appliedTransitions: outcome.appliedTransitions,
                metadataUpdated: outcome.metadataUpdated,
              },
              "provider webhook applied",
            );
            break;
          case "UNCHANGED":
            request.log.info(
              {
                requestId: request.id,
                mediaAssetId: outcome.mediaAssetId,
                status: outcome.status,
                stale: outcome.stale,
              },
              "provider webhook changed nothing",
            );
            break;
          case "UNKNOWN_ASSET":
            // 2xx on purpose: an identifier that names nothing of ours will
            // never start to, and a 4xx would have the vendor retry it for
            // days. The line is enough to notice a misrouted account.
            request.log.info(
              {
                requestId: request.id,
                providerAssetId: reading.report.providerAssetId,
              },
              "provider webhook ignored: no media asset holds this provider id",
            );
            break;
          case "REFERENCE_MISMATCH":
            request.log.warn(
              {
                requestId: request.id,
                mediaAssetId: outcome.mediaAssetId,
                providerAssetId: reading.report.providerAssetId,
              },
              "provider webhook ignored: provider reference names a different asset",
            );
            break;
        }

        return reply.header("Cache-Control", "no-store").send({
          received: true,
        });
      },
    );

    done();
  });
}
