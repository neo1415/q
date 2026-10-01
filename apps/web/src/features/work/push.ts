"use client";

import {
  pushKeyAction,
  subscribePushAction,
  unsubscribePushAction,
} from "./work-actions";

/**
 * Web Push on this device (AUTO, ADR 0030; spec auto.md §3.5).
 *
 * - iOS/iPadOS 16.4+ allow it only for Capital Q added to the Home Screen
 *   (standalone); in Safari tabs the person is told how, not prompted.
 * - Permission is asked only from the person's own tap (a soft ask first,
 *   then the browser's prompt), never on load.
 */

export type PushState =
  "UNSUPPORTED" | "NEEDS_INSTALL" | "BLOCKED" | "OFF" | "ON";

function isIos(): boolean {
  const agent = navigator.userAgent;
  return (
    /iPad|iPhone|iPod/.test(agent) ||
    (agent.includes("Macintosh") && navigator.maxTouchPoints > 1)
  );
}

function standalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    ("standalone" in navigator &&
      (navigator as Navigator & { standalone?: boolean }).standalone === true)
  );
}

export async function pushState(): Promise<PushState> {
  if (typeof window === "undefined") return "UNSUPPORTED";
  const supported =
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window;
  if (!supported) {
    return isIos() && !standalone() ? "NEEDS_INSTALL" : "UNSUPPORTED";
  }
  if (Notification.permission === "denied") return "BLOCKED";
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  return subscription === null || subscription === undefined ? "OFF" : "ON";
}

function keyBytes(base64Url: string): Uint8Array<ArrayBuffer> {
  const padded = `${base64Url}${"=".repeat((4 - (base64Url.length % 4)) % 4)}`
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let index = 0; index < raw.length; index += 1) {
    bytes[index] = raw.charCodeAt(index);
  }
  return bytes;
}

/** Call only from a tap: the browser's own prompt follows. */
export async function enablePush(): Promise<{
  readonly ok: boolean;
  readonly message: string | null;
}> {
  const key = await pushKeyAction();
  if (!key.ok || key.value === null) {
    return { ok: false, message: "Capital Q can't send pushes just now." };
  }
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    return {
      ok: false,
      message:
        permission === "denied"
          ? "Pushes are blocked for Capital Q in this browser's settings."
          : null,
    };
  }
  const registration = await navigator.serviceWorker.ready;
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyBytes(key.value),
    }));
  const saved = await subscribePushAction(subscription.toJSON());
  if (!saved.ok) {
    await subscription.unsubscribe().catch(() => false);
    return { ok: false, message: saved.message };
  }
  return { ok: true, message: null };
}

export async function disablePush(): Promise<void> {
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (subscription === null || subscription === undefined) return;
  await unsubscribePushAction(subscription.endpoint);
  await subscription.unsubscribe().catch(() => false);
}
