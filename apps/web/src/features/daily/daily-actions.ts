"use server";

import {
  ApiProblemError,
  requestQDailyEdition,
  setQDailyPreferences,
} from "@capital-q/api-client";
import {
  SetQDailyPreferencesRequestSchema,
  type QDailyPreferences,
  type QDailyRequestDto,
} from "@capital-q/contracts";

import { qApiSession } from "@/features/q/context";

/**
 * The Q Daily's two writes from the browser (DAILY spec §3): the person's
 * own preferences and "Prepare my edition". Server actions, so the session
 * token never reaches the browser; the Q API acts on the session's own
 * rows only.
 */

type Failure = { readonly ok: false; readonly message: string };

function failure(error: unknown, fallback: string): Failure {
  return {
    ok: false,
    message:
      error instanceof ApiProblemError && error.problem?.detail !== undefined
        ? error.problem.detail
        : fallback,
  };
}

export async function setDailyPreferencesAction(
  patch: unknown,
): Promise<
  { readonly ok: true; readonly preferences: QDailyPreferences } | Failure
> {
  const parsed = SetQDailyPreferencesRequestSchema.safeParse(patch);
  if (!parsed.success) {
    return { ok: false, message: "Choose how often and which sections." };
  }
  const session = await qApiSession();
  if (session === null) {
    return { ok: false, message: "Sign in again to continue." };
  }
  try {
    return {
      ok: true,
      preferences: await setQDailyPreferences(session, parsed.data),
    };
  } catch (error: unknown) {
    return failure(error, "Your change wasn't saved. Try again in a moment.");
  }
}

export async function requestDailyEditionAction(): Promise<
  { readonly ok: true; readonly result: QDailyRequestDto } | Failure
> {
  const session = await qApiSession();
  if (session === null) {
    return { ok: false, message: "Sign in again to continue." };
  }
  try {
    return { ok: true, result: await requestQDailyEdition(session) };
  } catch (error: unknown) {
    return failure(
      error,
      "Q couldn't start your edition. Try again in a moment.",
    );
  }
}
