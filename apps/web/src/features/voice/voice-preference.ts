"use client";

import { useSyncExternalStore } from "react";

import type { QVoiceChoice } from "@capital-q/contracts";

/**
 * Which voice Q speaks in, remembered on this device (R28).
 *
 * A per-viewer convenience, like the theme: kept in this browser only, read
 * as an external store so the Settings page and the Q page agree at once
 * (the same tab is told through an event, other tabs through `storage`).
 * If storage is unavailable the default voice is used and nothing breaks.
 */

export const VOICE_PREFERENCE_KEY = "cq.q.voice";
const CHANGED = "cq:voice-preference";
const DEFAULT_VOICE: QVoiceChoice = "FEMALE";

export function readVoicePreference(): QVoiceChoice {
  try {
    const stored = window.localStorage.getItem(VOICE_PREFERENCE_KEY);
    return stored === "MALE" || stored === "FEMALE" ? stored : DEFAULT_VOICE;
  } catch {
    return DEFAULT_VOICE;
  }
}

export function storeVoicePreference(voice: QVoiceChoice): void {
  try {
    window.localStorage.setItem(VOICE_PREFERENCE_KEY, voice);
  } catch {
    // Not remembered: this visit still uses the choice.
  }
  window.dispatchEvent(new Event(CHANGED));
}

function subscribe(onChange: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === VOICE_PREFERENCE_KEY) onChange();
  };
  window.addEventListener(CHANGED, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGED, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

export function useVoicePreference(): QVoiceChoice {
  return useSyncExternalStore(
    subscribe,
    readVoicePreference,
    () => DEFAULT_VOICE,
  );
}
