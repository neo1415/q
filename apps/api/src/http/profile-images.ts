import type { FastifyInstance, FastifyRequest } from "fastify";

import {
  PROFILE_IMAGES_PATH,
  ProfileImagesDtoSchema,
  ProfileImageSubjectTypeSchema,
  UuidSchema,
  parseContract,
} from "@capital-q/contracts";
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

  // Requesting, completing and removing an image are generated from the
  // action registry (ADR 0040, http/app-actions.ts).
}
