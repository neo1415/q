"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * "Read answers aloud" (owner directive 2026-11-04, A6): whether Q's
 * answers to typed turns are spoken by the one-way voice (`/api/q-speech`).
 *
 * Off by default. A typed conversation is a written one: the 4 Nov
 * rehearsal sent 16 paid speech requests for 5 typed turns, and the
 * owner heard the one-way voice as Q's voice changing. This replaces the
 * earlier code-level rule "answers on this page are heard". A live voice
 * conversation speaks its own lines and is unaffected; this choice only
 * opts typed answers in.
 *
 * Client-only and remembered per device, like the captions choice. It
 * never leaves the browser. Storage can be blocked or cleared: then the
 * choice lasts for this page and the default (silent) applies next time.
 */
const STORAGE_KEY = "cq.q.readAloud";
const listeners = new Set<() => void>();
let memory: boolean | null = null;

export function readAloudOn(): boolean {
  if (memory !== null) return memory;
  try {
    memory = window.localStorage.getItem(STORAGE_KEY) === "on";
  } catch {
    memory = false;
  }
  return memory;
}

export function writeReadAloudOn(on: boolean): void {
  memory = on;
  try {
    window.localStorage.setItem(STORAGE_KEY, on ? "on" : "off");
  } catch {
    // A private window keeps the choice for this page only.
  }
  for (const listener of listeners) listener();
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

/** The server renders silent: nothing is spoken before the page knows. */
export function useReadAloudChoice(): readonly [
  boolean,
  (on: boolean) => void,
] {
  const on = useSyncExternalStore(subscribe, readAloudOn, () => false);
  const set = useCallback((next: boolean) => writeReadAloudOn(next), []);
  return [on, set] as const;
}

/**
 * Whether the one-way voice says this answer. A live call speaks for
 * itself; a turn typed into an open call was made a written one (owner
 * 2026-11-03); otherwise only the viewer's explicit choice turns it on.
 */
export function speakTypedAnswer(input: {
  readonly readAloud: boolean;
  readonly voiceActive: boolean;
  readonly written: boolean;
}): boolean {
  return input.readAloud && !input.voiceActive && !input.written;
}

/** For tests: forget the remembered choice. */
export function resetReadAloudChoiceForTests(): void {
  memory = null;
}
