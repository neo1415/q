"use client";

import { useEffect } from "react";

const RELOAD_KEY = "cq-deploy-skew-reload-at";
const RELOAD_GAP_MS = 60_000;

/**
 * Deploy skew guard. A page loaded before a deploy still holds the previous
 * build's server-action ids; after the deploy those POSTs come back 404
 * ("failed to find server action") and the screen waits forever. When a
 * server-action request (it carries the `Next-Action` header) answers 404,
 * the page reloads once onto the new build. At most one reload a minute, so
 * a real 404 can never loop.
 */
export function DeploySkewGuard() {
  useEffect(() => {
    const original = window.fetch.bind(window);
    const guarded: typeof window.fetch = async (input, init) => {
      const response = await original(input, init);
      if (response.status === 404 && isServerAction(input, init)) {
        reloadOnce();
      }
      return response;
    };
    window.fetch = guarded;
    return () => {
      if (window.fetch === guarded) window.fetch = original;
    };
  }, []);
  return null;
}

function isServerAction(
  input: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1],
): boolean {
  const headers = new Headers(
    init?.headers ?? (input instanceof Request ? input.headers : undefined),
  );
  return headers.has("next-action");
}

function reloadOnce(): void {
  const now = Date.now();
  try {
    const last = Number(window.sessionStorage.getItem(RELOAD_KEY) ?? "0");
    if (now - last < RELOAD_GAP_MS) return;
    window.sessionStorage.setItem(RELOAD_KEY, String(now));
  } catch {
    // No storage: still reload; the browser's own page lifecycle bounds it.
  }
  window.location.reload();
}
