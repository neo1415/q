import { z } from "zod";

import type { BoardOutcome } from "@capital-q/board";
import {
  AddBoardItemRequestSchema,
  BOARD_ITEM_MOVE_PATH,
  BOARD_ITEM_PATH,
  BOARD_ITEMS_PATH,
  BoardItemSchema,
  IDEMPOTENCY_KEY_HEADER,
  IdempotencyKeyHeaderSchema,
  MoveBoardItemRequestSchema,
  UpdateBoardItemRequestSchema,
  type BoardItem,
  type KnownErrorCode,
} from "@capital-q/contracts";

import { defineAppAction, portMissing, type AnyAppAction } from "../define.js";
import type { AppActionPorts } from "../ports.js";

/**
 * The work board (owner 2026-10-23): add, change and move the person's
 * own items, declared once with their generated routes (ADR 0040). Their
 * own private board, so INSTANT, revisioned and with its history kept.
 *
 * Q's side is the board tool (`legacyTool`: my_board), which calls the
 * same service and also reads the board and starts Q's work on items --
 * one tool for one thing to the person, inside the per-request bound.
 *
 * The board service authorises: the owner is always the actor, so an item
 * that is not theirs is the route's one not-found.
 */

const board = (ports: AppActionPorts) => ports.board ?? portMissing("board");

const serviceDecides = () => Promise.resolve({ ok: true as const });

type Outcome = BoardOutcome<BoardItem>;
const outcome = (): z.ZodType<Outcome> => z.custom<Outcome>();

const CONFLICT = {
  code: "RESOURCE_CONFLICT" as KnownErrorCode,
  detail: "This item changed since you last saw it. Reload the board.",
};
const FULL = {
  code: "RESOURCE_CONFLICT" as KnownErrorCode,
  detail: "Your board is full. Remove something first.",
};

const refusedAs = (out: Outcome) =>
  out.outcome === "REFUSED" && out.code !== "NOT_FOUND"
    ? out.code === "FULL"
      ? FULL
      : CONFLICT
    : null;
const notFound = (out: Outcome) =>
  out.outcome === "REFUSED" && out.code === "NOT_FOUND";
const respond = (out: Outcome) =>
  out.outcome === "OK" ? BoardItemSchema.parse(out.value) : null;
const succeeded = (out: Outcome) => out.outcome === "OK";

const ItemId = z.uuid();

// --- add ---------------------------------------------------------------------

const Add = z
  .object({
    idempotencyKey: IdempotencyKeyHeaderSchema,
    request: AddBoardItemRequestSchema,
  })
  .strict();

const ADD = defineAppAction<z.infer<typeof Add>, Outcome>({
  name: "board.item.add",
  short: "add to my board",
  area: "board",
  classification: "INSTANT",
  does: "Adds an item (a document, a company, a task or a note) to their own work board, as the board does.",
  input: Add,
  output: outcome(),
  authorize: serviceDecides,
  run: (ports, context, input) =>
    board(ports).add(context.actor, input.request, {
      by: "PERSON",
      idempotencyKey: input.idempotencyKey,
    }),
  succeeded,
  targets: () => [],
  card: (input) => ({
    summary: "Add to your board",
    preview: input.request.title,
  }),
  done: (_out, input) => `Added “${input.request.title}” to your board.`,
  http: {
    method: "POST",
    path: BOARD_ITEMS_PATH,
    fromRequest: (_params, body, headers) => ({
      idempotencyKey: headers[IDEMPOTENCY_KEY_HEADER],
      request: body,
    }),
    // Created, or the same item again for a retried request.
    status: (out) => (out.outcome === "OK" && !out.replayed ? 201 : 200),
    idempotencyKeyOf: (input) => `board-add:${input.idempotencyKey}`,
    problem: refusedAs,
    notFound,
    respond,
  },
  legacyTool: "my_board",
});

// --- edit or remove ------------------------------------------------------------

const Update = z
  .object({
    itemId: ItemId,
    idempotencyKey: IdempotencyKeyHeaderSchema.optional(),
    request: UpdateBoardItemRequestSchema,
  })
  .strict();

const UPDATE = defineAppAction<z.infer<typeof Update>, Outcome>({
  name: "board.item.update",
  short: "change a board item",
  area: "board",
  classification: "INSTANT",
  does: "Renames an item on their own work board, sets its notes or due date, or takes it off the board, as the board does.",
  input: Update,
  output: outcome(),
  authorize: serviceDecides,
  run: (ports, context, input) =>
    board(ports).update(context.actor, input.itemId, input.request, {
      by: "PERSON",
      idempotencyKey: input.idempotencyKey,
    }),
  succeeded,
  targets: () => [],
  card: (input) => ({
    summary:
      input.request.archived === true
        ? "Take it off your board"
        : "Change a board item",
    preview: input.request.title ?? "",
  }),
  done: (_out, input) =>
    input.request.archived === true ? "Taken off your board." : "Changed.",
  http: {
    method: "PATCH",
    path: BOARD_ITEM_PATH,
    fromRequest: (params, body, headers) => ({
      itemId: params["itemId"],
      ...(headers[IDEMPOTENCY_KEY_HEADER] === undefined
        ? {}
        : { idempotencyKey: headers[IDEMPOTENCY_KEY_HEADER] }),
      request: body,
    }),
    problem: refusedAs,
    notFound,
    respond,
  },
  legacyTool: "my_board",
});

// --- move ------------------------------------------------------------------------

const Move = z
  .object({
    itemId: ItemId,
    idempotencyKey: IdempotencyKeyHeaderSchema,
    request: MoveBoardItemRequestSchema,
  })
  .strict();

const MOVE = defineAppAction<z.infer<typeof Move>, Outcome>({
  name: "board.item.move",
  short: "move a board item",
  area: "board",
  classification: "INSTANT",
  does: "Moves an item on their own work board to TODO, DOING or DONE, or to another place in its column, as the board does.",
  input: Move,
  output: outcome(),
  authorize: serviceDecides,
  run: (ports, context, input) =>
    board(ports).move(context.actor, input.itemId, input.request, {
      by: "PERSON",
      idempotencyKey: input.idempotencyKey,
    }),
  succeeded,
  targets: () => [],
  card: (input) => ({
    summary: `Move it to ${input.request.status}`,
    preview: "",
  }),
  done: (_out, input) => `Moved to ${input.request.status}.`,
  http: {
    method: "POST",
    path: BOARD_ITEM_MOVE_PATH,
    fromRequest: (params, body, headers) => ({
      itemId: params["itemId"],
      idempotencyKey: headers[IDEMPOTENCY_KEY_HEADER],
      request: body,
    }),
    idempotencyKeyOf: (input) => `board-move:${input.idempotencyKey}`,
    problem: refusedAs,
    notFound,
    respond,
  },
  legacyTool: "my_board",
});

export const BOARD_ACTIONS: readonly AnyAppAction[] = [ADD, UPDATE, MOVE];
