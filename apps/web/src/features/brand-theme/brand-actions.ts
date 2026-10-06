"use server";

import { revalidatePath } from "next/cache";

import { ApiProblemError, setAdminBrandTheme } from "@capital-q/api-client";
import { BrandPresetKeySchema } from "@capital-q/contracts";

import type { ConsoleResult } from "@/features/admin/console-actions";
import { apiSession } from "@/features/q/context";

import { normaliseHex } from "./brand-colour";

/**
 * Sets the brand preset and, optionally, a colour on top (K3), or with
 * null resets to the default preset (black and gold) with its own accent.
 * The API decides who may: only a platform admin with the write permission
 * and a live step-up. A STEP_UP_REQUIRED answer comes back as `stepUp:
 * true`, and the console's step-up guard asks for the password and retries.
 */
export async function setBrandThemeAction(
  input: {
    readonly presetKey: string;
    readonly primaryHex: string | null;
  } | null,
): Promise<ConsoleResult> {
  const preset =
    input === null ? null : BrandPresetKeySchema.safeParse(input.presetKey);
  if (preset !== null && !preset.success) {
    return { ok: false, message: "Pick one of the themes shown." };
  }
  const primaryHex =
    input?.primaryHex == null ? null : normaliseHex(input.primaryHex);
  if (input?.primaryHex != null && primaryHex === null) {
    return { ok: false, message: "Give a colour as #rrggbb, like #0f766e." };
  }
  const session = await apiSession();
  if (session === null) {
    return { ok: false, message: "Sign in again to continue." };
  }
  try {
    await setAdminBrandTheme(
      session,
      preset === null
        ? { primaryHex: null }
        : { presetKey: preset.data, primaryHex },
    );
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
          message: "Only a platform owner or operator can change the brand.",
        };
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
      input === null
        ? "Back to black and gold."
        : "Brand saved. Everyone in your firm sees it from their next page.",
  };
}
