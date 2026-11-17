"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { LazyMotion, m, useReducedMotion } from "motion/react";

import { cx } from "@capital-q/ui";
import {
  ArrowDown,
  ArrowUp,
  ICON_SIZE,
  ICON_STROKE,
} from "@capital-q/ui/icons";

import { createLevelEnvelope } from "@/features/q-aperture/level-envelope";
import { useQMotion } from "@/features/q-aperture";
import { useT } from "@/features/i18n/language";

import { resultCue, scrollerOf, type ResultCue } from "./follow-newest";

/**
 * The voice room's layout (owner audit 2026-11-15, Phase 4A-C; decision
 * 102, owner 2026-11-17).
 *
 * - Q's presence is large only while nothing substantive is shown. Once
 *   Q shows something (cards, a table, a comparison, a document), the
 *   content takes the whole stage: Q's presence becomes a small element
 *   in the stage's bottom corner and the captions float at the bottom,
 *   both in a zero-height overlay that takes no layout width or height.
 *   The content keeps room at its end for the overlay (measured), so the
 *   last card's buttons are never under it. The presence is the same
 *   element throughout (never remounted: the swarm's loop keeps
 *   running), so the change is one smooth layout animation, and none
 *   under reduced motion.
 * - Nothing here ever moves the scroll. A result that lands out of view
 *   gets a quiet "New result" control instead.
 * - The speaking light is driven per frame from a ref, never React state,
 *   on transform only, through the same smoothing envelope the swarm uses.
 */

const loadFeatures = () =>
  import("./answer-canvas-motion").then((module) => module.default);

/** How much the presence may swell with Q's voice: restrained. */
export const SPEAKING_SWELL = 0.03;

/** The presence's transform for a base scale and a smoothed level. */
export function presenceTransform(scale: number, level: number): string {
  const swell = 1 + SPEAKING_SWELL * Math.max(0, Math.min(1, level));
  return `scale(${(scale * swell).toFixed(4)})`;
}

/**
 * Runs the presence's speaking swell: requestAnimationFrame while Q
 * speaks (and until the level has settled after), writing the element's
 * transform directly. At rest, and under reduced motion, it writes once.
 */
export function usePresenceDriver(
  ref: RefObject<HTMLElement | null>,
  options: {
    readonly scale: number;
    readonly speaking: boolean;
    readonly level: () => number;
    readonly still: boolean;
  },
): void {
  const live = useRef(options);
  const kick = useRef<() => void>(() => undefined);
  useLayoutEffect(() => {
    live.current = options;
  });
  useEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const envelope = createLevelEnvelope();
    let raf = 0;
    let last = 0;
    const paint = () => {
      element.style.transform = presenceTransform(
        live.current.scale,
        envelope.value(),
      );
    };
    const frame = (now: number) => {
      raf = 0;
      const dt = last === 0 ? 1000 / 60 : now - last;
      last = now;
      const { speaking, level, still } = live.current;
      if (still) {
        envelope.reset(0);
        paint();
        last = 0;
        return;
      }
      envelope.step(speaking ? level() : 0, dt);
      paint();
      // Keeps going while Q speaks, and until the swell has let go.
      if (speaking || envelope.value() > 0.002) {
        raf = requestAnimationFrame(frame);
      } else {
        envelope.reset(0);
        paint();
        last = 0;
      }
    };
    kick.current = () => {
      if (raf !== 0) return;
      const { speaking, still } = live.current;
      if (still || (!speaking && envelope.value() === 0)) {
        if (still) envelope.reset(0);
        paint();
        return;
      }
      paint();
      raf = requestAnimationFrame(frame);
    };
    kick.current();
    return () => {
      if (raf !== 0) cancelAnimationFrame(raf);
      kick.current = () => undefined;
    };
  }, [ref]);
  useEffect(() => {
    kick.current();
  }, [options.scale, options.speaking, options.still]);
}

/**
 * Q's presence in the voice room: drawn at one size always (`pixels`),
 * shown at `shown` pixels by a transform, so a size change never
 * restarts the swarm.
 */
export function VoiceRoomPresence({
  compact,
  pixels,
  shown,
  speaking,
  outputLevel,
  children,
}: {
  readonly compact: boolean;
  /** The size the presence is drawn at. */
  readonly pixels: number;
  /** The size it takes on screen now. */
  readonly shown: number;
  readonly speaking: boolean;
  readonly outputLevel: () => number;
  readonly children: ReactNode;
}) {
  const reduced = useReducedMotion() === true;
  const { motion } = useQMotion();
  const still = reduced || motion !== "full";
  const innerRef = useRef<HTMLDivElement>(null);
  usePresenceDriver(innerRef, {
    scale: shown / pixels,
    speaking,
    level: outputLevel,
    still,
  });
  return (
    <m.div
      layout={still ? false : true}
      layoutDependency={compact}
      transition={{ duration: 0.32, ease: [0.2, 0, 0, 1] }}
      className="relative flex-none"
      style={{ width: shown, height: shown }}
      data-q-voice-presence-box={compact ? "compact" : "full"}
    >
      <div
        ref={innerRef}
        className="absolute top-0 left-0"
        style={{
          width: pixels,
          height: pixels,
          transformOrigin: "0 0",
          transform: presenceTransform(shown / pixels, 0),
        }}
        data-q-voice-presence-scale
      >
        {children}
      </div>
    </m.div>
  );
}

/**
 * The room: an aside (presence, state, captions) and the content. Large
 * presence: the aside's parts stack above the content as before. Compact
 * (decision 102): the content takes the stage, and the aside is a
 * floating overlay at the stage's foot -- the presence small in the
 * corner, the captions at the bottom -- that takes no layout space.
 */
