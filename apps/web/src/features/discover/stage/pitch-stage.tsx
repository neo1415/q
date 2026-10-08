"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type {
  DiscoveredCompanyDto,
  PlaybackAuthorizationDto,
} from "@capital-q/contracts";
import {
  ChevronDown,
  ChevronUp,
  ICON_SIZE,
  ICON_STROKE,
  Play,
} from "@capital-q/ui/icons";

import type { FeedPreloadPolicy } from "../feed/feed-state";
import type { PlaybackSource } from "../player/pitch-playback";
import { attachHlsOrNativeSource } from "../player/hls-source";
import { PitchPlayer } from "../player/pitch-player";
import { usePitchPlayback } from "../player/use-pitch-playback";
import { useLongPress } from "./long-press";
import { useOnline } from "./online";
import { PitchOptionsSheet } from "./pitch-options";
import { rateLabel, stepPlaybackRate, usePlaybackRate } from "./playback-rate";
import { PitchScrubber, SEEK_STEP_SECONDS, seekBy } from "./scrubber";

/**
 * The pitch stage: the one full-bleed player surface every feed of pitches
 * uses -- Discover's For You and Explore's opened pitch (founder
 * 2026-10-08: "when I click a video in Explore it should be exactly the
 * Discover player"). It owns the media slots, the gestures, the keys, the
 * progress bar, speed, captions and the options sheet; the feed that uses
 * it owns which cards there are, where the reader is, and what the card
 * over the pitch says and does.
 */

/** One swipe's settle (spec §9.3); instant under reduced motion. */
const SETTLE_MS = 280;
/**
 * A wheel gesture is one item (spec §9.3). The deltas of one gesture are
 * summed until they cross the threshold; after a move, the wheel stays
 * locked until it has been quiet for the lockout -- a trackpad keeps
 * sending inertial deltas for a second or more after the fingers lift,
 * and a fixed lockout from the first move read that tail as a second
 * gesture and skipped a company.
 */
const WHEEL_THRESHOLD = 60;
const WHEEL_LOCK_MS = 350;
/** A drag this far, in CSS pixels, is a swipe rather than a tap or a nudge. */
const SWIPE_THRESHOLD = 48;
/** Sideways far enough to decide (founder direction 2026-09-29). */
const DECIDE_THRESHOLD = 110;
const AXIS_LOCK = 12;

/**
 * Which cards hold a player, by offset from the one in view: the one
 * behind (kept, so a swipe back is instant), the one in view, and the next
 * two (buffering, ADR 0063). The card at index i always lives in slot
 * i % SLOT_COUNT, so moving on hands the next card's element -- already
 * buffered -- the ACTIVE tier in place, with no re-attach.
 */
export const SLOT_OFFSETS = [-1, 0, 1, 2] as const;
const SLOT_COUNT = SLOT_OFFSETS.length;

/**
 * The media layer: at most four players, recycled (spec §9.5 as amended
 * by ADR 0063). A card the controller has put in the POSTER tier but that
 * has no slot gets its poster warmed as an image and no `<video>`.
 */
