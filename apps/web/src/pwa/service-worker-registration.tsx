"use client";

import { useEffect } from "react";

/**
 * Registers the application-shell service worker. Progressive enhancement:
 * where service workers are unavailable, or in development where a worker
 * would fight the dev server, nothing happens and the site works as plain
 * responsive web.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      return;
    }
    if (!("serviceWorker" in navigator)) {
      return;
    }
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      // Registration failure is not an application failure.
    });
  }, []);
  return null;
}
