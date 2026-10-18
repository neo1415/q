"use server";

import { revalidatePath } from "next/cache";

import {
  activateAdminEtiquetteGuide,
  ApiProblemError,
  recordAdminEtiquetteGuide,
  removeMyEtiquetteGuide,
  saveMyEtiquetteGuide,
} from "@capital-q/api-client";
import {
  AdminEtiquetteGuideRequestSchema,
  SaveEtiquetteGuideRequestSchema,
  type MyEtiquetteGuideDto,
} from "@capital-q/contracts";

import type { ConsoleResult } from "@/features/admin/console-actions";
import { apiSession } from "@/features/q/context";

/**
 * How Q conducts business (ADR 0050). Server actions, so the session token
 * never reaches the browser. The person's own guide is saved and removed
 * as themselves; the house guide only by a platform admin with step-up,
 * which the API decides (a STEP_UP_REQUIRED answer comes back as
 * `stepUp: true` for the console's guard to ask and retry).
 */

export type MyGuideResult =
  | { readonly ok: true; readonly mine: MyEtiquetteGuideDto }
  | { readonly ok: false; readonly message: string };

function problemWords(error: unknown, fallback: string): string {
  return error instanceof ApiProblemError &&
    error.problem?.detail !== undefined &&
    error.status !== 404
    ? error.problem.detail
    : fallback;
}

export async function saveMyGuideAction(
  input: unknown,
): Promise<MyGuideResult> {
  const parsed = SaveEtiquetteGuideRequestSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message:
        parsed.error.issues[0]?.message === "at least a sentence or two"
          ? "Write at least a sentence or two."
          : "That can't be saved as your guide. Check its length and try again.",
    };
  }
  const session = await apiSession();
  if (session === null) {
    return { ok: false, message: "Please sign in again to continue." };
  }
  try {
    const mine = await saveMyEtiquetteGuide(session, parsed.data);
    revalidatePath("/settings");
    return { ok: true, mine };
  } catch (error: unknown) {
    return {
      ok: false,
      message: problemWords(error, "Couldn't save that just now. Try again."),
    };
  }
}

export async function removeMyGuideAction(): Promise<MyGuideResult> {
  const session = await apiSession();
  if (session === null) {
    return { ok: false, message: "Please sign in again to continue." };
  }
  try {
    const mine = await removeMyEtiquetteGuide(session);
    revalidatePath("/settings");
    return { ok: true, mine };
  } catch (error: unknown) {
    return {
      ok: false,
      message: problemWords(error, "Couldn't remove it just now. Try again."),
    };
  }
}

async function consoleWrite(
  work: (
    session: NonNullable<Awaited<ReturnType<typeof apiSession>>>,
  ) => Promise<unknown>,
  done: string,
): Promise<ConsoleResult> {
  const session = await apiSession();
  if (session === null) {
    return { ok: false, message: "Sign in again to continue." };
  }
  try {
    await work(session);
  } catch (error: unknown) {
    if (error instanceof ApiProblemError) {
      if (error.code === "STEP_UP_REQUIRED") {
        return {
          ok: false,
          stepUp: true,
          message: "Confirm it's you to continue.",
        };
      }
      if (error.status === 404) {
        return {
          ok: false,
          message:
            "Only a platform owner or operator can change how Q conducts business.",
        };
      }
      if (error.problem?.detail !== undefined) {
        return { ok: false, message: error.problem.detail };
      }
    }
    return {
      ok: false,
      message: "That didn't go through. Nothing changed. Try again.",
    };
  }
  revalidatePath("/admin/etiquette");
  return { ok: true, message: done };
}

export async function recordHouseGuideAction(
  input: unknown,
): Promise<ConsoleResult> {
  const parsed = AdminEtiquetteGuideRequestSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: "Give the guide a title and at least a sentence or two of text.",
    };
  }
  return consoleWrite(
    (session) => recordAdminEtiquetteGuide(session, parsed.data),
    "Saved as a new version. Q follows it from its next message.",
  );
}

export async function activateHouseGuideAction(
  versionId: string | null,
): Promise<ConsoleResult> {
  return consoleWrite(
    (session) => activateAdminEtiquetteGuide(session, { versionId }),
    versionId === null
      ? "Q now follows Capital Q's built-in guide."
      : "That version is now the one Q follows.",
  );
}
