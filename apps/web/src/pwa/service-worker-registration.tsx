"use client";

import { useEffect } from "react";

/**
 * Registers the application-shell service worker. Progressive enhancement:
 * where service workers are unavailable, or in development where a worker
 * would fight the dev server, nothing happens and the site works as plain
 * responsive web.
 *
 * Update on reload: the worker script is never read from the HTTP cache
 * (`updateViaCache: "none"`, and /sw.js is served no-cache), the browser
 * checks it on every load, and an installed app left open checks again
 * each time it comes back to the foreground. A new worker takes over by
 * itself; the page is never reloaded under the person.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      return;
    }
    if (!("serviceWorker" in navigator)) {
      return;
    }
    let registration: ServiceWorkerRegistration | null = null;
    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then((registered) => {
        registration = registered;
      })
      .catch(() => {
        // Registration failure is not an application failure.
      });
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        registration?.update().catch(() => undefined);
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);
  return null;
}
