"use server";

import { z } from "zod";

import {
  ApiProblemError,
  addBoardItem,
  listBoard,
  moveBoardItem,
  updateBoardItem,
} from "@capital-q/api-client";
import {
  AddBoardItemRequestSchema,
  MoveBoardItemRequestSchema,
  UpdateBoardItemRequestSchema,
  type BoardItem,
  type BoardList,
} from "@capital-q/contracts";

import { apiSession } from "@/features/q/context";

/**
 * The work board, server side (owner 2026-10-23). Server actions so the
 * session token never reaches the browser. The owner is never taken from
 * the browser: the API resolves the signed-in person and finds only their
 * own items, so an id from the page is input, never proof.
 */

export type BoardResult<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      /** CONFLICT: it changed meanwhile, so the page reads the board again. */
      readonly reason: "CONFLICT" | "NOT_FOUND" | "FAILED" | "SIGNED_OUT";
      readonly message: string;
    };

function failed(error: unknown): BoardResult<never> {
  if (error instanceof ApiProblemError) {
    if (error.status === 404) {
      return {
        ok: false,
        reason: "NOT_FOUND",
        message: "That item isn't on your board any more.",
      };
    }
    if (error.status === 409) {
      return {
        ok: false,
        reason: "CONFLICT",
        message:
          error.problem?.detail ??
          "This item changed since you last saw it. The board is up to date now.",
      };
    }
  }
  return {
    ok: false,
    reason: "FAILED",
    message: "Couldn't save that just now. Nothing was lost; try again.",
  };
}

const SIGNED_OUT = {
  ok: false,
  reason: "SIGNED_OUT",
  message: "Please sign in again to continue.",
} as const;

export async function listBoardAction(): Promise<BoardResult<BoardList>> {
  const session = await apiSession();
  if (session === null) return SIGNED_OUT;
  try {
    return { ok: true, value: await listBoard(session) };
  } catch (error: unknown) {
    return failed(error);
  }
}

const Add = z
  .object({ idempotencyKey: z.uuid(), request: AddBoardItemRequestSchema })
  .strict();

export async function addBoardItemAction(
  input: unknown,
): Promise<BoardResult<BoardItem>> {
  const parsed = Add.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "FAILED",
      message: "Give the item a title of up to 300 characters.",
    };
  }
  const session = await apiSession();
  if (session === null) return SIGNED_OUT;
  try {
    return {
      ok: true,
      value: await addBoardItem(
        session,
        parsed.data.idempotencyKey,
        parsed.data.request,
      ),
    };
  } catch (error: unknown) {
    return failed(error);
  }
}

const Update = z
  .object({ itemId: z.uuid(), request: UpdateBoardItemRequestSchema })
  .strict();

export async function updateBoardItemAction(
  input: unknown,
): Promise<BoardResult<BoardItem>> {
  const parsed = Update.safeParse(input);
  if (!parsed.success) {
    return { ok: false, reason: "FAILED", message: "That change isn't valid." };
  }
  const session = await apiSession();
  if (session === null) return SIGNED_OUT;
  try {
    return {
      ok: true,
      value: await updateBoardItem(
        session,
        parsed.data.itemId,
        parsed.data.request,
      ),
    };
  } catch (error: unknown) {
    return failed(error);
  }
}

const Move = z
  .object({
    itemId: z.uuid(),
    idempotencyKey: z.uuid(),
    request: MoveBoardItemRequestSchema,
  })
  .strict();

export async function moveBoardItemAction(
  input: unknown,
): Promise<BoardResult<BoardItem>> {
  const parsed = Move.safeParse(input);
  if (!parsed.success) {
    return { ok: false, reason: "FAILED", message: "That move isn't valid." };
  }
  const session = await apiSession();
  if (session === null) return SIGNED_OUT;
  try {
    return {
      ok: true,
      value: await moveBoardItem(
        session,
        parsed.data.itemId,
        parsed.data.idempotencyKey,
        parsed.data.request,
      ),
    };
  } catch (error: unknown) {
    return failed(error);
  }
}
