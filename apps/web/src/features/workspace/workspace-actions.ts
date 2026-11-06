"use server";

import { revalidatePath } from "next/cache";

import { getSessionUser } from "@/auth/session";
import { createServerSupabaseClient } from "@/auth/supabase-server";

import { WORKSPACE_PREFERENCE_KEY } from "@capital-q/config/workspace-mode";

/**
 * The person turns the Q Workspace preview on or off for their account
 * (W1.1). It is kept in their own account metadata, written under their own
 * session; the session is refreshed so the next page's token carries it.
 */
export async function setWorkspacePreferenceAction(
  on: boolean,
): Promise<{ readonly ok: boolean }> {
  if (typeof on !== "boolean") return { ok: false };
  const user = await getSessionUser();
  if (user === null) return { ok: false };
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.updateUser({
    data: { [WORKSPACE_PREFERENCE_KEY]: on ? "on" : "off" },
  });
  if (error !== null) return { ok: false };
  await supabase.auth.refreshSession();
  revalidatePath("/", "layout");
  return { ok: true };
}
