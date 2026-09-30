"use server";

import { z } from "zod";

import { reinstatePausedAccount } from "@capital-q/api-client";

import { apiSession } from "@/features/q/context";

/**
 * An operator reinstates an account Q paused. A server action so the
 * session never reaches the browser; the API decides who is an operator.
 */
export async function reinstateAction(
  userId: string,
): Promise<
  { readonly ok: true } | { readonly ok: false; readonly message: string }
> {
  const id = z.string().uuid().safeParse(userId);
  if (!id.success) return { ok: false, message: "Not found." };
  const session = await apiSession();
  if (session === null) {
    return { ok: false, message: "Please sign in again to continue." };
  }
  try {
    await reinstatePausedAccount(session, id.data);
    return { ok: true };
  } catch {
    return { ok: false, message: "Couldn't reinstate that account just now." };
  }
}