export function VoiceRoom({
  compact,
  aside,
  children,
  resultKey,
}: {
  readonly compact: boolean;
  readonly aside: ReactNode;
  readonly children: ReactNode;
  /** The result on the stage now; a new one out of view gets a cue. */
  readonly resultKey: string | null;
}) {
  const t = useT();
  const contentRef = useRef<HTMLDivElement>(null);
  const roomRef = useRef<HTMLDivElement>(null);
  const asideRef = useRef<HTMLDivElement>(null);
  // Decision 102: the overlay floats over the content, so the content
  // keeps its height free at the end -- the last card's buttons can always
  // be scrolled clear of the captions and the presence. Measured from
  // layout offsets (never transforms), and written to a CSS variable, not
  // React state, so a growing caption re-renders nothing.
  useLayoutEffect(() => {
    const room = roomRef.current;
    const aside = asideRef.current;
    if (room === null || aside === null) return;
    if (!compact) {
      room.style.removeProperty("--cq-voice-overlay-h");
      room.style.removeProperty("--cq-voice-presence-w");
      room.style.removeProperty("--cq-voice-bleed");
      return;
    }
    const scroller = scrollerOf(room);
    const measure = () => {
      // Q sits in the stage's corner, past the content column's edge on a
      // wide screen: how far the stage's content box reaches beyond the
      // (centred) room on each side.
      if (scroller !== document.scrollingElement) {
        const style = getComputedStyle(scroller);
        const inner =
          scroller.clientWidth -
          parseFloat(style.paddingLeft) -
          parseFloat(style.paddingRight);
        room.style.setProperty(
          "--cq-voice-bleed",
          `${String(Math.max(0, Math.floor((inner - room.offsetWidth) / 2)))}px`,
        );
      }
      let height = 0;
      for (const child of Array.from(aside.children)) {
        if (!(child instanceof HTMLElement) || child.offsetHeight <= 1) {
          continue;
        }
        // The aside is zero-height; its parts hang above it.
        height = Math.max(height, -child.offsetTop);
        // The captions sit beside Q, never under it.
        if (child.matches("[data-q-presence]")) {
          room.style.setProperty(
            "--cq-voice-presence-w",
            `${String(child.offsetWidth)}px`,
          );
        }
      }
      room.style.setProperty(
        "--cq-voice-overlay-h",
        `${String(Math.ceil(height))}px`,
      );
    };
    measure();
    if (typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(measure);
    for (const child of Array.from(aside.children)) observer.observe(child);
    observer.observe(room);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [compact]);
  // The cue belongs to one result: another result (or none) shows none.
  const [cueFor, setCueFor] = useState<{
    readonly key: string;
    readonly where: ResultCue;
  } | null>(null);
  const cue = cueFor !== null && cueFor.key === resultKey ? cueFor.where : null;
  // A new result: say where it is if it is out of view; never scroll.
  useEffect(() => {
    const content = contentRef.current;
    if (content === null || resultKey === null) return;
    const scroller = scrollerOf(content);
    // Until the result has been seen once, each layout or scroll checks
    // again; a result still loading (no height yet) is not judged.
    let settled = false;
    const check = () => {
      if (settled) return;
      const box = content.getBoundingClientRect();
      if (box.height < 48) return;
      const view =
        scroller === document.scrollingElement
          ? { top: 0, bottom: window.innerHeight }
          : scroller.getBoundingClientRect();
      const where = resultCue(box, view);
      if (where === null) settled = true;
      setCueFor({ key: resultKey, where });
    };
    const raf = requestAnimationFrame(check);
    const resized =
      typeof ResizeObserver === "function" ? new ResizeObserver(check) : null;
    resized?.observe(content);
    const target: HTMLElement | Window =
      scroller === document.scrollingElement ? window : scroller;
    target.addEventListener("scroll", check, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      resized?.disconnect();
      target.removeEventListener("scroll", check);
    };
  }, [resultKey]);
  const reveal = () => {
    setCueFor(null);
    const reduced = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    // The person's own choice: the one scroll this room makes.
    contentRef.current?.scrollIntoView?.({
      block: "start",
      behavior: reduced === true ? "auto" : "smooth",
    });
  };
  return (
    <LazyMotion features={loadFeatures} strict>
      <div
        ref={roomRef}
        className={cx(
          "cq-voice-room w-full",
          compact
            ? "flex flex-1 flex-col gap-4"
            : "flex flex-col items-center gap-4",
        )}
        data-q-voice-room
        data-q-voice-compact={compact ? "" : undefined}
      >
        <div ref={asideRef} className="cq-voice-aside" data-q-voice-aside>
          {aside}
        </div>
        <div
          ref={contentRef}
          className="flex w-full min-w-0 flex-col items-center gap-4"
          data-q-voice-content
        >
          {children}
        </div>
        {cue === null ? null : (
          <button
            type="button"
            className="cq-voice-new-result cq-label"
            onClick={reveal}
            data-q-new-result={cue}
          >
            {cue === "below" ? (
              <ArrowDown
                aria-hidden="true"
                size={ICON_SIZE.compact}
                strokeWidth={ICON_STROKE}
              />
            ) : (
              <ArrowUp
                aria-hidden="true"
                size={ICON_SIZE.compact}
                strokeWidth={ICON_STROKE}
              />
            )}
            {t("New result")}
          </button>
        )}
      </div>
    </LazyMotion>
  );
}
