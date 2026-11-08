"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Batch 13 (owner, 8 Nov): Q expressed interest and sent questions from the
 * chat; the action ran, but the page beside it still offered "Express
 * interest". When Q has changed the person's data, the page's own reads
 * are refreshed through the app's existing invalidation (router.refresh:
 * the server components read again; client state is kept).
 *
 * Announced by the conversation when a run it resumed after the person's
 * approval completes (that run executed the approved action), and after a
 * carried approval's read-back. Never polled.
 */
export const PAGE_DATA_CHANGED_EVENT = "cq:page-data-changed";

/** Coalesces a burst (a run's end and its read-back) into one refresh. */
export const PAGE_REFRESH_DEBOUNCE_MS = 400;

export function announcePageDataChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(PAGE_DATA_CHANGED_EVENT));
}

/** Mounted once in the shell: refreshes the page when Q changed its data. */
export function PageDataRefresher() {
  const router = useRouter();
  useEffect(() => {
    let timer = 0;
    const onChanged = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        router.refresh();
      }, PAGE_REFRESH_DEBOUNCE_MS);
    };
    window.addEventListener(PAGE_DATA_CHANGED_EVENT, onChanged);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener(PAGE_DATA_CHANGED_EVENT, onChanged);
    };
  }, [router]);
  return null;
}
