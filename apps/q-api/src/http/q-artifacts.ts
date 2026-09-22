import type { ApplicationIdentityLookup } from "@capital-q/security/postgres";
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  ListQArtifactsQuerySchema,
  ListQArtifactsResponseSchema,
  parseContract,
  Q_ARTIFACT_VERSIONS_SUFFIX,
  Q_ARTIFACTS_PATH,
  QArtifactDetailSchema,
  UuidSchema,
} from "@capital-q/contracts";
import {
  ArtifactNotFoundError,
  type ArtifactService,
} from "@capital-q/q-artifacts";

import {
  getActorContext,
  requireActorContextHook,
  requireActorContextOrPersonalHook,
  type ActorContextDependencies,
} from "../security/actor-context.js";

/**
 * `/v1/q/artifacts` — reading what Q composed (QX-003E).
 *
 * Read-only, and deliberately so. Nothing here creates or revises an
 * artifact: that happens inside a Q run, through the answer seam, under
 * the run's own authorised plan (ADR 0013). A POST here would be a second
 * way to write with a different amount of authority behind it, which is
 * the shape this packet exists to avoid.
 *
 * Owner-only, like a conversation: the actor comes from the verified
 * session and the service answers "not found" for anything that is not
 * theirs. Knowing an artifact id grants nothing — an old card in an old
 * message re-resolves through these same checks, so a person who has lost
 * access to a company loses the brief about it at the same moment.
 */

export type QArtifactRoutesDependencies = ActorContextDependencies & {
  readonly artifacts: ArtifactService;
  /** As on the run routes: a person with no organisation yet still has a session. */
  readonly identity?: ApplicationIdentityLookup | undefined;
};

function artifactIdParam(request: FastifyRequest): string {
  const params = request.params as Record<string, unknown>;
  return parseContract(
    UuidSchema,
    params["artifactId"],
    "The artifact identifier is not valid.",
  );
}

function notFound(): {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail: string;
} {
  return {
    type: "about:blank",
    title: "Not found",
    status: 404,
    detail: "No such artifact.",
  };
}

export function registerQArtifactRoutes(
  app: FastifyInstance,
  dependencies: QArtifactRoutesDependencies,
): void {
  const identity = dependencies.identity;
  const withContext =
    identity === undefined
      ? requireActorContextHook(dependencies)
      : requireActorContextOrPersonalHook({ ...dependencies, identity });
  const artifacts = dependencies.artifacts;
  const artifactPath = `${Q_ARTIFACTS_PATH}/:artifactId`;

  app.get(
    Q_ARTIFACTS_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const query = parseContract(
        ListQArtifactsQuerySchema,
        request.query ?? {},
        "The artifact listing request is not valid.",
      );
      const result = await artifacts.list(getActorContext(request), query);
      return reply.code(200).send(ListQArtifactsResponseSchema.parse(result));
    },
  );

  app.get(artifactPath, { onRequest: withContext }, async (request, reply) => {
    try {
      const detail = await artifacts.read(
        getActorContext(request),
        artifactIdParam(request),
      );
      return reply.code(200).send(QArtifactDetailSchema.parse(detail));
    } catch (error) {
      if (error instanceof ArtifactNotFoundError) {
        return reply.code(404).send(notFound());
      }
      throw error;
    }
  });

  app.get(
    `${artifactPath}${Q_ARTIFACT_VERSIONS_SUFFIX}/:version`,
    { onRequest: withContext },
    async (request, reply) => {
      const params = request.params as Record<string, unknown>;
      const raw = params["version"];
      const version = Number(typeof raw === "string" ? raw : Number.NaN);
      if (!Number.isInteger(version) || version < 1) {
        return reply.code(404).send(notFound());
      }
      try {
        const detail = await artifacts.readVersion(
          getActorContext(request),
          artifactIdParam(request),
          version,
        );
        return reply.code(200).send(QArtifactDetailSchema.parse(detail));
      } catch (error) {
        if (error instanceof ArtifactNotFoundError) {
          return reply.code(404).send(notFound());
        }
        throw error;
      }
    },
  );
}
