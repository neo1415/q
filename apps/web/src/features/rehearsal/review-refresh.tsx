"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** How often, and how many times, a provisional review looks again. */
export const REVIEW_REFRESH_MS = 15_000;
export const REVIEW_REFRESH_TIMES = 50;

/**
 * While Q finishes a review it could not write at first (REHEARSE P0,
 * 2026-10-01), the page reads it again every few seconds, quietly, and
 * stops once the real review is there (the component is no longer shown).
 */
export function ReviewRefresh() {
  const router = useRouter();
  useEffect(() => {
    let times = 0;
    const id = window.setInterval(() => {
      times += 1;
      if (times > REVIEW_REFRESH_TIMES) {
        window.clearInterval(id);
        return;
      }
      router.refresh();
    }, REVIEW_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [router]);
  return null;
}
