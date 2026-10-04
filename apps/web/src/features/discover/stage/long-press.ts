"use client";

import { useCallback, useEffect, useRef } from "react";

/** How long a still finger means "options", as on short-video apps. */
export const LONG_PRESS_MS = 500;
/** A finger that moves this far is a swipe or a scroll, not a press. */
const LONG_PRESS_SLOP_PX = 10;

/**
 * Press and hold on the pitch opens its options (Discover v2). Touch and
 * pen only: a mouse has the right-click and the More control. Returns the
 * handlers for the surface, and `consumed()`, true once for the click that
 * ends a long press, so that click does not also pause the pitch.
 */
export function useLongPress(onLongPress: () => void, enabled = true) {
  const timer = useRef<number | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);

  const cancel = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    start.current = null;
  }, []);
  useEffect(() => cancel, [cancel]);

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      fired.current = false;
      if (!enabled || event.pointerType === "mouse" || !event.isPrimary) return;
      const target = event.target;
      // Controls keep their own press: only the picture itself is held.
      if (
        target instanceof Element &&
        target.closest(
          "button, a, input, [role='slider'], [role='button'], .cq-feed-overlay, .cq-yours-info, .cq-feed-rail",
        ) !== null
      ) {
        return;
      }
      start.current = { x: event.clientX, y: event.clientY };
      timer.current = window.setTimeout(() => {
        timer.current = null;
        fired.current = true;
        onLongPress();
      }, LONG_PRESS_MS);
    },
    [enabled, onLongPress],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      const from = start.current;
      if (from === null) return;
      if (
        Math.hypot(event.clientX - from.x, event.clientY - from.y) >
        LONG_PRESS_SLOP_PX
      ) {
        cancel();
      }
    },
    [cancel],
  );

  /** True once, for the click that ends a long press. */
  const consumed = useCallback(() => {
    if (!fired.current) return false;
    fired.current = false;
    return true;
  }, []);

  return {
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: cancel,
      onPointerCancel: cancel,
    },
    consumed,
  } as const;
}
