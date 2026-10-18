"use client";

import { createContext, useContext } from "react";

/**
 * What the Q surface lets the things inside it do, without leaving it (K).
 *
 * A welcome card that asks Q something asks it in this conversation, and
 * one that opens a document Q made opens it in this surface's viewer.
 * Before this, a card asked through a separate run and navigated to it,
 * and a prepared deck opened as a bare page: Q work left Q to happen.
 * Absent outside a Q surface, where callers fall back to their own path.
 */
export type QSurfaceTools = {
  readonly ask: (prompt: string) => void;
  readonly openArtifact: (artifactId: string) => void;
};

export const QSurfaceToolsContext = createContext<QSurfaceTools | null>(null);

export function useQSurfaceTools(): QSurfaceTools | null {
  return useContext(QSurfaceToolsContext);
}
