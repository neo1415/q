import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  COMPANIES_PATH,
  COMPANY_PITCH_SUFFIX,
  CorrelationIdSchema,
  CreateCompanyPitchRequestSchema,
  parseContract,
  UuidSchema,
  type CorrelationId,
  type MediaAssetDto,
} from "@capital-q/contracts";
import {
  DEFAULT_PITCH_DURATION_POLICY,
  MediaAssetIdSchema,
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

export function registerMediaRoutes(
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

    const result = await service.createCompanyPitch({
      actor,
      companyId: companyIdParam(request),
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
      .code(201)
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
}
