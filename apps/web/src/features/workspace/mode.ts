import "server-only";

import { cache } from "react";

import { createServerSupabaseClient } from "@/auth/supabase-server";

import {
  decideWorkspaceMode,
  preferenceOf,
  serverModeOf,
  WORKSPACE_OFF,
  WORKSPACE_PREFERENCE_KEY,
  type WorkspaceMode,
} from "./mode-rules";

/**
 * Whether this request renders the Q Workspace (W1.1).
 *
 * The preference is read from the verified session token's own claims
 * (`user_metadata`), so it costs no extra round trip on every page. It is a
 * display choice only and is never authority for anything. With the server
 * switch `off` nothing is read at all.
 */
export const workspaceMode = cache(async (): Promise<WorkspaceMode> => {
  const server = serverModeOf(process.env.CQ_WORKSPACE_MODE);
  if (server === "off") return WORKSPACE_OFF;
  try {
    const supabase = await createServerSupabaseClient();
    const { data } = await supabase.auth.getClaims();
    const metadata: unknown = data?.claims["user_metadata"];
    const raw =
      typeof metadata === "object" && metadata !== null
        ? (metadata as Record<string, unknown>)[WORKSPACE_PREFERENCE_KEY]
        : undefined;
    return decideWorkspaceMode(server, preferenceOf(raw));
  } catch {
    // A preference we cannot read is the server's default for everyone.
    return decideWorkspaceMode(server, null);
  }
});
