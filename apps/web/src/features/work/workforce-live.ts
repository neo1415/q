"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Keeps Q's team current without hammering the server (P7, P9): it reads
 * again only while the browser tab is visible, quickly while work is
 * running and slowly when nothing is, backs off after a failure, and
 * keeps the last good data on screen (stale-while-revalidate) with an
 * honest line about how fresh it is. Never a reload of the page.
 */

export type LiveStatus = "live" | "stale" | "offline";

/** Milliseconds until the next read; null: don't schedule one. */
export function nextDelay(input: {
  readonly hidden: boolean;
  readonly offline: boolean;
  readonly active: boolean;
  readonly failures: number;
  /** The view showing the team is on screen. */
  readonly focused: boolean;
}): number | null {
  if (input.hidden || input.offline) return null;
  if (input.failures > 0) {
    return Math.min(120_000, 10_000 * 2 ** Math.min(4, input.failures - 1));
  }
  if (!input.focused) return 60_000;
  return input.active ? 8_000 : 30_000;
}

/** "updated just now", "updated 40 s ago", "updated at 14:02". */
export function freshness(updatedAt: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - updatedAt) / 1000));
  if (seconds < 10) return "updated just now";
  if (seconds < 60) return `updated ${String(seconds)} s ago`;
  if (seconds < 3600)
    return `updated ${String(Math.floor(seconds / 60))} min ago`;
  return `updated at ${new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(updatedAt))}`;
}

export function useLive<T>(options: {
  readonly initial: T | null;
  /** Reads the data; null or a throw is a failure, the old data stays. */
  readonly load: () => Promise<T | null>;
  /** Whether running work warrants the quick interval. */
  readonly isActive: (data: T) => boolean;
  readonly focused: boolean;
  /** False: never read (the section isn't on this page). */
  readonly enabled?: boolean | undefined;
}): {
  readonly data: T | null;
  readonly status: LiveStatus;
  readonly updatedAt: number;
  readonly failures: number;
  readonly refresh: () => void;
} {
  const { load, isActive, focused, enabled = true } = options;
  const [data, setData] = useState<T | null>(options.initial);
  const [updatedAt, setUpdatedAt] = useState(() => Date.now());
  const [failures, setFailures] = useState(options.initial === null ? 1 : 0);
  const [offline, setOffline] = useState(false);
  const [hidden, setHidden] = useState(false);
  const inflight = useRef(false);
  const mounted = useRef(true);

  const read = useCallback(async () => {
    if (inflight.current) return;
    inflight.current = true;
    try {
      const next = await load().catch(() => null);
      if (!mounted.current) return;
      if (next === null) {
        setFailures((count) => count + 1);
      } else {
        setData(next);
        setFailures(0);
        setUpdatedAt(Date.now());
      }
    } finally {
      inflight.current = false;
    }
  }, [load]);

  useEffect(() => {
    mounted.current = true;
    const sync = () => {
      setHidden(document.visibilityState === "hidden");
      setOffline(typeof navigator !== "undefined" && !navigator.onLine);
    };
    sync();
    const onVisible = () => {
      sync();
      if (enabled && document.visibilityState === "visible") void read();
    };
    const onOnline = () => {
      setOffline(false);
      if (enabled) void read();
    };
    const onOffline = () => setOffline(true);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      mounted.current = false;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [enabled, read]);

  const active = data !== null && isActive(data);
  const delay = enabled
    ? nextDelay({ hidden, offline, active, failures, focused })
    : null;
  useEffect(() => {
    if (delay === null) return;
    const timer = window.setTimeout(() => void read(), delay);
    return () => window.clearTimeout(timer);
    // updatedAt re-arms the timer after every successful read.
  }, [delay, read, updatedAt]);

  return {
    data,
    status: offline ? "offline" : failures > 0 ? "stale" : "live",
    updatedAt,
    failures,
    refresh: () => void read(),
  };
}
