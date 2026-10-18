"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Pitch sound, one policy for every feed player (Discover and Explore's
 * viewer; ADR 0026 as extended by ADR 0064).
 *
 * - Sound is on by default, every session. Only an explicit mute is
 *   remembered, and only for this browser session, so the next visit
 *   starts with sound again (founder 2026-10-08: "Discover sound must be on
 *   every time"; Explore was muted by a hard-coded default).
 * - Reduced motion keeps audio off until the person turns it on (ADR-001
 *   D5); their turning it on is remembered the same way.
 * - The browser may refuse audible playback before the person has
 *   interacted with the page. The player then plays muted and the first
 *   interaction that gives the page user activation turns the sound on by
 *   itself. A swipe that scrolls is not activation in any browser, which is
 *   why the old listener (pointerdown only, unchecked) could unmute into a
 *   paused video, or never fire on a phone; this one checks.
 */

const KEY = "cq-pitch-sound";

type Choice = "muted" | "on" | null;

function read(): Choice {
  try {
    const value = window.sessionStorage.getItem(KEY);
    return value === "muted" || value === "on" ? value : null;
  } catch {
    return null;
  }
}

let choice: Choice | undefined;
const listeners = new Set<() => void>();

function current(): Choice {
  if (choice === undefined)
    choice = typeof window === "undefined" ? null : read();
  return choice;
}

/** Whether the pitch should be muted, before the browser has its say. */
export function soundMuted(chosen: Choice, reducedMotion: boolean): boolean {
  if (chosen === "muted") return true;
  if (chosen === "on") return false;
  return reducedMotion;
}

export function chooseSound(muted: boolean): void {
  choice = muted ? "muted" : "on";
  try {
    window.sessionStorage.setItem(KEY, choice);
  } catch {
    // Without storage the choice holds for this page only.
  }
  for (const listener of listeners) listener();
}

/** For tests. */
export function resetSoundChoiceForTests(): void {
  choice = undefined;
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    // Nothing stored.
  }
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

/** The feed's sound: muted or not, and the person's explicit choice. */
export function useFeedSound(reducedMotion: boolean): {
  readonly muted: boolean;
  readonly setMuted: (muted: boolean) => void;
  readonly toggle: () => void;
} {
  const chosen = useSyncExternalStore(subscribe, current, () => null);
  const muted = soundMuted(chosen, reducedMotion);
  const toggle = useCallback(() => chooseSound(!muted), [muted]);
  return { muted, setMuted: chooseSound, toggle };
}

/** `navigator.userActivation.hasBeenActive`, or null where unsupported. */
export function hasBeenActive(): boolean | null {
  if (typeof navigator === "undefined") return null;
  const value: unknown = Reflect.get(navigator, "userActivation");
  if (typeof value !== "object" || value === null) return null;
  const active: unknown = Reflect.get(value, "hasBeenActive");
  return typeof active === "boolean" ? active : null;
}

/**
 * True when audible playback may be allowed: the page has had user
 * activation, or the browser cannot say (then playing is the only test).
 */
export function audioMayPlay(): boolean {
  return hasBeenActive() ?? true;
}

const UNLOCK_EVENTS = [
  "pointerdown",
  "pointerup",
  "touchend",
  "keydown",
  "click",
] as const;

/**
 * Calls `onUnlock` once, at the first interaction after which the browser
 * allows sound. Returns the unsubscribe.
 */
export function onAudioUnlock(onUnlock: () => void): () => void {
  let done = false;
  const check = (event: Event) => {
    if (done) return;
    // The sound control answers its own tap; restoring here as well would
    // be undone by its toggle.
    if (
      event.target instanceof Element &&
      event.target.closest("[data-sound-toggle]") !== null
    ) {
      return;
    }
    // Activation is granted by the event's default handling; read it after.
    window.setTimeout(() => {
      if (done || !audioMayPlay()) return;
      done = true;
      stop();
      onUnlock();
    }, 0);
  };
  const options = { capture: true, passive: true } as const;
  const stop = () => {
    for (const type of UNLOCK_EVENTS) {
      window.removeEventListener(type, check, options);
    }
  };
  for (const type of UNLOCK_EVENTS) {
    window.addEventListener(type, check, options);
  }
  return () => {
    done = true;
    stop();
  };
}
