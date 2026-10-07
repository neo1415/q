"use client";

import { useEffect, useRef } from "react";

import { retryWithBackoff } from "@/pwa/resilient";

/**
 * Q room W6 (R9): how the room reads what it shows (a card, a document, a
 * deck) on a weak network. One read, one retry after a short backoff, then
 * the surface says "Couldn't load — try again" with a button: never an
 * endless spinner. An answer (a refusal, a document without slides) is
 * not a failure and is never retried; only a thrown read is.
 *
 * Offline does not hold the read open (the surface fails fast and says
 * so); coming back online retries a failed surface by itself.
 */
export const ROOM_READ = {
  attempts: 2,
  baseMs: 700,
  maxMs: 1_500,
  timeoutMs: 20_000,
} as const;

export function roomRead<T>(
  read: () => Promise<T>,
  options: {
    readonly timeoutMs?: number;
    /** Injected in tests. */
    readonly sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<T> {
  return retryWithBackoff(() => read(), {
    attempts: ROOM_READ.attempts,
    baseMs: ROOM_READ.baseMs,
    maxMs: ROOM_READ.maxMs,
    timeoutMs: options.timeoutMs ?? ROOM_READ.timeoutMs,
    // A read that threw is worth one more try, whatever it threw.
    shouldRetry: () => true,
    // Never parked waiting for `online`: the surface says it failed.
    isOnline: () => true,
    // The second try comes after at least half the backoff, never at once.
    random: () => 0.5 + Math.random() / 2,
    ...(options.sleep === undefined ? {} : { sleep: options.sleep }),
  });
}

/** An upload the connection dropped twice: the caller says so clearly. */
export const UPLOAD_DROPPED = Symbol("upload-dropped");

/**
 * Q room W7: one dropped file's upload, kept across every retry of it
 * (the automatic one and "Try again"). The keys make the server replay
 * rather than repeat; the steps already done are not run again, so a
 * retry after a lost "complete" completes the same upload session and
 * never creates a second document.
 */
export type UploadDrop = {
  readonly key: string;
  readonly completeKey: string;
  target: UploadDropTarget | null;
  sent: boolean;
};

export type UploadDropTarget = {
  readonly uploadSessionId: string;
  readonly url: string;
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
};

export function newUploadDrop(): UploadDrop {
  return {
    key: crypto.randomUUID(),
    completeKey: crypto.randomUUID(),
    target: null,
    sent: false,
  };
}

/**
 * The three steps of an upload, resumed where the last run stopped. A
 * refusal (a step answering no) is null; a dropped connection throws and
 * leaves the drop where it was, for the next run.
 */
export async function runUploadDrop(
  drop: UploadDrop,
  steps: {
    readonly target: (key: string) => Promise<UploadDropTarget | null>;
    readonly put: (target: UploadDropTarget) => Promise<boolean>;
    readonly complete: (
      uploadSessionId: string,
      key: string,
    ) => Promise<string | null>;
  },
): Promise<string | null> {
  if (drop.target === null) {
    const target = await steps.target(drop.key);
    if (target === null) return null;
    drop.target = target;
  }
  if (!drop.sent) {
    if (!(await steps.put(drop.target))) return null;
    drop.sent = true;
  }
  return steps.complete(drop.target.uploadSessionId, drop.completeKey);
}

const RESUME_WAIT_MS = 120_000;

function waitUntilOnline(ms: number): Promise<boolean> {
  if (typeof window === "undefined" || navigator.onLine !== false) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    const done = (online: boolean) => {
      window.clearTimeout(timer);
      window.removeEventListener("online", onOnline);
      resolve(online);
    };
    const onOnline = () => done(true);
    const timer = window.setTimeout(() => done(false), ms);
    window.addEventListener("online", onOnline);
  });
}

/**
 * R9: an upload from a placeholder on a dropped connection. A throw is the
 * connection (a refusal resolves); offline, it waits (bounded) for the
 * connection to come back and runs once more, otherwise once more after a
 * moment. A second drop resolves UPLOAD_DROPPED, never a silent hang.
 * W7: each run resumes the same drop (`runUploadDrop`), so a retry after
 * a lost step finishes that upload session and never starts a second.
 */
export async function uploadResuming<T>(
  run: () => Promise<T>,
  onWaiting: () => void,
  options: {
    readonly waitMs?: number;
    readonly untilOnline?: (ms: number) => Promise<boolean>;
    readonly pause?: (ms: number) => Promise<void>;
  } = {},
): Promise<T | typeof UPLOAD_DROPPED> {
  try {
    return await run();
  } catch {
    const offline =
      typeof navigator !== "undefined" && navigator.onLine === false;
    if (offline) {
      onWaiting();
      const back = await (options.untilOnline ?? waitUntilOnline)(
        options.waitMs ?? RESUME_WAIT_MS,
      );
      if (!back) return UPLOAD_DROPPED;
    } else {
      await (
        options.pause ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))
      )(ROOM_READ.baseMs);
    }
    try {
      return await run();
    } catch {
      return UPLOAD_DROPPED;
    }
  }
}

/**
 * Work for when the page is idle (a timeout where requestIdleCallback is
 * missing): warming a module never competes with a tap or an answer
 * landing. Returns a cancel.
 */
export function whenIdle(work: () => void, timeoutMs = 2_000): () => void {
  if (typeof window.requestIdleCallback === "function") {
    const handle = window.requestIdleCallback(() => work(), {
      timeout: timeoutMs,
    });
    return () => window.cancelIdleCallback(handle);
  }
  const timer = window.setTimeout(work, 200);
  return () => window.clearTimeout(timer);
}

/** While `failed`, the browser coming back online retries by itself. */
export function useRetryWhenOnline(failed: boolean, retry: () => void): void {
  const latest = useRef(retry);
  useEffect(() => {
    latest.current = retry;
  });
  useEffect(() => {
    if (!failed) return;
    const onOnline = () => latest.current();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [failed]);
}
