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

/**
 * Where the running listener's words are recognised: DEVICE when the
 * browser was told to keep recognition on this device (`processLocally`),
 * SERVICE when it may use its vendor's speech service. Null while nothing
 * runs.
 */
export type WakeProcessing = "DEVICE" | "SERVICE";

let status: WakeStatus = OFF;
let processing: WakeProcessing | null = null;
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

export function setWakeProcessing(next: WakeProcessing | null): void {
  if (processing === next) return;
  processing = next;
  emit();
}

export function wakeProcessing(): WakeProcessing | null {
  return processing;
}

export function useWakeProcessing(): WakeProcessing | null {
  return useSyncExternalStore(subscribe, wakeProcessing, () => null);
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
  processing = null;
  pausedByYou = false;
  emit();
}
