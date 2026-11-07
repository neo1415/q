"use server";

import { revalidatePath } from "next/cache";

import { ApiProblemError, setViewingPrivacy } from "@capital-q/api-client";
import { ViewingVisibilitySchema } from "@capital-q/contracts";

import { apiSession } from "@/features/q/context";

/**
 * The person's own viewing visibility (§6.7.13), through the declared
 * action engagement.viewing_privacy.set: the same route Q's
 * set_viewing_privacy uses. The database enforces the level.
 */
export async function setViewingVisibilityAction(
  visibility: unknown,
): Promise<{ readonly ok: boolean; readonly message: string }> {
  const parsed = ViewingVisibilitySchema.safeParse(visibility);
  if (!parsed.success) return { ok: false, message: "Choose a level." };
  const session = await apiSession();
  if (session === null) {
    return { ok: false, message: "Sign in again to continue." };
  }
  try {
    await setViewingPrivacy(session, parsed.data);
    revalidatePath("/analytics");
    return { ok: true, message: "Saved." };
  } catch (error: unknown) {
    if (error instanceof ApiProblemError && error.status === 422) {
      return {
        ok: false,
        message: "That level isn't offered on Capital Q right now.",
      };
    }
    return { ok: false, message: "That didn't save. Try again." };
  }
}
