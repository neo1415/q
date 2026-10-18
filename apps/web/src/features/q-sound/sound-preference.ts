"use client";

import { useSyncExternalStore } from "react";

import {
  DEFAULT_SOUND_MODE,
  parseSoundMode,
  type SoundMode,
} from "./sound-rules";

/**
 * Q's sounds on this device: On, Quiet or Off (I2). A per-viewer
 * convenience, like the theme and Q motion: kept in this browser only and
 * read as an external store, so Settings and every Q surface agree at
 * once. If storage is unavailable the default (Quiet) is used.
 */

export const SOUND_PREFERENCE_KEY = "cq.q.sounds";
const CHANGED = "cq:sound-preference";

export function readSoundPreference(): SoundMode {
  try {
    return parseSoundMode(window.localStorage.getItem(SOUND_PREFERENCE_KEY));
  } catch {
    return DEFAULT_SOUND_MODE;
  }
}

export function storeSoundPreference(mode: SoundMode): void {
  try {
    window.localStorage.setItem(SOUND_PREFERENCE_KEY, mode);
  } catch {
    // Not remembered: this visit still uses the choice.
  }
  window.dispatchEvent(new Event(CHANGED));
}

function subscribe(onChange: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === SOUND_PREFERENCE_KEY) onChange();
  };
  window.addEventListener(CHANGED, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGED, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

export function useSoundPreference(): SoundMode {
  return useSyncExternalStore(
    subscribe,
    readSoundPreference,
    () => DEFAULT_SOUND_MODE,
  );
}
