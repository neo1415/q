"use client";

import { useEffect, type RefObject } from "react";

import { claimSetupReminderAction } from "./setup-nudge-actions";

/**
 * Claims today's setup reminder once its card is really seen: on screen,
 * in a visible tab. A prefetched or background-rendered Home never mounts
 * this, and a hidden tab waits until it is shown. One claim per page load,
 * whichever surface carries the reminder.
 */

let claimed = false;

/** For tests: forget this page load's claim. */
export function resetSetupReminderClaim(): void {
  claimed = false;
}

export function claimSetupReminderOnce(
  claim: () => Promise<unknown> = claimSetupReminderAction,
): void {
  if (claimed) return;
  claimed = true;
  void claim().catch(() => undefined);
}

export function useClaimWhenSeen(
  ref: RefObject<Element | null>,
  enabled: boolean,
  claim: () => Promise<unknown> = claimSetupReminderAction,
): void {
  useEffect(() => {
    const element = ref.current;
    if (!enabled || element === null || claimed) return;
    let onScreen = false;
    const attempt = () => {
      if (onScreen && document.visibilityState === "visible") {
        claimSetupReminderOnce(claim);
        cleanup();
      }
    };
    const observer =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver((entries) => {
            onScreen = entries.some((entry) => entry.isIntersecting);
            attempt();
          });
    const cleanup = () => {
      observer?.disconnect();
      document.removeEventListener("visibilitychange", attempt);
    };
    if (observer === null) {
      // No observer to ask: being mounted in a visible tab is being seen.
      onScreen = true;
      attempt();
    } else {
      observer.observe(element);
    }
    document.addEventListener("visibilitychange", attempt);
    return cleanup;
  }, [ref, enabled, claim]);
}
