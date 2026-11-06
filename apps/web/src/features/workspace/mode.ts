import "server-only";

import { cache } from "react";

import {
  serverModeOf,
  WORKSPACE_OFF,
  workspaceModeFromClaims,
  type WorkspaceMode,
} from "@capital-q/config/workspace-mode";

import { createServerSupabaseClient } from "@/auth/supabase-server";

/**
 * Whether this request renders the Q Workspace (W1.1).
 *
 * The preference is read from the verified session token's own claims
 * (`user_metadata`), so it costs no extra round trip on every page. It is a
 * display choice only and is never authority for anything. With the server
 * switch `off` nothing is read at all. q-api decides the same way from the
 * same token (`workspaceModeFromClaims`).
 */
export const workspaceMode = cache(async (): Promise<WorkspaceMode> => {
  if (serverModeOf(process.env.CQ_WORKSPACE_MODE) === "off") {
    return WORKSPACE_OFF;
  }
  try {
    const supabase = await createServerSupabaseClient();
    const { data } = await supabase.auth.getClaims();
    return workspaceModeFromClaims(data?.claims ?? null, process.env);
  } catch {
    // A preference we cannot read is the server's default for everyone.
    return workspaceModeFromClaims(null, process.env);
  }
});
