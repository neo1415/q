import type { FastifyInstance } from "fastify";

import {
  parseContract,
  Q_ROOM_PATH,
  QRoomReadQuerySchema,
  QRoomReadSchema,
} from "@capital-q/contracts";
import type { ApplicationIdentityLookup } from "@capital-q/security/postgres";

import {
  getActorContext,
  requireActorContextHook,
  requireActorContextOrPersonalHook,
  type ActorContextDependencies,
} from "../security/actor-context.js";
import type { QRoomFeed } from "./feed.js";

/**
 * `GET /v1/q/room` (voice-cards): the person's own Q room feed, as a long
 * poll. A normal protected request: the actor is resolved on the server,
 * and a person only ever reads their own room (the feed is keyed by the
 * resolved tenant and user, never by anything the request names).
 */
export function registerQRoomRoutes(
  app: FastifyInstance,
  dependencies: ActorContextDependencies & {
    readonly identity?: ApplicationIdentityLookup | undefined;
    readonly room: QRoomFeed;
  },
): void {
  const identity = dependencies.identity;
  const withContext =
    identity === undefined
      ? requireActorContextHook(dependencies)
      : requireActorContextOrPersonalHook({ ...dependencies, identity });

  app.get(Q_ROOM_PATH, { onRequest: withContext }, async (request, reply) => {
    const query = parseContract(
      QRoomReadQuerySchema,
      request.query ?? {},
      "That room read is not valid.",
    );
    const controller = new AbortController();
    reply.raw.once("close", () => {
      if (!reply.raw.writableFinished) controller.abort();
    });
    const read = await dependencies.room.read({
      actor: getActorContext(request),
      after: query.after,
      epoch: query.epoch,
      wait: query.wait === 1,
      signal: controller.signal,
    });
    return reply
      .code(200)
      .header("Cache-Control", "no-store")
      .send(QRoomReadSchema.parse(read));
  });
}
