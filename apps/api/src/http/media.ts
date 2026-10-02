import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  CancelMediaUploadRequestSchema,
  CancelMediaUploadResponseSchema,
  COMPANIES_PATH,
  COMPANY_PITCH_SUFFIX,
  CorrelationIdSchema,
  CreateCompanyPitchRequestSchema,
  CreateMediaUploadSessionRequestSchema,
  createProblemDetails,
  IDEMPOTENCY_KEY_HEADER,
  IdempotencyKeyHeaderSchema,
  MEDIA_CAPTIONS_VTT_SUFFIX,
  MEDIA_PLAYBACK_POLICY_SUFFIX,
  MEDIA_PLAYBACK_SUFFIX,
  MEDIA_TRANSCRIPT_SUFFIX,
  MEDIA_SYNC_SUFFIX,
  MEDIA_UPLOAD_CANCEL_SUFFIX,
  MEDIA_UPLOAD_SESSION_SUFFIX,
  MediaUploadSessionDtoSchema,
  parseContract,
  PitchTranscriptDtoSchema,
  PlaybackAuthorizationDtoSchema,
  PROBLEM_CONTENT_TYPE,
  SetPitchPlaybackPolicyRequestSchema,
  SetPitchPlaybackPolicyResponseSchema,
  SyncMediaAssetRequestSchema,
  SyncMediaAssetResponseSchema,
  UuidSchema,
  type CorrelationId,
  type MediaAssetDto,
  type ProblemDetails,
} from "@capital-q/contracts";
import {
  DEFAULT_PITCH_DURATION_POLICY,
  MediaAssetIdSchema,
  MediaProviderError,
  MediaProviderNotConfiguredError,
  PREFERRED_PITCH_ASPECT_RATIO,
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

/** Product guidance, served from one place so no client hardcodes it. */
const GUIDANCE = {
  targetMinSeconds: DEFAULT_PITCH_DURATION_POLICY.targetMinSeconds,
  targetMaxSeconds: DEFAULT_PITCH_DURATION_POLICY.targetMaxSeconds,
  hardMaxSeconds: DEFAULT_PITCH_DURATION_POLICY.hardMaxSeconds,
  preferredAspectRatio: PREFERRED_PITCH_ASPECT_RATIO,
} as const;

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

  app.post(pitch, { onRequest: withContext }, async (request, reply) => {
    const actor = getActorContext(request);
    const input = parseContract(
      CreateCompanyPitchRequestSchema,
      request.body ?? {},
      "The pitch request is not valid.",
    );

    // Replacing supersedes the current pitch, so it is consequential and
    // must name the intended change: a retry whose answer was lost then
    // gets the same new asset back rather than a conflict or a second
    // replacement. A first creation may carry one too, for the same reason.
    const rawKey = request.headers[IDEMPOTENCY_KEY_HEADER];
    const idempotencyKey =
      rawKey === undefined && input.replacesMediaAssetId === undefined
        ? undefined
        : parseContract(
            IdempotencyKeyHeaderSchema,
            typeof rawKey === "string" ? rawKey : undefined,
            "An Idempotency-Key header is required to replace a pitch.",
          );

    const result = await service.createCompanyPitch({
      actor,
      companyId: companyIdParam(request),
      ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
      input: {
        ...(input.replacesMediaAssetId === undefined
          ? {}
          : {
              replacesMediaAssetId: MediaAssetIdSchema.parse(
                input.replacesMediaAssetId,
              ),
            }),
      },
      correlationId: correlation(),
    });

    return reply
      .code(result.replayed ? 200 : 201)
      .header("Cache-Control", "no-store")
      .header(
        "Location",
        `${COMPANIES_PATH}/${result.asset.ownerId}${COMPANY_PITCH_SUFFIX}`,
      )
      .send({
        pitch: payload(result.asset),
        replacedMediaAssetId: result.replaced?.id ?? null,
        guidance: GUIDANCE,
      });
  });

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

  // Removing a pitch is consequential: it changes what the company presents
  // and what later projections may show, so it needs its own capability and
  // is audited. The row is not erased; the history stays interpretable.
  app.delete(
    `${pitch}/:mediaAssetId`,
    { onRequest: withContext },
    async (request, reply) => {
      const actor = getActorContext(request);
      const asset = await service.deleteCompanyPitch({
        actor,
        companyId: companyIdParam(request),
        mediaAssetId: mediaAssetIdParam(request),
        correlationId: correlation(),
      });
      return reply
        .header("Cache-Control", "no-store")
        .send({ pitch: payload(asset) });
    },
  );

  // The direct upload flow (CQ-MEDIA-011). POSTs on one asset, each
  // answering with a contract DTO that carries no provider identifier: the
  // one-time upload target and the minted playback URL are the only
  // provider-shaped things a client ever sees, and both are the server's
  // to issue.

  // Reserve. The body names the version the client saw and nothing else:
  // duration allowance, expiry and signed playback are the server's terms.
  app.post(
    `${pitch}/:mediaAssetId${MEDIA_UPLOAD_SESSION_SUFFIX}`,
    { onRequest: withContext },
    async (request, reply) => {
      const actor = getActorContext(request);
      const input = parseContract(
        CreateMediaUploadSessionRequestSchema,
        request.body ?? {},
        "The upload request is not valid.",
      );
      // A client that can resume says how many bytes, and must name the
      // request so a retry can be recognised. Without a length the key is
      // optional and unused: a one-shot target cannot be issued twice.
      const rawKey = request.headers[IDEMPOTENCY_KEY_HEADER];
      const idempotencyKey =
        input.uploadLengthBytes === undefined
          ? undefined
          : parseContract(
              IdempotencyKeyHeaderSchema,
              typeof rawKey === "string" ? rawKey : undefined,
              "An Idempotency-Key header is required for a resumable upload.",
            );
      const result = await service.createUploadSession({
        actor,
        companyId: companyIdParam(request),
        mediaAssetId: mediaAssetIdParam(request),
        expectedVersion: input.expectedVersion,
        ...(input.uploadLengthBytes === undefined
          ? {}
          : { uploadLengthBytes: input.uploadLengthBytes, idempotencyKey }),
        correlationId: correlation(),
      });
      return reply
        .code(result.replayed ? 200 : 201)
        .header("Cache-Control", "no-store")
        .send(
          MediaUploadSessionDtoSchema.parse({
            mediaAssetId: result.asset.id,
            uploadMode: result.session.uploadMode,
            uploadUrl: result.session.uploadUrl,
            expiresAt: result.session.expiresAt,
            maxDurationSeconds: result.maxDurationSeconds,
            ...(result.session.chunkSizeBytes === undefined
              ? {}
              : { chunkSizeBytes: result.session.chunkSizeBytes }),
            pitch: payload(result.asset),
          }),
        );
    },
  );

  // Cancel. The founder stops an unfinished upload: the record says
  // UPLOAD_FAILED and the provider lets go of its target. Idempotent.
  app.post(
    `${pitch}/:mediaAssetId${MEDIA_UPLOAD_CANCEL_SUFFIX}`,
    { onRequest: withContext },
    async (request, reply) => {
      const actor = getActorContext(request);
      parseContract(
        CancelMediaUploadRequestSchema,
        request.body ?? {},
        "The cancel request is not valid.",
      );
      const result = await service.cancelUpload({
        actor,
        companyId: companyIdParam(request),
        mediaAssetId: mediaAssetIdParam(request),
        correlationId: correlation(),
      });
      if (!result.providerReleased) {
        // The record is already honest; the provider's target lapses at
        // its expiry, and a repeat of this call retries the release.
        request.log.warn(
          { requestId: request.id, mediaAssetId: result.asset.id },
          "cancelled upload not yet released by the video provider",
        );
      }
      return reply.header("Cache-Control", "no-store").send(
        CancelMediaUploadResponseSchema.parse({
          pitch: payload(result.asset),
        }),
      );
    },
  );

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

  // The founder's decision on who may be granted playback (CQ-MEDIA-013).
  // Reversible and consequential: `media.manage`, versioned, audited. It
  // opens one gate; discoverability still needs review and visibility.
  app.post(
    `${pitch}/:mediaAssetId${MEDIA_PLAYBACK_POLICY_SUFFIX}`,
    { onRequest: withContext },
    async (request, reply) => {
      const actor = getActorContext(request);
      const input = parseContract(
        SetPitchPlaybackPolicyRequestSchema,
        request.body ?? {},
        "The playback policy request is not valid.",
      );
      const asset = await service.setPitchPlaybackPolicy({
        actor,
        companyId: companyIdParam(request),
        mediaAssetId: mediaAssetIdParam(request),
        playbackPolicy: input.playbackPolicy,
        expectedVersion: input.expectedVersion,
        correlationId: correlation(),
      });
      return reply
        .header("Cache-Control", "no-store")
        .send(
          SetPitchPlaybackPolicyResponseSchema.parse({ pitch: payload(asset) }),
        );
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
