"use server";

import { ApiProblemError, setQLanguage } from "@capital-q/api-client";
import {
  QLanguagePreferenceSchema,
  type QLanguagePreference,
} from "@capital-q/contracts";

import { qApiSession } from "@/features/q/context";

/**
 * The language Q uses with this person (multilingual Q, 2026-10-16), set
 * from Settings. A server action so the session token never reaches the
 * browser; the Q API writes the person's own row only, and the value is
 * validated here and again there.
 */
export async function setLanguageAction(
  choice: string,
): Promise<
  | { readonly ok: true; readonly language: QLanguagePreference }
  | { readonly ok: false; readonly message: string }
> {
  const language = QLanguagePreferenceSchema.safeParse(choice);
  if (!language.success) {
    return { ok: false, message: "Choose one of the languages Q speaks." };
  }
  const session = await qApiSession();
  if (session === null) {
    return { ok: false, message: "Please sign in again to continue." };
  }
  try {
    const saved = await setQLanguage(session, language.data);
    return { ok: true, language: saved.language };
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