function FeedMedia({
  items,
  index,
  policyFor,
  sourceFor,
  reducedMotion,
  hold,
  muted,
  onMutedChange,
  initialAuthorization,
  mediaRef,
  paused,
  rate,
  captionsOn,
  offline,
  onActiveElement,
  scrubber,
}: {
  readonly paused: boolean;
  readonly rate: number;
  readonly captionsOn: boolean;
  readonly offline: boolean;
  readonly onActiveElement: (video: HTMLVideoElement | null) => void;
  readonly scrubber: ReactNode;
  readonly initialAuthorization: PlaybackAuthorizationDto | null;
  readonly items: readonly DiscoveredCompanyDto[];
  readonly index: number;
  readonly policyFor: (companyId: string) => FeedPreloadPolicy;
  readonly sourceFor: (companyId: string) => PlaybackSource;
  readonly reducedMotion: boolean;
  readonly hold: boolean;
  readonly muted: boolean;
  readonly onMutedChange: (muted: boolean) => void;
  readonly mediaRef: React.Ref<HTMLDivElement>;
}) {
  const slots: {
    readonly key: string;
    readonly offset: number;
    readonly item: DiscoveredCompanyDto;
  }[] = [];
  for (const offset of SLOT_OFFSETS) {
    const at = index + offset;
    const item = items[at];
    if (item !== undefined) {
      slots.push({ key: String(at % SLOT_COUNT), offset, item });
    }
  }
  const warm = items.filter((item, at) => {
    const offset = at - index;
    return (
      // Outside the slots (one behind, two ahead): a poster, no player.
      (offset < -1 || offset > 2) &&
      item.pitch !== null &&
      policyFor(item.companyId) === "POSTER"
    );
  });
  return (
    <div ref={mediaRef} className="cq-feed-media">
      {slots.map(({ key, offset, item }) => (
        <div
          key={key}
          className="cq-feed-slot"
          style={{
            // The drag offset is written by the gesture straight onto the
            // media layer, so following a finger re-renders nothing.
            transform: `translateY(calc(${String(offset * 100)}% + var(--cq-feed-drag, 0px)))`,
          }}
          data-slot-offset={offset}
          {...(offset === 0 ? { "data-slot-active": "" } : {})}
          // Neighbours are a glimpse, not controls: nothing in them is
          // reachable until they are the card in view.
          {...(offset === 0 ? {} : { inert: true, "aria-hidden": true })}
        >
          {item.pitch === null ? (
            <div className="cq-feed-still">
              <span className="cq-title-lg text-(--cq-text-primary)">
                {item.canonicalName}
              </span>
              <span className="cq-caption text-(--cq-text-secondary)">
                No pitch to show yet
              </span>
            </div>
          ) : (
            <PitchPlayer
              company={item}
              policy={policyFor(item.companyId)}
              authorize={sourceFor(item.companyId)}
              reducedMotion={reducedMotion}
              attachSource={attachHlsOrNativeSource}
              variant="stage"
              hold={offset !== 0 || hold}
              muted={muted}
              onMutedChange={onMutedChange}
              initialAuthorization={
                initialAuthorization?.mediaAssetId === item.pitch.mediaAssetId
                  ? initialAuthorization
                  : null
              }
              rate={rate}
              captionsOn={captionsOn}
              offline={offline}
              {...(offset === 0 ? { onElement: onActiveElement } : {})}
            />
          )}
        </div>
      ))}
      {paused ? (
        // Where the tap was answered. The tap region itself is the control,
        // so this is a picture of the state, not a second button.
        <span aria-hidden="true" data-feed-paused className="cq-feed-paused">
          <Play size={30} strokeWidth={ICON_STROKE} fill="currentColor" />
        </span>
      ) : null}
      {scrubber}
      {warm.map((item) => (
        <PosterWarmer
          key={item.companyId}
          company={item}
          authorize={sourceFor(item.companyId)}
          reducedMotion={reducedMotion}
        />
      ))}
    </div>
  );
}

/**
 * The POSTER tier for a card with no player yet: authorise, then let the
 * browser fetch the poster from the CDN so it is in cache when the card's
 * slot is handed to it. `hidden` keeps it out of layout and the
 * accessibility tree; an image that is not displayed is still fetched.
 */
function PosterWarmer({
  company,
  authorize,
  reducedMotion,
}: {
  readonly company: DiscoveredCompanyDto;
  readonly authorize: PlaybackSource;
  readonly reducedMotion: boolean;
}) {
  const { posterUrl } = usePitchPlayback({
    mediaAssetId: company.pitch?.mediaAssetId ?? null,
    policy: "POSTER",
    authorize,
    reducedMotion,
  });
  if (posterUrl === null) return null;
  return (
    // A plain image on purpose: next/image would fetch the poster through
    // this app's optimiser, and media bytes never pass through the app
    // origin. It is also never displayed, so it is not an LCP candidate.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={posterUrl}
      alt=""
      hidden
      decoding="async"
      fetchPriority="low"
      data-poster-warm={company.companyId}
    />
  );
}

