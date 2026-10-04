"use client";

import { useSyncExternalStore } from "react";

import {
  Q_VOICE_LISTENING_DEFAULT,
  QVoiceListeningLevelSchema,
  type QVoiceListeningLevel,
} from "@capital-q/contracts";

/**
 * BACKCHANNEL: this device's listening-sounds toggle (Settings → Voice).
 *
 * Kept with the moment it was set, because the person can also change it
 * by voice ("stop doing that"), which Q remembers for them on the server
 * through the memory Write Gate; a line uses whichever was set last
 * (`resolveListeningLevel`). A change by voice is written here too, so
 * this device's toggle shows it at once. Storage is a convenience: when
 * it is unavailable the remembered level or the default applies.
 */

export const LISTENING_PREFERENCE_KEY = "cq.q.listening";
const CHANGED = "cq:listening-preference";

export type DeviceListening = {
  readonly level: QVoiceListeningLevel;
  readonly setAt: string;
};

let cachedRaw: string | null = null;
let cached: DeviceListening | null = null;

export function readListeningPreference(): DeviceListening | null {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(LISTENING_PREFERENCE_KEY);
  } catch {
    return null;
  }
  // The same object for the same stored text: a stable external store.
  if (raw === cachedRaw) return cached;
  cachedRaw = raw;
  cached = null;
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    const level = QVoiceListeningLevelSchema.safeParse(
      (value as { level?: unknown } | null)?.level,
    );
    const setAt = (value as { setAt?: unknown } | null)?.setAt;
    if (
      level.success &&
      typeof setAt === "string" &&
      !Number.isNaN(Date.parse(setAt))
    ) {
      cached = { level: level.data, setAt };
    }
  } catch {
    cached = null;
  }
  return cached;
}

export function storeListeningPreference(
  level: QVoiceListeningLevel,
  setAt: Date = new Date(),
): void {
  try {
    window.localStorage.setItem(
      LISTENING_PREFERENCE_KEY,
      JSON.stringify({ level, setAt: setAt.toISOString() }),
    );
  } catch {
    // Not remembered on this device: the line still uses it now.
  }
  window.dispatchEvent(new Event(CHANGED));
}

function subscribe(onChange: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === LISTENING_PREFERENCE_KEY) onChange();
  };
  window.addEventListener(CHANGED, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGED, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/** This device's level, for the toggle (the default when never set). */
export function useListeningPreference(): QVoiceListeningLevel {
  return useSyncExternalStore(
    subscribe,
    () => readListeningPreference()?.level ?? Q_VOICE_LISTENING_DEFAULT,
    () => Q_VOICE_LISTENING_DEFAULT,
  );
}

/** Subscribe outside React (the open line follows the toggle at once). */
export function onListeningPreferenceChange(handler: () => void): () => void {
  return subscribe(handler);
}
