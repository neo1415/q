"use client";

import "./answer-canvas.css";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";

import { ICON_SIZE, ICON_STROKE, PanelRight, X } from "@capital-q/ui/icons";
import { QMark } from "@capital-q/ui/q-mark";

import { answerChipFor, type AnswerChipContent } from "./answer-canvas-logic";
import { hideKey, useCardsState } from "./cards/card-visibility";
import type { QTurn } from "./conversation";
import { useQSessionOptional } from "./q-session";
import { avoidRects, subscribeAvoid } from "@/features/q-dock/dock-avoid";
import { overlaps, type Rect } from "@/features/q-dock/dock-placement";
import { useT } from "@/features/i18n/language";

const Q_PAGE = "/home";

/**
 * F-56 (QA 2026-10-23): pages where the person reads a document. A chip
 * floating over them covered the document on a phone; there the answer
 * waits on the Board and on Q's page instead.
 */
const READING_PAGES = ["/documents", "/company/data-room"];

function readingPage(pathname: string): boolean {
  return READING_PAGES.some(
    (page) => pathname === page || pathname.startsWith(`${page}/`),
  );
}
/** The controller's key for a chip put away: one answer, every page. */
const CHIP_KEY = "chip:";

/**
 * On any page but Q's, a new answer with cards shows as one compact chip
 * (C6; mockup answer-canvas.html?page=discover): what is ready, the names,
 * their colours, and two ways in: the Q page, or the Board. A file Q made
 * keeps its own floating card; this chip is only for answers as cards.
 */
export function AnswerChip() {
  const pathname = usePathname();
  const session = useQSessionOptional();
  if (session === null) return null;
  return (
    <AnswerChipFor
      pathname={pathname}
      turns={session.turns}
      loading={session.q.loading}
      conversationId={session.q.conversationId}
    />
  );
}

/**
 * The chip for a session's turns on a page. Split from the session so the
 * appear / open / dismiss behaviour is exercised in a browser with a
 * recorded conversation (e2e/answer-cards.spec.ts).
 */
export function AnswerChipFor({
  pathname,
  turns,
  loading,
  conversationId,
}: {
  readonly pathname: string;
  readonly turns: readonly QTurn[];
  /** The conversation is still being read: its turns are not news yet. */
  readonly loading: boolean;
  readonly conversationId: string | null;
}) {
  // Answers already there when this page opened are not news. Taken once
  // the conversation has been read: taken while it loads, an empty list
  // made the newest old answer with cards look new (P10).
  const [before, setBefore] = useState<ReadonlySet<string> | null>(null);
  // Artifacts live (audit 2026-10-15 §4): dismissed through the one
  // presentation controller, so a chip put away stays away on the next
  // page and after a reload, rather than per page.
  const cards = useCardsState();
  const dismissed = useMemo(
    () =>
      new Set(
        cards.keys
          .filter((key) => key.startsWith(CHIP_KEY))
          .map((key) => key.slice(CHIP_KEY.length)),
      ),
    [cards.keys],
  );
  const [seenPath, setSeenPath] = useState(pathname);
  if (!loading && (before === null || seenPath !== pathname)) {
    setBefore(new Set(turns.map((turn) => turn.id)));
    setSeenPath(pathname);
  }
  const chip = useMemo(
    () => (before === null ? null : answerChipFor(turns, before, dismissed)),
    [turns, before, dismissed],
  );
  if (pathname === Q_PAGE || readingPage(pathname) || chip === null) {
    return null;
  }
  const conversation = conversationId;
  const home =
    conversation === null
      ? Q_PAGE
      : `${Q_PAGE}?c=${encodeURIComponent(conversation)}`;
  return (
    <AnswerChipView
      chip={chip}
      home={home}
      onDismiss={() => hideKey(`${CHIP_KEY}${chip.answerId}`)}
    />
  );
}

/** The highest the chip climbs: it never covers the page's own top band. */
const LIFT_CEILING = 96;
const LIFT_GAP = 8;

