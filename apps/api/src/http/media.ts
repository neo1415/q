import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  COMPANIES_PATH,
  COMPANY_PITCH_SUFFIX,
  CorrelationIdSchema,
  createProblemDetails,
  MEDIA_CAPTIONS_VTT_SUFFIX,
  MEDIA_DOWNLOAD_SUFFIX,
  MEDIA_PLAYBACK_SUFFIX,
  MEDIA_TRANSCRIPT_SUFFIX,
  MEDIA_SYNC_SUFFIX,
  parseContract,
  PitchDownloadDtoSchema,
  PitchTranscriptDtoSchema,
  PlaybackAuthorizationDtoSchema,
  PROBLEM_CONTENT_TYPE,
  SyncMediaAssetRequestSchema,
  SyncMediaAssetResponseSchema,
  UuidSchema,
  type CorrelationId,
  type MediaAssetDto,
  type ProblemDetails,
} from "@capital-q/contracts";
import {
  MediaAssetIdSchema,
  MediaProviderError,
  MediaProviderNotConfiguredError,
  toMediaAssetDto,
  type MediaAsset,
  type MediaAssetId,
  type MediaService,
} from "@capital-q/media";
import { createCorrelationId } from "@capital-q/observability";

import {
  getActorContext,
  requireActorContextHook,
  type ActorContextDependencies,
} from "../security/actor-context.js";

/**
 * `/v1/companies/:companyId/pitch` — a company's pitch media record.
 *
 * These routes create, read and remove the *record*. No bytes pass through
 * the API, and creating an asset is not an upload: the response says
 * CREATED, which is what happened. A founder is never shown a success that
 * did not occur.
 *
 * Nothing a client sends chooses tenancy, ownership, provider, lifecycle
 * state, moderation outcome or playback policy. The path names a company;
 * everything else is the server's decision.
 */

export type MediaRoutesDependencies = ActorContextDependencies & {
  readonly media: MediaService;
};

function correlation(): CorrelationId {
  return CorrelationIdSchema.parse(createCorrelationId());
}

function companyIdParam(request: FastifyRequest): string {
  const params = request.params as Record<string, unknown>;
  return parseContract(
    UuidSchema,
    params["companyId"],
    "The company identifier is not valid.",
  );
}

function mediaAssetIdParam(request: FastifyRequest): MediaAssetId {
  const params = request.params as Record<string, unknown>;
  return parseContract(
    MediaAssetIdSchema,
    params["mediaAssetId"],
    "The media asset identifier is not valid.",
  );
}

function payload(asset: MediaAsset): MediaAssetDto {
  return toMediaAssetDto(asset);
}

/**
 * What a caller is told when the video provider is the reason (CQ-MEDIA-010).
 *
 * Not configured is said plainly, with the variable names an operator must
 * set, because a founder staring at a dead upload button deserves a cause
 * and the names disclose nothing. A provider that answered badly is a
 * closed door with no vendor, host, status or reason code on it: those
 * stay in the server log. Anything else is not this function's to decide.
 */
export function mediaProviderProblem(
  error: unknown,
  requestId: string,
): ProblemDetails | null {
  if (error instanceof MediaProviderNotConfiguredError) {
    return createProblemDetails({
      code: "PROVIDER_UNAVAILABLE",
      requestId,
      detail: `${error.code}: ${error.message}`,
    });
  }
  if (error instanceof MediaProviderError) {
    return createProblemDetails({
      code:
        error.failure === "RATE_LIMITED"
          ? "RATE_LIMITED"
          : "PROVIDER_UNAVAILABLE",
      requestId,
      detail: "The video provider could not complete that. Try again shortly.",
    });
  }
  return null;
}

export function registerMediaRoutes(
  app: FastifyInstance,
  dependencies: MediaRoutesDependencies,
): void {
  // Provider failures are translated here, in the one scope that can
  // raise them; every other error keeps the application's handler.
  const parentErrorHandler = app.errorHandler;
  void app.register((scope, _options, done) => {
    scope.setErrorHandler((error, request, reply) => {
      const problem = mediaProviderProblem(error, request.id);
      if (problem === null) {
        parentErrorHandler(error, request, reply);
        return;
      }
      request.log.warn(
        { err: error, requestId: request.id },
        "video provider refused or failed",
      );
      void reply
        .status(problem.status)
        .type(PROBLEM_CONTENT_TYPE)
        .send(problem);
    });
    registerPitchRoutes(scope, dependencies);
    done();
  });
}

