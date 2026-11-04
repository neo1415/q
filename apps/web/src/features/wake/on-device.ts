"use client";

import { useSyncExternalStore } from "react";

import {
  recognitionConstructor,
  recognitionLanguage,
  supportsProcessLocally,
} from "./support";

/**
 * On-device recognition for "Hey Q" (ADR 0058 addendum 2026-11-04).
 *
 * The Web Speech API draft (webaudio.github.io/web-speech-api) gives
 * SpeechRecognition a `processLocally` attribute and two static methods:
 * `available({ langs, processLocally })` resolving to "unavailable" |
 * "downloadable" | "downloading" | "available", and `install(...)`
 * resolving to a boolean (it rejects without a user gesture). Chrome ships
 * them; others may not. Everything here is feature-detected: a missing
 * method, a throw or an unexpected value means "unavailable", which keeps
 * today's behaviour and today's disclosure.
 *
 * Installing downloads a language pack, so it happens only from the
 * person's own click (`requestOnDeviceInstall`), never on its own.
 */

export type OnDeviceStatus =
  "available" | "downloadable" | "downloading" | "unavailable";

const STATUSES: readonly string[] = [
  "available",
  "downloadable",
  "downloading",
  "unavailable",
];

function isStatus(value: unknown): value is OnDeviceStatus {
  return typeof value === "string" && STATUSES.includes(value);
}

function wakeLanguage(): string {
  return recognitionLanguage(
    typeof navigator === "undefined" ? undefined : navigator.language,
  );
}

/** The recogniser's static method `name`, where it has one with the attribute. */
function staticMethod(name: "available" | "install"): {
  readonly call: (options: unknown) => unknown;
} | null {
  const Ctor = recognitionConstructor();
  if (Ctor === null || !supportsProcessLocally(Ctor)) return null;
  const method: unknown = Reflect.get(Ctor, name);
  if (typeof method !== "function") return null;
  return {
    call: (options) => {
      const result: unknown = Reflect.apply(method, Ctor, [options]);
      return result;
    },
  };
}

/** Whether on-device recognition is ready for `lang` on this browser. */
export async function onDeviceAvailability(
  lang: string = wakeLanguage(),
): Promise<OnDeviceStatus> {
  const available = staticMethod("available");
  if (available === null) return "unavailable";
  try {
    const result: unknown = await available.call({
      langs: [lang],
      processLocally: true,
    });
    return isStatus(result) ? result : "unavailable";
  } catch {
    return "unavailable";
  }
}

/**
 * Ask the browser to download the on-device pack for `lang`. Must be
 * called synchronously inside the click handler: `install()` needs the
 * click's transient activation. False on any absence, refusal or throw.
 */
export function installOnDevice(
  lang: string = wakeLanguage(),
): Promise<boolean> {
  const install = staticMethod("install");
  if (install === null) return Promise.resolve(false);
  try {
    return Promise.resolve(
      install.call({ langs: [lang], processLocally: true }),
    ).then(
      (result) => result === true,
      () => false,
    );
  } catch {
    return Promise.resolve(false);
  }
}

/* ---- the tab's view of it, for Settings and the listener ---- */

/** null: not checked yet. */
let status: OnDeviceStatus | null = null;
let installFailed = false;
let checking: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function set(next: OnDeviceStatus, failed = installFailed): void {
  if (status === next && installFailed === failed) return;
  status = next;
  installFailed = failed;
  emit();
}

/** Check again (on mount, after an install). Concurrent calls share one check. */
export function refreshOnDevice(): Promise<void> {
  checking ??= onDeviceAvailability()
    .then((next) => set(next))
    .finally(() => {
      checking = null;
    });
  return checking;
}

/** The "Use on-device listening" click: install, then re-check. */
export function requestOnDeviceInstall(): Promise<void> {
  // Called before any await, so the click's activation reaches install().
  const installing = installOnDevice();
  set("downloading", false);
  return installing.then(async (ok) => {
    await refreshOnDevice();
    if (!ok && status !== "available") set(status ?? "unavailable", true);
  });
}

export function onDeviceStatus(): OnDeviceStatus | null {
  return status;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (status === null) void refreshOnDevice();
  return () => listeners.delete(listener);
}

export function useOnDeviceStatus(): OnDeviceStatus | null {
  return useSyncExternalStore(subscribe, onDeviceStatus, () => null);
}

export function useOnDeviceInstallFailed(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => installFailed,
    () => false,
  );
}

/** Tests only. */
export function resetOnDevice(): void {
  status = null;
  installFailed = false;
  checking = null;
  emit();
}
