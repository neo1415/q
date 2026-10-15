import type { FastifyInstance } from "fastify";

import {
  ArrivalSnapshotSchema,
  createProblemDetails,
  PROBLEM_CONTENT_TYPE,
  Q_ARRIVAL_SNAPSHOT_PATH,
  type ArrivalSnapshot,
} from "@capital-q/contracts";
import type { ActorContext } from "@capital-q/security";

import {
  getActorContext,
  requireActorContextHook,
  type ActorContextDependencies,
} from "../security/actor-context.js";

/**
 * W1: the Arrival Snapshot as one read for every surface (the welcome, the
 * Work list and cards): the same object Q's turns and the live voice
 * session are given, so a headline and Q's answer about it can never
 * disagree. The person's own, by the resolved actor; never an input id.
 *
 * `GET /v1/q/arrival-snapshot`
 */
export type ArrivalSnapshotRoutesDependencies = ActorContextDependencies & {
  readonly snapshots: {
    readonly forActor: (actor: ActorContext) => Promise<ArrivalSnapshot | null>;
    readonly invalidateActor: (userId: string) => number;
  };
};

/**
 * A write by this person ends the trust in what was read before it, so "I
 * just approved it" is never answered from the old snapshot. Registered at
 * the top of the app so it covers every route. (Writes by the other side
 * are seen within the snapshot's trust window.)
 */
/**
 * Only writes that touch the snapshot's sources end trust: an approval's
 * decision, a relationship / connection write, membership and invitations,
 * chat. A Q run or turn POST (`/v1/q/runs`, `/v1/q/conversations`, voice)
 * must not: it reads the snapshot and would otherwise wipe it every turn
 * (V2: 31 round trips instead of 2). Everything else is covered by the
 * probe stamp and the trust window.
 */
const SOURCE_WRITE_PATHS: readonly RegExp[] = [
  /^\/v1\/q\/approvals(?:\/|$)/u,
  /^\/v1\/network(?:\/|$)/u,
  /^\/v1\/chat(?:\/|$)/u,
  /^\/v1\/team(?:\/|$)/u,
  /^\/v1\/invitations(?:\/|$)/u,
];

export function touchesSnapshotSources(method: string, url: string): boolean {
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return false;
  }
  const path = url.split("?")[0] ?? url;
  return SOURCE_WRITE_PATHS.some((pattern) => pattern.test(path));
}

export function registerArrivalSnapshotInvalidation(
  app: FastifyInstance,
  snapshots: Pick<
    ArrivalSnapshotRoutesDependencies["snapshots"],
    "invalidateActor"
  >,
): void {
  app.addHook("onResponse", (request, _reply, done) => {
    if (touchesSnapshotSources(request.method, request.url)) {
      try {
        snapshots.invalidateActor(getActorContext(request).userId);
      } catch {
        // Not an authenticated request: nothing of theirs to end.
      }
    }
    done();
  });
}

export function registerArrivalSnapshotRoutes(
  app: FastifyInstance,
  dependencies: ArrivalSnapshotRoutesDependencies,
): void {
  const withContext = requireActorContextHook(dependencies);
  app.get(
    Q_ARRIVAL_SNAPSHOT_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      void reply.header("Cache-Control", "no-store");
      const snapshot = await dependencies.snapshots.forActor(
        getActorContext(request),
      );
      if (snapshot === null) {
        const problem = createProblemDetails({
          code: "RESOURCE_NOT_FOUND",
          requestId: request.id,
          detail: "No arrival snapshot for this account.",
        });
        return reply
          .status(problem.status)
          .type(PROBLEM_CONTENT_TYPE)
          .send(problem);
      }
      return ArrivalSnapshotSchema.parse(snapshot);
    },
  );
}
