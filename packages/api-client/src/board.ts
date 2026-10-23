import {
  AddBoardItemRequestSchema,
  BOARD_ITEM_MOVE_PATH,
  BOARD_ITEM_PATH,
  BOARD_ITEMS_PATH,
  BOARD_PATH,
  BoardItemSchema,
  BoardListSchema,
  IDEMPOTENCY_KEY_HEADER,
  MoveBoardItemRequestSchema,
  UpdateBoardItemRequestSchema,
  type AddBoardItemRequest,
  type MoveBoardItemRequest,
  type UpdateBoardItemRequest,
} from "@capital-q/contracts";

import { call, type ApiSession } from "./request.js";

/**
 * The work board (owner 2026-10-23): the signed-in person's own items. The
 * owner is the session's person; an item id is checked by the server, never
 * proof. Adding and moving carry the caller's Idempotency-Key, so a retry
 * changes nothing twice.
 */

const itemPath = (template: string, itemId: string) =>
  template.replace(":itemId", encodeURIComponent(itemId));

export function listBoard(session: ApiSession) {
  return call(session, "GET", BOARD_PATH, BoardListSchema);
}

export function addBoardItem(
  session: ApiSession,
  idempotencyKey: string,
  input: AddBoardItemRequest,
) {
  return call(session, "POST", BOARD_ITEMS_PATH, BoardItemSchema, {
    body: AddBoardItemRequestSchema.parse(input),
    headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey },
  });
}

export function updateBoardItem(
  session: ApiSession,
  itemId: string,
  input: UpdateBoardItemRequest,
) {
  return call(
    session,
    "PATCH",
    itemPath(BOARD_ITEM_PATH, itemId),
    BoardItemSchema,
    { body: UpdateBoardItemRequestSchema.parse(input) },
  );
}

export function moveBoardItem(
  session: ApiSession,
  itemId: string,
  idempotencyKey: string,
  input: MoveBoardItemRequest,
) {
  return call(
    session,
    "POST",
    itemPath(BOARD_ITEM_MOVE_PATH, itemId),
    BoardItemSchema,
    {
      body: MoveBoardItemRequestSchema.parse(input),
      headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey },
    },
  );
}
