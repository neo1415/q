/**
 * Q Workspace mode (Q_WORKSPACE_PLAN §4.1; DECISIONS 71). Pure rules, shared
 * by the server helper and its tests.
 *
 * Two inputs decide whether a person sees the split workspace:
 * - the server's switch `CQ_WORKSPACE_MODE` (`off` | `labs` | `on`), read
 *   per request so reverting is a variable change, not a redeploy. Unset or
 *   anything unrecognised is `off`: today's app, unchanged.
 * - the person's own preference (`on` | `off` | unset), kept on their
 *   account. It only matters while the server allows the workspace.
 */
export const WORKSPACE_SERVER_MODES = ["off", "labs", "on"] as const;
export type WorkspaceServerMode = (typeof WORKSPACE_SERVER_MODES)[number];

export type WorkspacePreference = "on" | "off" | null;

/** The account metadata key the preference is kept under. */
export const WORKSPACE_PREFERENCE_KEY = "cq_workspace";

export type WorkspaceMode = {
  /** The split workspace renders for this person on this request. */
  readonly enabled: boolean;
  /** Settings offers the toggle (the server is `labs` or `on`). */
  readonly available: boolean;
};

export const WORKSPACE_OFF: WorkspaceMode = {
  enabled: false,
  available: false,
};

export function serverModeOf(raw: string | undefined): WorkspaceServerMode {
  const value = raw?.trim().toLowerCase();
  return value === "labs" || value === "on" ? value : "off";
}

export function preferenceOf(raw: unknown): WorkspacePreference {
  return raw === "on" || raw === "off" ? raw : null;
}

/**
 * `off` overrides everyone (the kill switch). `labs`: only a person who
 * turned it on. `on`: everyone except a person who turned it off.
 */
export function decideWorkspaceMode(
  server: WorkspaceServerMode,
  preference: WorkspacePreference,
): WorkspaceMode {
  switch (server) {
    case "off":
      return WORKSPACE_OFF;
    case "labs":
      return { enabled: preference === "on", available: true };
    case "on":
      return { enabled: preference !== "off", available: true };
  }
}
