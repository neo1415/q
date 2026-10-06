"use client";

import { useSyncExternalStore } from "react";

import type { NotificationDto } from "@capital-q/contracts";

import { retryWithBackoff } from "@/pwa/resilient";

import { listNoticesAction } from "./work-actions";

/**
 * One notification read for the whole shell (design-48).
 *
 * The bell is mounted twice -- the phone header and the desktop sidebar,
 * one hidden by CSS -- and each read the list on mount, on focus and on
 * visibility. Server actions run one at a time per tab, so on every page
 * those duplicate reads queued ahead of the page's own work (measured on
 * production /settings, 2026-10-03: the list was read 3 times in the first
 * 4 s, among 7 queued actions). Both bells now share this store: one read
 * in flight at most, and none again within FRESH_MS.
 */

const POLL_MS = 60_000;
const FRESH_MS = 5_000;
/**
 * P9: the first read waits for the page to settle. Server actions queue
 * one at a time, so a bell read sent with the first paint sat in front of
 * the page's own reads on a slow line.
 */
const FIRST_READ_DELAY_MS = 1_500;

export type NoticeState = {
  readonly items: readonly NotificationDto[] | null;
  readonly unread: number;
  readonly failed: boolean;
  /** P3: the cursor for older notices; null when there are none. */
  readonly nextBefore?: string | null;
};

let state: NoticeState = { items: null, unread: 0, failed: false };
let loadedAt = 0;
let inFlight: Promise<void> | null = null;
const listeners = new Set<() => void>();
let timer: number | undefined;

function emit(next: NoticeState): void {
  state = next;
  for (const listener of listeners) listener();
}

/** Reads the list unless a read is running or one just finished. */
export function refreshNotices(force = false): Promise<void> {
  if (inFlight !== null) return inFlight;
  if (!force && Date.now() - loadedAt < FRESH_MS) return Promise.resolve();
  // A dropped connection is retried with backoff (and waits while the
  // browser is offline); what was shown stays shown meanwhile.
  inFlight = retryWithBackoff(() => listNoticesAction(), {
    attempts: 3,
    timeoutMs: 20_000,
  })
    // A thrown action (deploy skew, signed-out tab) is a failed load,
    // never an unhandled rejection.
    .catch(() => null)
    .then((result) => {
      loadedAt = Date.now();
      emit(
        result?.ok === true
          ? {
              items: result.value.items,
              unread: result.value.unread,
              failed: false,
              nextBefore: result.value.nextBefore ?? null,
            }
          : { ...state, failed: true },
      );
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/**
 * P3: the next older page, by cursor (never offset), appended. A refresh
 * starts again from the newest.
 */
export async function loadOlderNotices(): Promise<void> {
  const before = state.nextBefore;
  if (before === undefined || before === null || state.items === null) return;
  const result = await listNoticesAction(before).catch(() => null);
  if (result?.ok !== true) return;
  const seen = new Set(state.items.map((item) => item.id));
  emit({
    ...state,
    items: [
      ...state.items,
      ...result.value.items.filter((item) => !seen.has(item.id)),
    ],
    nextBefore: result.value.nextBefore ?? null,
  });
}

/** Marks some as read locally, after the server said so. */
export function noticesRead(count: number): void {
  emit({ ...state, unread: Math.max(0, state.unread - count) });
}

const onVisible = () => {
  if (document.visibilityState === "visible" && navigator.onLine !== false) {
    void refreshNotices();
  }
};
const onOnline = () => void refreshNotices(true);
let firstRead: number | undefined;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    firstRead = window.setTimeout(() => {
      if ("requestIdleCallback" in window) {
        window.requestIdleCallback(() => void refreshNotices(), {
          timeout: 2_000,
        });
      } else {
        void refreshNotices();
      }
    }, FIRST_READ_DELAY_MS);
    timer = window.setInterval(onVisible, POLL_MS);
    window.addEventListener("focus", onVisible);
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      window.clearTimeout(firstRead);
      window.clearInterval(timer);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
    }
  };
}

const EMPTY: NoticeState = { items: null, unread: 0, failed: false };

export function useNotices(): NoticeState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => EMPTY,
  );
}

/** Tests only: a fresh store. */
export function resetNoticeStore(): void {
  state = EMPTY;
  loadedAt = 0;
  inFlight = null;
}