export type PitchStageProps = {
  readonly items: readonly DiscoveredCompanyDto[];
  readonly index: number;
  readonly next: () => void;
  readonly previous: () => void;
  readonly canAdvance: boolean;
  readonly canRetreat: boolean;
  readonly policyFor: (companyId: string) => FeedPreloadPolicy;
  readonly sourceFor: (companyId: string) => PlaybackSource;
  readonly reducedMotion: boolean;
  /** Holds from outside the stage: the splash, a hidden tab, another tab. */
  readonly hold: boolean;
  readonly muted: boolean;
  readonly onMutedChange: (muted: boolean) => void;
  readonly initialAuthorization?: PlaybackAuthorizationDto | null;
  /** The stage's group label ("Companies to review"). */
  readonly label: string;
  readonly nextLabel?: string;
  readonly previousLabel?: string;
  /** Over the pitch's top edge: the phone's filter button, Explore's Back. */
  readonly top?: ReactNode;
  /** The card for the company in view (over the pitch; beside it on a desktop). */
  readonly overlay: (stage: { readonly openOptions: () => void }) => ReactNode;
  /** Before the stage in the tree (a Q subject declaration). */
  readonly before?: ReactNode;
  /** Sideways swipe: right keeps, left passes. Absent, sideways does nothing. */
  readonly onDecide?: ((verdict: "SAVE" | "PASS") => void) | undefined;
  /** The options sheet's Not interested. */
  readonly onNotInterested?: (() => void) | undefined;
  /** Keys the feed adds (Escape to close, S to save); true when handled. */
  readonly onExtraKey?: ((key: string) => boolean) | undefined;
  /** The stage's element, for a feed that reads the pitch in view. */
  readonly onStage?: ((stage: HTMLDivElement | null) => void) | undefined;
};

