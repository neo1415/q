"use client";

import type { ReactNode } from "react";
import { createPortal } from "react-dom";

import { usePhoneWorkspace } from "@/features/workspace/workspace-panes";

/**
 * Where the story draws (live 2026-11-15, /q-pitch at 390): the host is
 * mounted with the page, and on a phone the page is a sheet that is
 * hidden (visibility: hidden, inert, moved off screen) while Q's home
 * shows. The story's stage, captions and controls inherited that: the
 * narration played over Q's home with no way to pause, skip or end. On a
 * phone the story is drawn at the document's top level instead, so it
 * shows whatever the sheet is doing. A desktop keeps it in the page pane,
 * where it reads the pane's own sizes.
 */
export function StoryLayer({ children }: { readonly children: ReactNode }) {
  const phone = usePhoneWorkspace();
  return phone ? createPortal(children, document.body) : children;
}
