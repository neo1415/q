"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { useQSessionOptional } from "@/features/q/q-session";

import { ArrivalBriefing } from "./arrival-briefing";
import { useArrivalStatus } from "./arrival-store";

/** The Q page gives the briefing itself; everywhere else, the dock does. */
const Q_PAGE = "/home";
/** After the last card, the dock's line stays this long, then goes. */
const SETTLE_MS = 4_000;

/**
 * The compact arrival briefing beside Q's dock on every page but the Q
 * page (Zino, 2026-10-08): the greeting and lowdown in a line, the card in
 * focus with the same four verbs, the count of the rest. Floats above the
 * page, never over it: it can be closed, and "Not now" leaves the cards in
 * Needs you on Work.
 */
export function ArrivalDock() {
  const pathname = usePathname();
  const session = useQSessionOptional();
  const [closed, setClosed] = useState(false);
  const [settled, setSettled] = useState(false);
  // New cards later (an agent needs them): the dock opens again.
  const status = useArrivalStatus();
  const round = status.kind === "READY" ? status.round : 0;
  const [shownRound, setShownRound] = useState(round);
  if (round !== shownRound) {
    setShownRound(round);
    setClosed(false);
    setSettled(false);
  }
  useEffect(() => {
    if (!settled) return;
    const timer = window.setTimeout(() => setClosed(true), SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [settled]);
  if (session === null || pathname === Q_PAGE || closed) return null;
  return (
    <aside
      aria-label="Q's briefing"
      className="fixed right-4 bottom-24 z-(--cq-z-presence) flex w-[min(380px,calc(100vw-32px))] flex-col rounded-(--cq-radius-xl) border border-(--cq-border) bg-(--cq-surface-raised) p-3.5 shadow-(--cq-shadow-overlay) empty:hidden sm:bottom-6"
      data-arrival-dock
    >
      <ArrivalBriefing
        variant="dock"
        onSettled={() => setSettled(true)}
        onClose={() => setClosed(true)}
      />
    </aside>
  );
}
