"use server";

import { revalidatePath } from "next/cache";

import { ApiProblemError, setAdminBrandTheme } from "@capital-q/api-client";

import type { ConsoleResult } from "@/features/admin/console-actions";
import { apiSession } from "@/features/q/context";

import { normaliseHex } from "./brand-colour";

/**
 * Sets (or, with null, resets) the brand colour. The API decides who may:
 * only a platform admin with the write permission and a live step-up. A
 * STEP_UP_REQUIRED answer comes back as `stepUp: true`, and the console's
 * step-up guard asks for the password and retries.
 */
export async function setBrandColourAction(
  input: string | null,
): Promise<ConsoleResult> {
  const primaryHex = input === null ? null : normaliseHex(input);
  if (input !== null && primaryHex === null) {
    return { ok: false, message: "Give a colour as #rrggbb, like #0f766e." };
  }
  const session = await apiSession();
  if (session === null) {
    return { ok: false, message: "Sign in again to continue." };
  }
  try {
    await setAdminBrandTheme(session, { primaryHex });
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
        return { ok: false, message: "Only a platform owner or operator can change the brand." };
      }
    }
    return {
      ok: false,
      message: "That didn't go through. Nothing changed. Try again.",
    };
  }
  // Every page paints with the brand, so the whole app re-renders with it.
  revalidatePath("/", "layout");
  return {
    ok: true,
    message:
      primaryHex === null
        ? "Back to Capital Q blue."
        : "Brand colour saved. Everyone sees it on their next page.",
  };
}
