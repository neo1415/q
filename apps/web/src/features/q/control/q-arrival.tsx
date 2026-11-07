"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect } from "react";

import { arrive, markQMove } from "./arrival";
import {
  navigationInFlight,
  onNavigationOutcome,
  onNavigationPhase,
} from "./navigation-lifecycle";

/**
 * W3.3/W3.4: arrival and Back for every page, from the one navigation
 * lifecycle (it is listened to, never forked). Q's move: on VERIFIED the
 * entry is marked as Q's (with the page it came from) and the page
 * arrives at its target with focus on its heading. The person's own load
 * of a deep link (pasted, clicked, Back/Forward): the page arrives at its
 * target without moving focus.
 */
export function QArrival() {
  const pathname = usePathname();
  const search = useSearchParams();
  const query = search?.toString() ?? "";

  useEffect(() => {
    // Where each of Q's moves started, by its intent id.
    const origins = new Map<string, string>();
    const offPhase = onNavigationPhase((state) => {
      if (state.phase === "REQUESTED" && !origins.has(state.intentId)) {
        origins.set(state.intentId, window.location.href);
      }
    });
    const offOutcome = onNavigationOutcome((outcome) => {
      const from = origins.get(outcome.intentId);
      origins.delete(outcome.intentId);
      if (outcome.status !== "DONE") return;
      if (from !== undefined && from !== window.location.href) markQMove(from);
      lastQArrival = { href: window.location.href, at: Date.now() };
      void arrive({ byQ: true });
    });
    return () => {
      offPhase();
      offOutcome();
    };
  }, []);

  useEffect(() => {
    const own = () => {
      // Q's move arrives from its own receipt (above), with focus.
      if (navigationInFlight()) return;
      if (
        lastQArrival !== null &&
        lastQArrival.href === window.location.href &&
        Date.now() - lastQArrival.at < Q_ARRIVAL_HOLD_MS
      ) {
        return;
      }
      void arrive({ byQ: false });
    };
    own();
    window.addEventListener("hashchange", own);
    return () => window.removeEventListener("hashchange", own);
  }, [pathname, query]);

  return null;
}

/** A route change this soon after Q's arrival at it is that same arrival. */
const Q_ARRIVAL_HOLD_MS = 2_000;
let lastQArrival: { readonly href: string; readonly at: number } | null = null;