/**
 * F-101 (QA 2026-10-24, Work at 1440px): how far the chip rises so it
 * covers none of the page's primary actions. `chip` is where it sits
 * unlifted; an obstacle it overlaps there pushes it up to sit just above
 * that obstacle. Past the ceiling it stays put: a chip near the top of the
 * screen would cover more than it frees.
 */
export function liftClear(chip: Rect, obstacles: readonly Rect[]): number {
  let lift = 0;
  // Rising past one obstacle can meet the next one up: keep rising until
  // clear (each pass moves strictly up, so it ends).
  for (;;) {
    const at = { ...chip, top: chip.top - lift, bottom: chip.bottom - lift };
    const hit = obstacles.filter((box) => overlaps(box, at));
    if (hit.length === 0) return lift;
    lift = Math.max(...hit.map((box) => chip.bottom - box.top + LIFT_GAP));
    if (chip.top - lift < LIFT_CEILING) return 0;
  }
}

/** The page's primary actions on screen, beside the registered zones. */
function obstacles(chip: Element): readonly Rect[] {
  const rects: Rect[] = [...avoidRects()];
  for (const element of document.querySelectorAll("[data-primary]")) {
    if (chip.contains(element)) continue;
    const box = element.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) continue;
    rects.push(box);
  }
  return rects;
}

function useLift(ref: RefObject<HTMLElement | null>): number {
  const [lift, setLift] = useState(0);
  const current = useRef(0);
  useEffect(() => {
    const chip = ref.current;
    if (chip === null) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const box = chip.getBoundingClientRect();
      // Where it sits unlifted: its own lift taken back out.
      const base = {
        left: box.left,
        right: box.right,
        top: box.top + current.current,
        bottom: box.bottom + current.current,
      };
      const next = liftClear(base, obstacles(chip));
      if (next !== current.current) {
        current.current = next;
        setLift(next);
      }
    };
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(measure);
    };
    schedule();
    const unsubscribe = subscribeAvoid(schedule);
    // The page under the chip changes (a decision opens, a list loads).
    const watch = new MutationObserver(schedule);
    watch.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, {
      capture: true,
      passive: true,
    });
    return () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      unsubscribe();
      watch.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, { capture: true });
    };
  }, [ref]);
  return lift;
}

export function AnswerChipView({
  chip,
  home,
  onDismiss,
}: {
  readonly chip: AnswerChipContent;
  /** The Q page, in this conversation. */
  readonly home: string;
  readonly onDismiss: () => void;
}) {
  const t = useT();
  const board = `${home}${home.includes("?") ? "&" : "?"}board=1`;
  const ref = useRef<HTMLElement | null>(null);
  const lift = useLift(ref);
  return (
    <aside
      ref={ref}
      className="cq-answer-chip"
      style={lift === 0 ? undefined : { translate: `0 ${String(-lift)}px` }}
      aria-label={t("Q answer ready")}
      data-answer-chip
    >
      {/* F-56: a still mark; a notice that has arrived is not working. */}
      <span className="mark">
        <QMark size="sm" state="IDLE" />
      </span>
      <div className="min-w-0">
        <strong>{chip.heading}</strong>
        <span className="sub" title={chip.names}>
          {chip.names}
        </span>
        <div className="dots" aria-hidden="true">
          {chip.hues.map((hue, index) => (
            <i key={`${String(hue)}-${String(index)}`} data-hue={String(hue)} />
          ))}
        </div>
      </div>
      <span className="acts">
        <Link
          href={board}
          className="cq-ac-btn"
          aria-label={t("Open in the Board")}
        >
          <PanelRight
            aria-hidden="true"
            size={ICON_SIZE.compact}
            strokeWidth={ICON_STROKE}
          />
          {t("Board")}
        </Link>
        <Link href={home} className="open inline-flex items-center">
          {t("Open in Q")}
        </Link>
      </span>
      <button
        type="button"
        className="cq-ac-x chip-x"
        aria-label={t("Dismiss")}
        onClick={onDismiss}
      >
        <X
          aria-hidden="true"
          size={ICON_SIZE.compact}
          strokeWidth={ICON_STROKE}
        />
      </button>
    </aside>
  );
}
