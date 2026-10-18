"use client";

import { useSyncExternalStore } from "react";

/**
 * What the wake word is doing in this tab, for the shell's indicator and
 * the Settings toggle. Module state: a tab has one microphone and one
 * listener.
 *
 * - OFF: not listening (toggle off, or nothing started yet).
 * - LISTENING: the microphone is open and the local gate is waiting.
 * - HEARING: the gate opened a short window (speech is being checked).
 * - PAUSED: on, but not now (`reason` says why).
 * - BLOCKED: the browser refused the microphone or speech recognition.
 * - UNAVAILABLE: this browser cannot run it.
 */

export type WakePauseReason = "HIDDEN" | "IN_CALL" | "BATTERY" | "BY_YOU";

export type WakeStatus =
  | { readonly kind: "OFF" }
  | { readonly kind: "LISTENING" }
  | { readonly kind: "HEARING" }
  | { readonly kind: "PAUSED"; readonly reason: WakePauseReason }
  | { readonly kind: "BLOCKED" }
  | { readonly kind: "UNAVAILABLE" };

const OFF: WakeStatus = { kind: "OFF" };

let status: WakeStatus = OFF;
let pausedByYou = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function setWakeStatus(next: WakeStatus): void {
  if (
    next.kind === status.kind &&
    (next.kind !== "PAUSED" ||
      (status.kind === "PAUSED" && status.reason === next.reason))
  ) {
    return;
  }
  status = next;
  emit();
}

export function wakeStatus(): WakeStatus {
  return status;
}

/** The indicator's tap: pause for this tab, or listen again. */
export function setWakePausedByYou(paused: boolean): void {
  if (pausedByYou === paused) return;
  pausedByYou = paused;
  emit();
}

export function wakePausedByYou(): boolean {
  return pausedByYou;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useWakeStatus(): WakeStatus {
  return useSyncExternalStore(subscribe, wakeStatus, () => OFF);
}

export function useWakePausedByYou(): boolean {
  return useSyncExternalStore(subscribe, wakePausedByYou, () => false);
}

/** Tests only. */
export function resetWakeStatus(): void {
  status = OFF;
  pausedByYou = false;
  emit();
}
