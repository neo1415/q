"use server";

import { z } from "zod";

import { ApiProblemError, reinstatePausedAccount } from "@capital-q/api-client";

import { apiSession } from "@/features/q/context";

import type { ConsoleResult } from "./console-actions";

/**
 * An operator reinstates an account Q paused. A server action so the
 * session never reaches the browser; the API decides who is an operator,
 * and asks for a step-up first (ADR 0033).
 */
export async function reinstateAction(userId: string): Promise<ConsoleResult> {
  const id = z.string().uuid().safeParse(userId);
  if (!id.success) return { ok: false, message: "Not found." };
  const session = await apiSession();
  if (session === null) {
    return { ok: false, message: "Sign in again to continue." };
  }
  try {
    await reinstatePausedAccount(session, id.data);
    return { ok: true, message: "Reinstated." };
  } catch (error: unknown) {
    if (error instanceof ApiProblemError && error.code === "STEP_UP_REQUIRED") {
      return {
        ok: false,
        stepUp: true,
        message: "Confirm it's you to continue.",
      };
    }
    return { ok: false, message: "Couldn't reinstate that account just now." };
  }
}
