"use client";

import { useSyncExternalStore } from "react";

/**
 * D2: "Say 'Hey Q' to start", per device and OFF by default. A laptop and
 * a phone are different rooms, so the choice is kept by this browser only
 * (a per-viewer convenience). Where storage is unavailable the choice
 * holds for this visit.
 */

export const WAKE_PREFERENCE_KEY = "cq.q.wake";
const CHANGED = "cq:wake-preference";

let memory = false;

export function readWakePreference(): boolean {
  try {
    const stored = window.localStorage.getItem(WAKE_PREFERENCE_KEY);
    return stored === null ? memory : stored === "on";
  } catch {
    return memory;
  }
}

export function storeWakePreference(on: boolean): void {
  memory = on;
  try {
    window.localStorage.setItem(WAKE_PREFERENCE_KEY, on ? "on" : "off");
  } catch {
    // Not remembered: this visit still uses the choice.
  }
  window.dispatchEvent(new Event(CHANGED));
}

function subscribe(onChange: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === WAKE_PREFERENCE_KEY) onChange();
  };
  window.addEventListener(CHANGED, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGED, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

export function useWakePreference(): boolean {
  return useSyncExternalStore(subscribe, readWakePreference, () => false);
}
