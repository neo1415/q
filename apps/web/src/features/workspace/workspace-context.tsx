"use client";

import { createContext, useContext, type ReactNode } from "react";

import {
  WORKSPACE_OFF,
  type WorkspaceMode,
} from "@capital-q/config/workspace-mode";

/**
 * Whether this page is inside the Q Workspace (W1.1), as the server
 * decided for this request. Presentation only: nothing here grants access
 * to anything.
 */
const WorkspaceContext = createContext<WorkspaceMode>(WORKSPACE_OFF);

export function WorkspaceProvider({
  mode,
  children,
}: {
  readonly mode: WorkspaceMode;
  readonly children: ReactNode;
}) {
  return (
    <WorkspaceContext.Provider value={mode}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspaceMode(): WorkspaceMode {
  return useContext(WorkspaceContext);
}
