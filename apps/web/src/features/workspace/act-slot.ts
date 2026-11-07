"use client";

import { useSyncExternalStore } from "react";

/**
 * Where Q's confirm and approval prompts sit in the Q Workspace (batch 8,
 * owner replay: the approval floated over the Q pane's messages and the
 * page). The Q pane registers a slot directly above its controls; the
 * prompts are drawn there, in the pane's flow and at its width, so the
 * thread above shrinks rather than being covered. No slot (the workspace
 * is off), or a phone (the page may be a sheet over the Q pane, which would
 * hide the prompt): the prompts keep their floating place, over both.
 */
let slot: HTMLElement | null = null;
const listeners = new Set<() => void>();

export function registerActSlot(element: HTMLElement | null): void {
  if (slot === element) return;
  slot = element;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The workspace's phone layout (workspace-panes PHONE_QUERY). */
const PHONE = "(max-width: 860px)";

function subscribePhone(onChange: () => void): () => void {
  if (typeof window.matchMedia !== "function") return () => undefined;
  const query = window.matchMedia(PHONE);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

export function useActSlot(): HTMLElement | null {
  const registered = useSyncExternalStore(
    subscribe,
    () => slot,
    () => null,
  );
  const phone = useSyncExternalStore(
    subscribePhone,
    () =>
      typeof window.matchMedia === "function" &&
      window.matchMedia(PHONE).matches,
    () => false,
  );
  return phone ? null : registered;
}
