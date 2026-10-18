"use client";

import { useSyncExternalStore } from "react";

import type { QMotion } from "./aperture-frame";

/**
 * "Q motion: Full · Calm · Off" (spec §5.3, WCAG 2.2.2): the person's own
 * say over Q's light, beside the theme. Stored the way the theme is — in
 * this browser, read as an external store — and combined with what the
 * device asks for:
 *
 * - `prefers-reduced-motion` turns Full into Calm (static light; state is
 *   still carried by brightness steps and the label);
 * - `prefers-reduced-transparency` and `prefers-contrast: more` remove the
 *   bloom and the edge light, leaving a solid ring;
 * - forced colours, Save-Data and low-memory devices draw the SVG ring and
 *   never start the shader.
 */

export const Q_MOTION_CHOICES = ["full", "calm", "off"] as const;
export const Q_MOTION_STORAGE_KEY = "cq.q-motion";

export const Q_MOTION_LABELS: Readonly<Record<QMotion, string>> = {
  full: "Full",
  calm: "Calm",
  off: "Off",
};

function isQMotion(value: unknown): value is QMotion {
  return (
    typeof value === "string" &&
    (Q_MOTION_CHOICES as readonly string[]).includes(value)
  );
}

export function readStoredQMotion(): QMotion {
  try {
    const stored = window.localStorage.getItem(Q_MOTION_STORAGE_KEY);
    return isQMotion(stored) ? stored : "full";
  } catch {
    return "full";
  }
}

const listeners = new Set<() => void>();

export function storeQMotion(choice: QMotion): void {
  try {
    if (choice === "full") {
      window.localStorage.removeItem(Q_MOTION_STORAGE_KEY);
    } else {
      window.localStorage.setItem(Q_MOTION_STORAGE_KEY, choice);
    }
  } catch {
    // Applies to this page; it simply will not be remembered.
  }
  for (const listener of listeners) listener();
}

const QUERIES = {
  reducedMotion: "(prefers-reduced-motion: reduce)",
  reducedTransparency: "(prefers-reduced-transparency: reduce)",
  moreContrast: "(prefers-contrast: more)",
  forcedColors: "(forced-colors: active)",
} as const;

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  const fromAnotherTab = (event: StorageEvent) => {
    if (event.key === Q_MOTION_STORAGE_KEY) onChange();
  };
  window.addEventListener("storage", fromAnotherTab);
  const media =
    typeof window.matchMedia === "function"
      ? Object.values(QUERIES).map((query) => window.matchMedia(query))
      : [];
  for (const list of media) list.addEventListener("change", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", fromAnotherTab);
    for (const list of media) list.removeEventListener("change", onChange);
  };
}

/** What the aperture should do here, now. */
export type QMotionEnvironment = {
  /** The person's own choice, as the control shows it. */
  readonly choice: QMotion;
  /** After the device's preferences. */
  readonly motion: QMotion;
  /** Bloom and edge light allowed. */
  readonly bloom: boolean;
  /** The shader may start; otherwise the SVG ring stays. */
  readonly gpu: boolean;
};

type NavigatorHints = {
  readonly connection?: { readonly saveData?: boolean } | undefined;
  readonly deviceMemory?: number | undefined;
};

function lightDevice(): boolean {
  const hints = navigator as Navigator & NavigatorHints;
  if (hints.connection?.saveData === true) return true;
  return hints.deviceMemory !== undefined && hints.deviceMemory < 4;
}

// One snapshot object per distinct answer, so useSyncExternalStore sees a
// stable value between changes.
const cache = new Map<string, QMotionEnvironment>();

function snapshot(): QMotionEnvironment {
  const choice = readStoredQMotion();
  // A host with no media queries (a test DOM) asks for nothing special.
  const matches = (query: string) =>
    typeof window.matchMedia === "function" && window.matchMedia(query).matches;
  const forced = matches(QUERIES.forcedColors);
  const motion: QMotion =
    choice === "full" && matches(QUERIES.reducedMotion) ? "calm" : choice;
  const bloom =
    !forced &&
    !matches(QUERIES.reducedTransparency) &&
    !matches(QUERIES.moreContrast);
  const gpu = motion !== "off" && !forced && !lightDevice();
  const key = `${choice}|${motion}|${String(bloom)}|${String(gpu)}`;
  let value = cache.get(key);
  if (value === undefined) {
    value = { choice, motion, bloom, gpu };
    cache.set(key, value);
  }
  return value;
}

/**
 * Server and first client render: the SVG ring with its bloom. CSS stills
 * its one animation under reduced motion until the real answer arrives.
 */
const SERVER: QMotionEnvironment = {
  choice: "full",
  motion: "full",
  bloom: true,
  gpu: false,
};

export function useQMotion(): QMotionEnvironment {
  return useSyncExternalStore(subscribe, snapshot, () => SERVER);
}
