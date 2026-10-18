"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { ChevronUp, ICON_SIZE } from "@capital-q/ui/icons";

import { useQSessionOptional } from "@/features/q/q-session";
import { qPitchHoldsVoice } from "@/features/q-pitch/tour-presence";

import { ArrivalBriefing } from "./arrival-briefing";
import { useArrivalStatus } from "./arrival-store";
import { useOverPane } from "./over-pane";
import { useT } from "@/features/i18n/language";

/** The Q page gives the briefing itself; everywhere else, the dock does. */
const Q_PAGE = "/home";
/** The pitch-mode flag changes only with a page load or the tour's start. */
function noSubscription(): () => void {
  return () => undefined;
}

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
  const t = useT();
  const pathname = usePathname();
  const session = useQSessionOptional();
  const [closed, setClosed] = useState(false);
  const [settled, setSettled] = useState(false);
  // Opened by the person while it was tucked: it stays open over the pane.
  const [opened, setOpened] = useState(false);
  const box = useRef<HTMLElement>(null);
  // The full briefing's height when last shown; a first guess before.
  const fullHeight = useRef(140);
  // Over a pane being read (the GateQ application), the briefing tucks
  // into a small button in the corner instead of covering it. Where it
  // would sit in full is computed from its fixed corner, so the tucked
  // button never decides it.
  const over = useOverPane(() => {
    const element = box.current;
    if (element !== null && !element.hasAttribute("data-tucked")) {
      const rect = element.getBoundingClientRect();
      if (rect.height > 0) fullHeight.current = rect.height;
      return rect;
    }
    const width = Math.min(380, window.innerWidth - 32);
    const bottom = window.innerHeight - (window.innerWidth >= 640 ? 24 : 96);
    const right = window.innerWidth - 16;
    return {
      left: right - width,
      right,
      top: bottom - fullHeight.current,
      bottom,
    };
  }, pathname);
  // New cards later (an agent needs them): the dock opens again.
  const status = useArrivalStatus();
  const round = status.kind === "READY" ? status.round : 0;
  const [shownRound, setShownRound] = useState(round);
  if (round !== shownRound) {
    setShownRound(round);
    setClosed(false);
    setSettled(false);
    setOpened(false);
  }
  useEffect(() => {
    if (!settled) return;
    const timer = window.setTimeout(() => setClosed(true), SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [settled]);
  // Q Pitch (lane qpf, 17 Oct): while a tour runs, the briefing waits; it
  // sat beside the tour strip on every step. Read after hydration only.
  const pitchMode = useSyncExternalStore(
    noSubscription,
    qPitchHoldsVoice,
    () => false,
  );
  if (session === null || pathname === Q_PAGE || closed || pitchMode) {
    return null;
  }
  const tucked = over && !opened;
  return (
    <aside
      ref={box}
      aria-label={t("Q's briefing")}
      className={
        tucked
          ? "fixed end-4 bottom-24 z-(--cq-z-presence) has-[>div:empty]:hidden sm:bottom-6"
          : "fixed end-4 bottom-24 z-(--cq-z-presence) flex w-[min(380px,calc(100vw-32px))] flex-col border border-(--cq-border) bg-(--cq-surface-raised) p-3.5 shadow-(--cq-shadow-overlay) has-[>div:empty]:hidden sm:bottom-6"
      }
      data-arrival-dock
      data-tucked={tucked ? "" : undefined}
    >
      {tucked ? (
        <button
          type="button"
          aria-expanded="false"
          onClick={() => setOpened(true)}
          className="cq-body-sm inline-flex min-h-11 items-center gap-2 border border-(--cq-border) bg-(--cq-surface-raised) px-3.5 font-medium text-(--cq-text-primary) shadow-(--cq-shadow-overlay) hover:bg-(--cq-surface-subtle) focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring)"
        >
          {t("Q's briefing")}
          <ChevronUp size={ICON_SIZE.compact} aria-hidden="true" />
        </button>
      ) : null}
      {/* Kept mounted while tucked, so its cards and progress survive. */}
      <div className={tucked ? "hidden" : "contents"}>
        <ArrivalBriefing
          variant="dock"
          onSettled={() => setSettled(true)}
          onClose={() => setClosed(true)}
        />
      </div>
    </aside>
  );
}
