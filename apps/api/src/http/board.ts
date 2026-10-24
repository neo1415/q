import type { FastifyInstance } from "fastify";

import type { BoardService } from "@capital-q/board";
import { BOARD_PATH, BoardListSchema } from "@capital-q/contracts";

import {
  getActorContext,
  requireActorContextHook,
  type ActorContextDependencies,
} from "../security/actor-context.js";

/**
 * The work board (owner 2026-10-23): reading the signed-in person's own
 * items. The owner is always the resolved actor. Adding, changing and
 * moving are declared actions with generated routes (ADR 0040,
 * `@capital-q/app-actions` board.item.*). Never cached.
 */

export type BoardRoutesDependencies = ActorContextDependencies & {
  readonly board: BoardService;
};

export function registerBoardRoutes(
  app: FastifyInstance,
  dependencies: BoardRoutesDependencies,
): void {
  const withContext = requireActorContextHook(dependencies);
  const { board } = dependencies;

  app.get(BOARD_PATH, { onRequest: withContext }, async (request, reply) => {
    void reply.header("Cache-Control", "no-store");
    return BoardListSchema.parse(await board.list(getActorContext(request)));
  });
}