function registerPitchRoutes(
  app: FastifyInstance,
  dependencies: MediaRoutesDependencies,
): void {
  const withContext = requireActorContextHook(dependencies);
  const service = dependencies.media;
  const pitch = `${COMPANIES_PATH}/:companyId${COMPANY_PITCH_SUFFIX}`;

  app.get(pitch, { onRequest: withContext }, async (request, reply) => {
    const actor = getActorContext(request);
    const asset = await service.getCompanyPitch({
      actor,
      companyId: companyIdParam(request),
    });
    return reply
      .header("Cache-Control", "no-store")
      .send({ pitch: asset === null ? null : payload(asset) });
  });

  app.get(
    `${COMPANIES_PATH}/:companyId/media`,
    { onRequest: withContext },
    async (request, reply) => {
      const actor = getActorContext(request);
      const media = await service.listCompanyMedia({
        actor,
        companyId: companyIdParam(request),
      });
      return reply
        .header("Cache-Control", "no-store")
        .send({ media: media.map(payload) });
    },
  );

  // Making a pitch, its upload, cancel, removal and playback policy are
  // generated from the action registry (ADR 0040, http/app-actions.ts),
  // with the video provider's failures mapped as here.

  // The direct upload flow (CQ-MEDIA-011). POSTs on one asset, each
  // answering with a contract DTO that carries no provider identifier: the
  // one-time upload target and the minted playback URL are the only
  // provider-shaped things a client ever sees, and both are the server's
  // to issue.

  // Sync. Idempotent: the same answer however often it is asked, and the
  // lifecycle refuses any move the provider's answer cannot justify.
  app.post(
    `${pitch}/:mediaAssetId${MEDIA_SYNC_SUFFIX}`,
    { onRequest: withContext },
    async (request, reply) => {
      const actor = getActorContext(request);
      parseContract(
        SyncMediaAssetRequestSchema,
        request.body ?? {},
        "The sync request is not valid.",
      );
      const asset = await service.syncMediaAsset({
        actor,
        companyId: companyIdParam(request),
        mediaAssetId: mediaAssetIdParam(request),
        correlationId: correlation(),
      });
      return reply
        .header("Cache-Control", "no-store")
        .send(SyncMediaAssetResponseSchema.parse({ pitch: payload(asset) }));
    },
  );

  // The owner's name for one video and who may watch it (ADR 0021/0022).
  // Widening the audience is a disclosure decision: `media.manage`,
  // versioned, audited, like the playback policy.
  // The pitch's title and who can watch it are declared once in the app's
  // action registry (ADR 0040) and their route is generated from it
  // (http/app-actions.ts), as Q's tool is.

  // Playback. Per viewer, short-lived, decided here every time. A provider
  // UID is not access control, which is why it is not in the answer.
  app.post(
    `${pitch}/:mediaAssetId${MEDIA_PLAYBACK_SUFFIX}`,
    { onRequest: withContext },
    async (request, reply) => {
      const actor = getActorContext(request);
      const grant = await service.authorisePlayback({
        actor,
        companyId: companyIdParam(request),
        mediaAssetId: mediaAssetIdParam(request),
      });
      return reply.header("Cache-Control", "no-store").send(
        PlaybackAuthorizationDtoSchema.parse({
          mediaAssetId: grant.asset.id,
          playbackUrl: grant.authorization.playbackUrl,
          posterUrl: grant.authorization.posterUrl ?? null,
          expiresAt: grant.authorization.expiresAt,
        }),
      );
    },
  );

  // ADR 0047: a short-lived link to the pitch as a file. The playback
  // rule, then the owner's download permission, decided here on every
  // request; every refusal is the same not-found as playback's. The link
  // is the CDN's: the browser fetches the bytes from it, never from us.
  app.get(
    `${pitch}/:mediaAssetId${MEDIA_DOWNLOAD_SUFFIX}`,
    { onRequest: withContext },
    async (request, reply) => {
      const actor = getActorContext(request);
      const answer = await service.authoriseDownload({
        actor,
        companyId: companyIdParam(request),
        mediaAssetId: mediaAssetIdParam(request),
      });
      return reply
        .header("Cache-Control", "no-store")
        .send(PitchDownloadDtoSchema.parse(answer));
    },
  );

  /**
   * The pitch's transcript (R18), under exactly the playback rule. A pitch
   * that is READY but has no transcript yet gets one step of sync started
   * in the background -- after the answer, never holding the request -- so
   * pitches that were READY before transcripts existed catch up when first
   * watched. The answer is always what is stored now.
   */
  const transcriptOf = async (request: FastifyRequest) => {
    const view = await service.getPitchTranscript({
      actor: getActorContext(request),
      companyId: companyIdParam(request),
      mediaAssetId: mediaAssetIdParam(request),
    });
    if (view.status !== "AVAILABLE") {
      void service
        .syncPitchTranscript({
          tenantId: view.tenantId,
          mediaAssetId: view.mediaAssetId,
        })
        .catch((error: unknown) => {
          request.log.warn(
            { err: error, mediaAssetId: view.mediaAssetId },
            "pitch transcript sync did not complete",
          );
        });
    }
    return view;
  };

  app.get(
    `${pitch}/:mediaAssetId${MEDIA_TRANSCRIPT_SUFFIX}`,
    { onRequest: withContext },
    async (request, reply) => {
      const view = await transcriptOf(request);
      return reply.header("Cache-Control", "private, no-store").send(
        PitchTranscriptDtoSchema.parse({
          mediaAssetId: view.mediaAssetId,
          status: view.status,
          language: view.status === "AVAILABLE" ? view.language : null,
          source: view.status === "AVAILABLE" ? "PROVIDER_GENERATED" : null,
          cues: view.status === "AVAILABLE" ? view.cues : [],
        }),
      );
    },
  );

  // The same transcript as WebVTT for the player's <track>. Not available
  // yet is a 404: a track with no captions is simply absent.
  app.get(
    `${pitch}/:mediaAssetId${MEDIA_CAPTIONS_VTT_SUFFIX}`,
    { onRequest: withContext },
    async (request, reply) => {
      const view = await transcriptOf(request);
      if (view.status !== "AVAILABLE") {
        return reply
          .status(404)
          .header("Cache-Control", "private, no-store")
          .type(PROBLEM_CONTENT_TYPE)
          .send(
            createProblemDetails({
              code: "RESOURCE_NOT_FOUND",
              requestId: request.id,
            }),
          );
      }
      return reply
        .header("Cache-Control", "private, no-store")
        .type("text/vtt; charset=utf-8")
        .send(view.vtt);
    },
  );
}
