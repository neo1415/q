"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

import { cx } from "@capital-q/ui";
import { ICON_SIZE, ICON_STROKE, Wifi, WifiOff } from "@capital-q/ui/icons";

/**
 * Quiet network awareness. Offline is a state, not a broken page: the shell
 * says so, keeps what is already loaded understandable, and clears the
 * notice a moment after the connection returns. It never claims stale
 * intelligence is current and never invents results.
 */

export type NetworkState = "online" | "offline" | "reconnected";

const RECONNECTED_NOTICE_MS = 4000;

function subscribe(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/** The server never knows; it renders the online layout and the client corrects it. */
function getServerSnapshot(): boolean {
  return true;
}

function getSnapshot(): boolean {
  return navigator.onLine;
}

export function NetworkStatus() {
  const online = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );
  const [recentlyReconnected, setRecentlyReconnected] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const handleOnline = () => {
      clearTimeout(timer);
      setRecentlyReconnected(true);
      timer = setTimeout(
        () => setRecentlyReconnected(false),
        RECONNECTED_NOTICE_MS,
      );
    };
    const handleOffline = () => {
      clearTimeout(timer);
      setRecentlyReconnected(false);
    };
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const state: NetworkState = !online
    ? "offline"
    : recentlyReconnected
      ? "reconnected"
      : "online";

  return (
    <div
      role="status"
      aria-live="polite"
      data-network={state}
      className={cx(
        state === "online"
          ? "sr-only"
          : "flex items-center gap-2 border-b border-(--cq-border-subtle) px-4 py-2 cq-caption text-(--cq-text-secondary)",
        state === "offline" && "bg-(--cq-warning-soft)",
        state === "reconnected" && "bg-(--cq-positive-soft)",
      )}
    >
      {state === "offline" ? (
        <>
          <WifiOff
            aria-hidden="true"
            size={ICON_SIZE.compact}
            strokeWidth={ICON_STROKE}
          />
          <span>Offline. Showing what was already loaded.</span>
        </>
      ) : null}
      {state === "reconnected" ? (
        <>
          <Wifi
            aria-hidden="true"
            size={ICON_SIZE.compact}
            strokeWidth={ICON_STROKE}
          />
          <span>Back online.</span>
        </>
      ) : null}
    </div>
  );
}
