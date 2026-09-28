import type { FastifyInstance, FastifyRequest } from "fastify";

import {
  CorrelationIdSchema,
  CreateProfileImageUploadRequestSchema,
  PROFILE_IMAGE_COMPLETE_SEGMENT,
  PROFILE_IMAGE_UPLOADS_SEGMENT,
  PROFILE_IMAGES_PATH,
  ProfileImageKindSchema,
  ProfileImagesDtoSchema,
  ProfileImageSubjectTypeSchema,
  ProfileImageUploadDtoSchema,
  UuidSchema,
  parseContract,
  type CorrelationId,
} from "@capital-q/contracts";
import { createCorrelationId } from "@capital-q/observability";
import type {
  ProfileImageService,
  ProfileImageSubject,
} from "@capital-q/public-identity";

import {
  getActorContext,
  requireActorContextHook,
  type ActorContextDependencies,
} from "../security/actor-context.js";

/**
 * Profile photos and covers (founder directive 2026-09-28, item 15).
 *
 *   GET    /v1/profile-images/:subjectType/:subjectId              current images (signed URLs)
 *   POST   /v1/profile-images/:subjectType/:subjectId/:kind/uploads  one signed direct upload
 *   POST   /v1/profile-images/uploads/:uploadId/complete           re-encode, make current
 *   DELETE /v1/profile-images/:subjectType/:subjectId/:kind        remove (history kept)
 *
 * The bytes never reach this process from a browser: the upload URL
 * points at storage. The service decides who may act; every response is
 * `no-store` because it carries short-lived signed URLs.
 */

export type ProfileImageRoutesDependencies = ActorContextDependencies & {
  readonly profileImages: ProfileImageService;
};

function correlation(): CorrelationId {
  return CorrelationIdSchema.parse(createCorrelationId());
}

function subjectOf(request: FastifyRequest): ProfileImageSubject {
  const params = request.params as {
    readonly subjectType?: string;
    readonly subjectId?: string;
  };
  return {
    subjectType: parseContract(
      ProfileImageSubjectTypeSchema,
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

function kindOf(request: FastifyRequest) {
  return parseContract(
    ProfileImageKindSchema,
    (request.params as { readonly kind?: string }).kind,
    "The image kind is not valid.",
  );
}

export function registerProfileImageRoutes(
  app: FastifyInstance,
  dependencies: ProfileImageRoutesDependencies,
): void {
  const withContext = requireActorContextHook(dependencies);
  const service = dependencies.profileImages;
  const subjectPath = `${PROFILE_IMAGES_PATH}/:subjectType/:subjectId`;

  app.get(subjectPath, { onRequest: withContext }, async (request, reply) => {
    const images = await service.read({
      actor: getActorContext(request),
      subject: subjectOf(request),
    });
    void reply.header("Cache-Control", "no-store");
    return ProfileImagesDtoSchema.parse(images);
  });

  app.post(
    `${subjectPath}/:kind${PROFILE_IMAGE_UPLOADS_SEGMENT}`,
    { onRequest: withContext },
    async (request, reply) => {
      const input = parseContract(
        CreateProfileImageUploadRequestSchema,
        request.body,
        "The image upload request is not valid.",
      );
      const upload = await service.requestUpload({
        actor: getActorContext(request),
        subject: subjectOf(request),
        kind: kindOf(request),
        request: input,
      });
      void reply.header("Cache-Control", "no-store");
      void reply.code(201);
      return ProfileImageUploadDtoSchema.parse(upload);
    },
  );

  // Completing is idempotent by construction: a retried completion of an
  // image that already went through answers with the current images.
  app.post(
    `${PROFILE_IMAGES_PATH}${PROFILE_IMAGE_UPLOADS_SEGMENT}/:uploadId${PROFILE_IMAGE_COMPLETE_SEGMENT}`,
    { onRequest: withContext },
    async (request, reply) => {
      const uploadId = parseContract(
        UuidSchema,
        (request.params as { readonly uploadId?: string }).uploadId,
        "The upload identifier is not valid.",
      );
      const images = await service.completeUpload({
        actor: getActorContext(request),
        uploadId,
        correlationId: correlation(),
      });
      void reply.header("Cache-Control", "no-store");
      return ProfileImagesDtoSchema.parse(images);
    },
  );

  app.delete(
    `${subjectPath}/:kind`,
    { onRequest: withContext },
    async (request, reply) => {
      const images = await service.remove({
        actor: getActorContext(request),
        subject: subjectOf(request),
        kind: kindOf(request),
        correlationId: correlation(),
      });
      void reply.header("Cache-Control", "no-store");
      return ProfileImagesDtoSchema.parse(images);
    },
  );
}
