"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { retryWithBackoff, type RetryOptions } from "./resilient";

/**
 * A client read with stale-while-revalidate, bounded retries and an honest
 * state (P9). What was last read for the same key shows at once while a
 * fresh read runs; a failure keeps it on screen and says so. The state is
 * never an endless "loading": it ends as `ready`, or as `failed` with a
 * `retry` the person can press. `offline` means the browser has no
 * connection and the read resumes by itself when it returns.
 *
 * The cache is per tab and in memory only: nothing read here is written
 * to storage, so a signed-out or shared device keeps nothing.
 */

export type ResilientStatus =
  "loading" | "ready" | "retrying" | "offline" | "failed";

export type ResilientRead<T> = {
  readonly data: T | undefined;
  readonly status: ResilientStatus;
  /** True while `data` is from an earlier read and a fresh one is pending or failed. */
  readonly stale: boolean;
  readonly retry: () => void;
};

type Entry = { readonly value: unknown; readonly at: number };
const cache = new Map<string, Entry>();
const CACHE_LIMIT = 50;

function remember(key: string, value: unknown): void {
  cache.delete(key);
  cache.set(key, { value, at: Date.now() });
  if (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

/** Tests only. */
export function clearResilientCache(): void {
  cache.clear();
}

export function useResilientRead<T>(
  key: string | null,
  read: () => Promise<T>,
  options: Omit<RetryOptions, "signal" | "onRetry"> & {
    /** A cached value younger than this is not read again on mount. */
    readonly freshMs?: number;
  } = {},
): ResilientRead<T> {
  const cached = key === null ? undefined : cache.get(key);
  const [data, setData] = useState<T | undefined>(
    cached?.value as T | undefined,
  );
  const [status, setStatus] = useState<ResilientStatus>(
    cached === undefined ? "loading" : "ready",
  );
  const [stale, setStale] = useState(cached !== undefined);
  const [attempt, setAttempt] = useState(0);
  const readRef = useRef(read);
  const optionsRef = useRef(options);
  useEffect(() => {
    readRef.current = read;
    optionsRef.current = options;
  });

  // A different key starts from what is known for it.
  const [shownKey, setShownKey] = useState(key);
  if (shownKey !== key) {
    setShownKey(key);
    const known = key === null ? undefined : cache.get(key);
    setData(known?.value as T | undefined);
    setStale(known !== undefined);
    setStatus(known === undefined ? "loading" : "ready");
  }

  useEffect(() => {
    if (key === null) return;
    const known = cache.get(key);
    const freshMs = optionsRef.current.freshMs ?? 0;
    if (
      attempt === 0 &&
      known !== undefined &&
      Date.now() - known.at < freshMs
    ) {
      setStale(false);
      return;
    }
    const controller = new AbortController();
    if (known === undefined) setStatus("loading");
    retryWithBackoff(() => readRef.current(), {
      ...optionsRef.current,
      signal: controller.signal,
      onRetry: (phase) => {
        if (!controller.signal.aborted) setStatus(phase);
      },
    }).then(
      (value) => {
        if (controller.signal.aborted) return;
        remember(key, value);
        setData(value);
        setStale(false);
        setStatus("ready");
      },
      () => {
        if (controller.signal.aborted) return;
        setStatus("failed");
      },
    );
    return () => controller.abort();
  }, [key, attempt]);

  // Back online after a failure: try again without being asked.
  useEffect(() => {
    if (status !== "failed") return;
    const again = () => setAttempt((n) => n + 1);
    window.addEventListener("online", again);
    return () => window.removeEventListener("online", again);
  }, [status]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { data, status, stale, retry };
}
