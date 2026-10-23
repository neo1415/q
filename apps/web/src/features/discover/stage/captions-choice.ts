"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Whether pitch captions are shown (Discover): client-only, remembered per
 * device like the playback speed. Some pitches carry captions burned into
 * the picture, and the overlay then doubles them (QA F-31, live 23
 * Oct); a viewer who turns ours off should not have to again on every
 * visit. It never leaves the browser and is not a signal about a company.
 */
const STORAGE_KEY = "cq.discover.captions";
const listeners = new Set<() => void>();
let memory: boolean | null = null;

export function readCaptionsOn(): boolean {
  if (memory !== null) return memory;
  try {
    // Storage can be blocked or cleared; captions on is the accessible default.
    memory = window.localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    memory = true;
  }
  return memory;
}

export function writeCaptionsOn(on: boolean): void {
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

export function useCaptionsChoice(): readonly [
  boolean,
  (next: boolean | ((on: boolean) => boolean)) => void,
] {
  const on = useSyncExternalStore(subscribe, readCaptionsOn, () => true);
  // Like a state setter: a value, or a function of the current choice.
  const set = useCallback(
    (next: boolean | ((on: boolean) => boolean)) =>
      writeCaptionsOn(
        typeof next === "function" ? next(readCaptionsOn()) : next,
      ),
    [],
  );
  return [on, set] as const;
}

/** For tests: forget the remembered choice. */
export function resetCaptionsChoiceForTests(): void {
  memory = null;
}
