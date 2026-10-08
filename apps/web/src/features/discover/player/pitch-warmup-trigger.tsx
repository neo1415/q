"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

import { authorisePlaybackAction } from "../feed/playback-source";
import { loadSlatePageAction } from "../feed/feed-actions";
import { budgetFor } from "../feed/use-feed-budget";
import { CONSTRAINED_PREFETCH_BUDGET } from "../feed/feed-state";
import { warmPitch } from "./pitch-warmup";

/**
 * An investor's first pitches, warmed while they are anywhere else in the
 * app (ADR 0063): once per browser session, when the page is idle, never
 * on Save-Data or a slow link, and never on Discover itself (its own
 * window does that). The slate read and the grants are the same reads
 * Discover makes; nothing is recorded, and nothing plays.
 */

const WARMED_KEY = "cq-pitch-warmed";
const WARM_AGAIN_MS = 10 * 60_000;
const FIRST = 3;

function warmedRecently(now: number): boolean {
  try {
    const at = Number(window.sessionStorage.getItem(WARMED_KEY) ?? "0");
    return now - at < WARM_AGAIN_MS;
  } catch {
    return false;
  }
}

function markWarmed(now: number): void {
  try {
    window.sessionStorage.setItem(WARMED_KEY, String(now));
  } catch {
    // Without storage this may warm once per page instead.
  }
}

function connection(): Parameters<typeof budgetFor>[0] {
  const value: unknown = Reflect.get(navigator, "connection");
  return typeof value === "object" && value !== null ? value : undefined;
}

export function PitchWarmup() {
  const pathname = usePathname();
  const onDiscover = pathname.startsWith("/discover");
  useEffect(() => {
    if (onDiscover || typeof caches === "undefined") return;
    if (budgetFor(connection()) === CONSTRAINED_PREFETCH_BUDGET) return;
    if (warmedRecently(Date.now())) return;
    const controller = new AbortController();
    const run = async () => {
      markWarmed(Date.now());
      // The stream engine's code too, so Discover's first attach is local.
      void import("hls.js/light").catch(() => undefined);
      const page = await loadSlatePageAction(null, null);
      if (!page.ok || controller.signal.aborted) return;
      const longSide = Math.round(
        window.innerHeight * Math.min(2, window.devicePixelRatio || 1),
      );
      for (const item of page.value.items.slice(0, FIRST)) {
        if (item.pitch === null || controller.signal.aborted) continue;
        const grant = await authorisePlaybackAction(
          item.companyId,
          item.pitch.mediaAssetId,
        );
        if (!grant.ok) continue;
        await warmPitch(
          grant.value.playbackUrl,
          item.pitch.mediaAssetId,
          controller.signal,
          longSide,
        ).catch(() => undefined);
      }
    };
    const idle: (callback: () => void) => number =
      typeof window.requestIdleCallback === "function"
        ? (callback) => window.requestIdleCallback(callback, { timeout: 4000 })
        : (callback) => window.setTimeout(callback, 2000);
    const handle = idle(() => {
      void run().catch(() => undefined);
    });
    return () => {
      controller.abort();
      if (typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(handle);
      } else {
        window.clearTimeout(handle);
      }
    };
  }, [onDiscover]);
  return null;
}
