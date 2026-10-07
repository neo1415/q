"use client";

import { useSyncExternalStore } from "react";

/**
 * Q room W3: where the document Q opened is shown. While the Q room is on
 * screen it registers its centre panel here and the document opens in it;
 * anywhere else it opens in the full-screen sheet, as before. Whether a
 * document is open is published too, so the room makes space for it.
 */

let host: HTMLElement | null = null;
let open = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function registerRoomDocumentHost(element: HTMLElement | null): void {
  if (host === element) return;
  host = element;
  emit();
}

export function useRoomDocumentHost(): HTMLElement | null {
  return useSyncExternalStore(
    subscribe,
    () => host,
    () => null,
  );
}

export function setRoomDocumentOpen(next: boolean): void {
  if (open === next) return;
  open = next;
  emit();
}

export function useRoomDocumentOpen(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => open,
    () => false,
  );
}
