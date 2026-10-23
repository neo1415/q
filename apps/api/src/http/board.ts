import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { BoardOutcome, BoardService } from "@capital-q/board";
import {
  AddBoardItemRequestSchema,
  BOARD_ITEM_MOVE_PATH,
  BOARD_ITEM_PATH,
  BOARD_ITEMS_PATH,
  BOARD_PATH,
  BoardItemSchema,
  BoardListSchema,
  createProblemDetails,
  IDEMPOTENCY_KEY_HEADER,
  IdempotencyKeyHeaderSchema,
  MoveBoardItemRequestSchema,
  parseContract,
  PROBLEM_CONTENT_TYPE,
  UpdateBoardItemRequestSchema,
  type BoardItem,
} from "@capital-q/contracts";

import {
  getActorContext,
  requireActorContextHook,
  type ActorContextDependencies,
} from "../security/actor-context.js";

/**
 * The work board (owner 2026-10-23): the signed-in person's own items.
 *
 * The owner is always the resolved actor; an item id is input, so an item
 * that is not theirs is the same 404 as one that does not exist. Adding
 * and moving carry an Idempotency-Key; an edit names the revision it was
 * made to, so a stale one is a 409 rather than a lost change. Never cached.
 */

export type BoardRoutesDependencies = ActorContextDependencies & {
  readonly board: BoardService;
};

const REFUSED = {
  NOT_FOUND: { code: "RESOURCE_NOT_FOUND", detail: "Not found." },
  CONFLICT: {
    code: "RESOURCE_CONFLICT",
    detail: "This item changed since you last saw it. Reload the board.",
  },
  FULL: {
    code: "RESOURCE_CONFLICT",
    detail: "Your board is full. Remove something first.",
  },
} as const;

function itemIdOf(request: FastifyRequest): string {
  const params = request.params as Readonly<Record<string, unknown>>;
  return typeof params["itemId"] === "string" ? params["itemId"] : "";
}

function idempotencyKeyOf(request: FastifyRequest, what: string): string {
  const raw = request.headers[IDEMPOTENCY_KEY_HEADER];
  return parseContract(
    IdempotencyKeyHeaderSchema,
    typeof raw === "string" ? raw : undefined,
    `An Idempotency-Key header is required to ${what}.`,
  );
}

function answer(
  request: FastifyRequest,
  reply: FastifyReply,
  outcome: BoardOutcome<BoardItem>,
  created = false,
) {
  void reply.header("Cache-Control", "no-store");
  if (outcome.outcome === "REFUSED") {
    const refusal = REFUSED[outcome.code];
    const problem = createProblemDetails({
      code: refusal.code,
      requestId: request.id,
      detail: refusal.detail,
    });
    return reply
      .status(problem.status)
      .type(PROBLEM_CONTENT_TYPE)
      .send(problem);
  }
  if (created && !outcome.replayed) void reply.status(201);
  return BoardItemSchema.parse(outcome.value);
}

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

  app.post(
    BOARD_ITEMS_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const idempotencyKey = idempotencyKeyOf(request, "add to your board");
      const body = parseContract(
        AddBoardItemRequestSchema,
        request.body,
        "The board item is not valid.",
      );
      return answer(
        request,
        reply,
        await board.add(getActorContext(request), body, {
          by: "PERSON",
          idempotencyKey,
        }),
        true,
      );
    },
  );

  app.patch(
    BOARD_ITEM_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const body = parseContract(
        UpdateBoardItemRequestSchema,
        request.body,
        "The change is not valid.",
      );
      const raw = request.headers[IDEMPOTENCY_KEY_HEADER];
      return answer(
        request,
        reply,
        await board.update(getActorContext(request), itemIdOf(request), body, {
          by: "PERSON",
          idempotencyKey:
            typeof raw === "string"
              ? idempotencyKeyOf(request, "change this item")
              : undefined,
        }),
      );
    },
  );

  app.post(
    BOARD_ITEM_MOVE_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const idempotencyKey = idempotencyKeyOf(request, "move this item");
      const body = parseContract(
        MoveBoardItemRequestSchema,
        request.body,
        "The move is not valid.",
      );
      return answer(
        request,
        reply,
        await board.move(getActorContext(request), itemIdOf(request), body, {
          by: "PERSON",
          idempotencyKey,
        }),
      );
    },
  );
}