export function PitchStage({
  items,
  index,
  next,
  previous,
  canAdvance,
  canRetreat,
  policyFor,
  sourceFor,
  reducedMotion,
  hold: outsideHold,
  muted,
  onMutedChange,
  initialAuthorization = null,
  label,
  nextLabel = "Next company",
  previousLabel = "Previous company",
  top,
  overlay,
  before,
  onDecide,
  onNotInterested,
  onExtraKey,
  onStage,
}: PitchStageProps) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  // The feed may want the stage too (Discover reads the pitch's moment).
  const setStage = useCallback(
    (node: HTMLDivElement | null) => {
      stageRef.current = node;
      onStage?.(node);
    },
    [onStage],
  );
  const mediaRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    readonly startY: number;
    readonly startX: number;
    dy: number;
    dx: number;
    /** Decided by the first few pixels: up/down browses, sideways decides. */
    axis: "x" | "y" | null;
  } | null>(null);

  /**
   * Settling: a card becomes ACTIVE for playback only once the move to it
   * has finished (spec §9.5), so a quick run through three cards starts
   * nothing on the two it passed.
   */
  const [settledAt, setSettledAt] = useState(index);
  useEffect(() => {
    if (settledAt === index) return;
    const timer = window.setTimeout(
      () => setSettledAt(index),
      reducedMotion ? 0 : SETTLE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [index, settledAt, reducedMotion]);

  /*
   * Tap to pause (founder directive, 2026-09-27). A pause the person asked
   * for belongs to the card they asked on: moving to another card starts
   * that one normally, and coming back does not resume this one by itself.
   */
  const [pausedAt, setPausedAt] = useState<number | null>(null);
  const tapPaused = pausedAt === index;
  const hold = settledAt !== index || tapPaused || outsideHold;

  /*
   * All client-only and never sent anywhere: the element of the card in
   * view (for the progress bar, speed and the seek keys), the viewer's
   * speed, captions, the options sheet, Clear display, and whether the
   * browser has any network at all.
   */
  const [activeVideo, setActiveVideo] = useState<HTMLVideoElement | null>(null);
  const [rate, setRate] = usePlaybackRate();
  const [captionsOn, setCaptionsOn] = useState(true);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [clearDisplay, setClearDisplay] = useState(false);
  const [scrubbing, setScrubbing] = useState(false);
  const online = useOnline();
  const openOptions = useCallback(() => setOptionsOpen(true), []);
  const longPress = useLongPress(openOptions);
  const [rateNote, setRateNote] = useState<string | null>(null);

  const activeElement = useCallback(
    () =>
      stageRef.current?.querySelector<HTMLVideoElement>(
        "[data-slot-active] video",
      ) ?? null,
    [],
  );

  /** Space plays or pauses the pitch in view; the element is the truth. */
  const togglePlay = useCallback(() => {
    const video = activeElement();
    if (video === null) return;
    if (video.paused) void video.play().catch(() => undefined);
    else video.pause();
  }, [activeElement]);

  /**
   * A tap on the pitch itself -- not on the overlay, the rail or a
   * control -- pauses or resumes it. Under reduced motion nothing plays by
   * itself, so the tap is also the explicit Play.
   */
  const onStageClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      // The click that ends a long press opened the options; it is not
      // also a pause.
      if (longPress.consumed()) return;
      const target = event.target;
      if (
        !(target instanceof Element) ||
        // A portalled sheet's clicks, backdrop included, reach this
        // handler through React but are not on the pitch.
        !event.currentTarget.contains(target) ||
        target.closest(
          "button, a, input, textarea, select, [role='button'], [role='slider'], .cq-feed-overlay, .cq-feed-nav, .cq-feed-player-controls, .cq-feed-filter",
        ) !== null
      ) {
        return;
      }
      // With the display cleared, a tap brings it back and does nothing else.
      if (clearDisplay) {
        setClearDisplay(false);
        return;
      }
      const video = activeElement();
      if (video === null) return;
      if (video.paused) {
        setPausedAt(null);
        void video.play().catch(() => undefined);
      } else {
        video.pause();
        setPausedAt(index);
      }
    },
    [index, clearDisplay, longPress, activeElement],
  );

  // Wheel and trackpad: one item per gesture (spec §9.3).
  const wheel = useRef({ sum: 0, last: -Infinity, lockedUntil: 0 });
  const onWheel = useCallback(
    (event: React.WheelEvent) => {
      const now = event.timeStamp;
      const state = wheel.current;
      if (now < state.lockedUntil) {
        // Still the gesture that moved: its tail extends the lock.
        state.lockedUntil = now + WHEEL_LOCK_MS;
        state.last = now;
        return;
      }
      // A pause starts a new gesture; stray deltas from minutes ago do not
      // add up to a move.
      if (now - state.last > WHEEL_LOCK_MS) state.sum = 0;
      state.last = now;
      state.sum += event.deltaY;
      if (Math.abs(state.sum) < WHEEL_THRESHOLD) return;
      if (state.sum > 0) next();
      else previous();
      wheel.current = { sum: 0, last: now, lockedUntil: now + WHEEL_LOCK_MS };
    },
    [next, previous],
  );

  /**
   * Keyboard is the primary control, not an afterthought (doc 17 §66).
   * Arrows are the obvious ones, and j/k are there because someone
   * reviewing fifty companies will not reach for the arrow keys. The
   * listener is on the stage's own region rather than on `window`, and
   * the region takes focus on mount so the keys work at once.
   */
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const target = event.target;
      // Keys in a portalled sheet are the sheet's.
      if (target instanceof Node && !event.currentTarget.contains(target)) {
        return;
      }
      // Never steal a keystroke from something being typed into.
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
      ) {
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key === "ArrowDown" || event.key === "j") {
        event.preventDefault();
        next();
      } else if (event.key === "ArrowUp" || event.key === "k") {
        event.preventDefault();
        previous();
      } else if (
        event.key === " " &&
        !(event.target instanceof HTMLButtonElement) &&
        !(event.target instanceof HTMLAnchorElement)
      ) {
        // Space on a control is that control's; anywhere else in the feed
        // it plays or pauses.
        event.preventDefault();
        togglePlay();
      } else if (event.key === "m") {
        event.preventDefault();
        onMutedChange(!muted);
      } else if (
        (event.key === "ArrowLeft" || event.key === "ArrowRight") &&
        activeVideo !== null
      ) {
        // Back or forward through the pitch; j and k stay next/previous
        // (spec §9.3), so seeking is on the arrows beside them.
        event.preventDefault();
        seekBy(
          activeVideo,
          event.key === "ArrowLeft" ? -SEEK_STEP_SECONDS : SEEK_STEP_SECONDS,
        );
      } else if (event.key === "<" || event.key === ">") {
        event.preventDefault();
        const nextRate = stepPlaybackRate(rate, event.key === "<" ? -1 : 1);
        setRate(nextRate);
        setRateNote(`Speed ${rateLabel(nextRate)}`);
      } else if (event.key === "c") {
        event.preventDefault();
        setCaptionsOn((on) => !on);
      } else if (onExtraKey?.(event.key) === true) {
        event.preventDefault();
      }
    },
    [
      next,
      previous,
      togglePlay,
      muted,
      onMutedChange,
      activeVideo,
      rate,
      setRate,
      onExtraKey,
    ],
  );

  const card = items[index] ?? null;
  const hasCard = card !== null;
  useEffect(() => {
    if (hasCard) stageRef.current?.focus({ preventScroll: true });
  }, [hasCard]);

  /**
   * Swipe, linked to the finger (spec §9.3): the cards follow the drag,
   * and on release either settle back or move on with the 280 ms settle.
   * No bounce at either end. The offset is written as a custom property on
   * the media layer rather than held in state, so a drag re-renders
   * nothing.
   */
  const setDrag = useCallback((dy: number | null) => {
    const media = mediaRef.current;
    if (media === null) return;
    if (dy === null) {
      media.style.removeProperty("--cq-feed-drag");
      delete media.dataset["dragging"];
    } else {
      media.style.setProperty("--cq-feed-drag", `${String(dy)}px`);
      media.dataset["dragging"] = "";
    }
  }, []);

  const onTouchStart = useCallback((event: React.TouchEvent) => {
    // A touch in a portalled sheet (its backdrop) is not a feed gesture.
    if (
      event.target instanceof Node &&
      !event.currentTarget.contains(event.target)
    ) {
      drag.current = null;
      return;
    }
    const y = event.touches[0]?.clientY;
    // A touch without an x (some synthetic events) browses up and down.
    const x = event.touches[0]?.clientX ?? 0;
    drag.current =
      y === undefined
        ? null
        : { startY: y, startX: x, dy: 0, dx: 0, axis: null };
  }, []);

  /** The card follows a sideways finger, tilting like a card in a hand. */
  const setSideways = useCallback((dx: number | null) => {
    const media = mediaRef.current;
    const slot = media?.querySelector<HTMLElement>("[data-slot-active]");
    if (
      media === null ||
      media === undefined ||
      slot === null ||
      slot === undefined
    ) {
      return;
    }
    if (dx === null) {
      slot.style.removeProperty("translate");
      slot.style.removeProperty("rotate");
      delete media.dataset["swipe"];
      return;
    }
    slot.style.translate = `${String(dx)}px 0`;
    slot.style.rotate = `${String(dx / 24)}deg`;
    if (Math.abs(dx) > 60) {
      media.dataset["swipe"] = dx > 0 ? "interested" : "pass";
    } else {
      delete media.dataset["swipe"];
    }
  }, []);

  const decides = onDecide !== undefined;
  const onTouchMove = useCallback(
    (event: React.TouchEvent) => {
      const current = drag.current;
      const y = event.touches[0]?.clientY;
      const x = event.touches[0]?.clientX ?? current?.startX ?? 0;
      if (current === null || y === undefined) return;
      const dx = x - current.startX;
      if (current.axis === null) {
        if (Math.max(Math.abs(dx), Math.abs(y - current.startY)) < AXIS_LOCK) {
          return;
        }
        current.axis =
          decides && Math.abs(dx) > Math.abs(y - current.startY) ? "x" : "y";
      }
      if (current.axis === "x") {
        current.dx = dx;
        setSideways(dx);
        return;
      }
      let dy = y - current.startY;
      if ((dy > 0 && !canRetreat) || (dy < 0 && !canAdvance)) dy = 0;
      current.dy = dy;
      setDrag(dy);
    },
    [canAdvance, canRetreat, setDrag, setSideways, decides],
  );

  const onTouchEnd = useCallback(
    (event: React.TouchEvent) => {
      const current = drag.current;
      drag.current = null;
      setDrag(null);
      setSideways(null);
      if (current === null) return;
      if (current.axis === "x") {
        // Right keeps it (saved, optimistic); left passes. Expressing
        // interest stays its own confirmed step: it tells the founder.
        if (current.dx > DECIDE_THRESHOLD) onDecide?.("SAVE");
        else if (current.dx < -DECIDE_THRESHOLD) onDecide?.("PASS");
        return;
      }
      const end = event.changedTouches[0]?.clientY;
      const travelled = end === undefined ? -current.dy : current.startY - end;

      // A swipe, not a tap or a scroll nudge.
      if (Math.abs(travelled) < SWIPE_THRESHOLD) return;
      if (travelled > 0) next();
      else previous();
    },
    [next, previous, setDrag, setSideways, onDecide],
  );

  const onTouchCancel = useCallback(() => {
    drag.current = null;
    setDrag(null);
    setSideways(null);
  }, [setDrag, setSideways]);

  const shownPitch = card?.pitch ?? null;

  return (
    <div
      className="cq-stage cq-feed"
      data-feed-immersive
      data-clear-display={clearDisplay ? "" : undefined}
      data-scrubbing={scrubbing ? "" : undefined}
    >
      {before}
      <div
        ref={setStage}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchCancel}
        onKeyDown={onKeyDown}
        onWheel={onWheel}
        onClick={onStageClick}
        {...longPress.handlers}
        // A right-click on the pitch is the desktop's long press.
        onContextMenu={(event) => {
          const target = event.target;
          if (
            target instanceof Element &&
            target.closest("a, button, input, .cq-feed-overlay") !== null
          ) {
            return;
          }
          event.preventDefault();
          openOptions();
        }}
        // Programmatically focusable, not a tab stop: the controls inside
        // are the tab stops, and the region only needs focus so its keys
        // work from the moment the feed appears.
        tabIndex={-1}
        role="group"
        aria-label={label}
        className="cq-feed-stage outline-none"
        data-reduced-motion={reducedMotion ? "" : undefined}
      >
        <FeedMedia
          items={items}
          index={index}
          policyFor={policyFor}
          sourceFor={sourceFor}
          reducedMotion={reducedMotion}
          hold={hold}
          muted={muted}
          onMutedChange={onMutedChange}
          initialAuthorization={initialAuthorization}
          mediaRef={mediaRef}
          paused={tapPaused}
          rate={rate}
          captionsOn={captionsOn}
          offline={!online}
          onActiveElement={setActiveVideo}
          scrubber={
            card === null || shownPitch === null ? null : (
              <PitchScrubber
                key={`${card.companyId}:${shownPitch.mediaAssetId}`}
                video={activeVideo}
                durationSeconds={shownPitch.durationSeconds}
                companyName={card.canonicalName}
                onScrubbingChange={setScrubbing}
              />
            )
          }
        />

        <span className="sr-only" role="status">
          {tapPaused ? "Paused" : (rateNote ?? "")}
        </span>

        {top}

        {/*
          The caption's scrim (ADR 0047): stage canvas behind the words
          only, plus a text halo; the picture stays visible everywhere
          else. Owned by .cq-feed-overlay in globals.css. On a desktop the
          panel sits beside the pitch, in the app's theme.
        */}
        <div className="cq-feed-overlay">{overlay({ openOptions })}</div>

        {/*
          The explicit equivalents of the swipe, always present. Position is
          stated in words rather than by a progress bar, which would read as
          a score.
        */}
        <nav className="cq-feed-nav" aria-label="Move through the feed">
          <button
            type="button"
            className="cq-feed-nav-button"
            onClick={previous}
            disabled={!canRetreat}
            aria-label={previousLabel}
          >
            <ChevronUp
              aria-hidden="true"
              size={ICON_SIZE.prominent}
              strokeWidth={ICON_STROKE}
            />
          </button>
          <button
            type="button"
            className="cq-feed-nav-button"
            onClick={next}
            disabled={!canAdvance}
            aria-label={nextLabel}
          >
            <ChevronDown
              aria-hidden="true"
              size={ICON_SIZE.prominent}
              strokeWidth={ICON_STROKE}
            />
          </button>
        </nav>
      </div>

      {card === null || shownPitch === null ? null : (
        <PitchOptionsSheet
          open={optionsOpen}
          onOpenChange={setOptionsOpen}
          companyId={card.companyId}
          companyName={card.canonicalName}
          pitch={shownPitch}
          rate={rate}
          onRate={setRate}
          captionsOn={captionsOn}
          onCaptionsChange={setCaptionsOn}
          onClearDisplay={() => setClearDisplay(true)}
          onNotInterested={onNotInterested}
        />
      )}
    </div>
  );
}

/**
 * The keys, said once beside the pitch on a desktop (Discover v2). Active
 * only while the feed has focus (spec §9.3; WCAG 2.1.4).
 */
export function KeyHints() {
  return (
    <ul className="cq-feed-keys" aria-label="Keyboard shortcuts">
      <li>
        <kbd>↑</kbd>
        <kbd>↓</kbd> Previous, next
      </li>
      <li>
        <kbd>Space</kbd> Pause
      </li>
      <li>
        <kbd>←</kbd>
        <kbd>→</kbd> Back, forward 5 s
      </li>
      <li>
        <kbd>M</kbd> Sound
      </li>
      <li>
        <kbd>&lt;</kbd>
        <kbd>&gt;</kbd> Speed
      </li>
      <li>
        <kbd>C</kbd> Captions
      </li>
    </ul>
  );
}
