"use server";

import { ApiProblemError, setQPersonality } from "@capital-q/api-client";
import { QPersonalitySchema, type QPersonality } from "@capital-q/contracts";

import { qApiSession } from "@/features/q/context";

/**
 * Who Q is with this person (founder direction 2026-09-30), set from
 * Settings. A server action so the session token never reaches the
 * browser; the Q API writes the person's own row only.
 */
export async function setPersonalityAction(
  choice: string,
): Promise<
  | { readonly ok: true; readonly personality: QPersonality }
  | { readonly ok: false; readonly message: string }
> {
  const personality = QPersonalitySchema.safeParse(choice);
  if (!personality.success) {
    return { ok: false, message: "Choose one of Q's personalities." };
  }
  const session = await qApiSession();
  if (session === null) {
    return { ok: false, message: "Please sign in again to continue." };
  }
  try {
    const saved = await setQPersonality(session, personality.data);
    return { ok: true, personality: saved.personality };
  } catch (error: unknown) {
    return {
      ok: false,
      message:
        error instanceof ApiProblemError && error.problem?.detail !== undefined
          ? error.problem.detail
          : "Couldn't save that just now. Please try again.",
    };
  }
}
