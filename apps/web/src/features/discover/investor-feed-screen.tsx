"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import type {
  DiscoveredCompanyDto,
  DiscoveryCompanySlateDto,
  DiscoveryNoteDto,
  PlaybackAuthorizationDto,
} from "@capital-q/contracts";
import { Button, buttonClassName } from "@capital-q/ui/button";
import {
  ChevronDown,
  ChevronUp,
  ICON_SIZE,
  ICON_STROKE,
} from "@capital-q/ui/icons";
import { EmptyState } from "@capital-q/ui/states";

import { useGlobalQ, useQMomentSource } from "@/components/app-shell/global-q";
import { QAperture } from "@/features/q-aperture";
import { useQSessionOptional } from "@/features/q/q-session";
import { QPageSubject } from "@/features/q/q-subject";

import { FeedCard } from "./feed-card";
import {
  actionFeedTransport,
  authorisePlaybackViaAction,
} from "./feed/action-feed-transport";
import type { FeedPreloadPolicy } from "./feed/feed-state";
import {
  feedPlaybackAuthorizations,
  type FeedPlaybackAuthorizations,
} from "./feed/playback-authorizations";
import { useFeedBudget } from "./feed/use-feed-budget";
import { useInvestorFeed } from "./feed/use-investor-feed";
import type { PlaybackSource } from "./player/pitch-playback";
import { attachHlsOrNativeSource } from "./player/hls-source";
import { PitchPlayer } from "./player/pitch-player";
import {
  usePitchPlayback,
  useReducedMotionPreference,
} from "./player/use-pitch-playback";

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

/**
 * Discover, for an investor (CQ-WEB-022).
 *
 * One controller owns the feed; this is its surface. Moving between cards
 * is local — no request, no Q call, no beacon — because viewing is not
 * interest. Only Save, Pass and Express Interest talk to the server, and
 * only because a person asked them to; the first two optimistically, the
 * last only once the server has confirmed it (CQ-NET-010).
 */

const NOTE_TEXT: Readonly<Record<DiscoveryNoteDto, string>> = {
  NO_ACTIVE_MANDATE:
    "You have no active mandate yet, so nothing here is matched to you. Finish your mandate and Q will match on what you declared.",
  MANDATE_HAS_NO_PREFERENCES:
    "Your mandate does not name a stage, sector or geography yet. Adding them is what turns this into a shortlist.",
  NO_DISCOVERABLE_COUNTERPARTS:
    "Nobody has made themselves discoverable yet. This fills as founders choose to be found.",
  RANKED_ON_DECLARED_PROFILE_ONLY:
    "Ordered by what each company has declared. Nothing private is read to build this.",
  RECOMMENDATIONS_REFRESHING:
    "Your recommendations are being prepared. Check back in a moment.",
  SLATE_RESTARTED:
    "Your recommendations were refreshed while you were browsing, so this starts again from the top.",
};

/**
 * The media layer: at most three players, recycled (spec §9.5). The card
 * at index i always lives in slot i % 3, so when the reader moves on, the
 * next card's element -- already holding its startup buffer -- becomes the
 * active one in place, and only the slot that fell two behind is handed
 * the new next card. The preload tier of each is the controller's.
 *
 * A card the controller has put in the POSTER tier but that has no slot
 * (the one after next, on a link that affords the full window) gets its
 * poster warmed as an image and no `<video>` at all: three media elements
 * is the ceiling, and a poster is not media.
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
}: {
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
  for (const offset of [-1, 0, 1]) {
    const at = index + offset;
    const item = items[at];
    if (item !== undefined) slots.push({ key: String(at % 3), offset, item });
  }
  const warm = items.filter(
    (item, at) =>
      Math.abs(at - index) > 1 &&
      item.pitch !== null &&
      policyFor(item.companyId) === "POSTER",
  );
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
                No pitch video yet
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
            />
          )}
        </div>
      ))}
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

/** A hidden tab plays nothing (spec §9.5 4). */
function subscribeVisibility(onChange: () => void): () => void {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}

/**
 * What the server read for this render: the slate's first page and, when
 * its first company has a pitch, this viewer's playback authorization for
 * it -- together they put the first poster in the HTML (spec §9.5).
 */
export type InvestorFeedInitial = {
  readonly slate: DiscoveryCompanySlateDto;
  readonly authorization: PlaybackAuthorizationDto | null;
};

export function InvestorFeedScreen({
  initial = null,
}: {
  readonly initial?: InvestorFeedInitial | null;
} = {}) {
  const transport = useMemo(() => actionFeedTransport(), []);
  const reducedMotion = useReducedMotionPreference();
  const budget = useFeedBudget();
  const feed = useInvestorFeed({
    transport,
    budget,
    initialSlate: initial?.slate ?? null,
  });
  const { setOpen, open: qOpen } = useGlobalQ();
  const session = useQSessionOptional();
  const [muted, setMuted] = useState(true);
  // One owner for this feed's playback authorizations, seeded with the one
  // the server read for the first card (see playback-authorizations.ts).
  const initialAuthorization = initial?.authorization ?? null;
  const firstCompanyId = initial?.slate.items[0]?.companyId ?? null;
  const [authorizations] = useState<FeedPlaybackAuthorizations>(() =>
    feedPlaybackAuthorizations(authorisePlaybackViaAction, {
      seed:
        initialAuthorization === null || firstCompanyId === null
          ? null
          : { companyId: firstCompanyId, authorization: initialAuthorization },
    }),
  );

  const stageRef = useRef<HTMLDivElement>(null);
  const mediaRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ readonly startY: number; dy: number } | null>(null);

  const { next, previous } = feed;

  /*
   * Where in the pitch the person is when they open Q, however they open
   * it: the rail's Ask Q, the dock, or Ctrl/Cmd+K. Read from the element at
   * that instant (it is the truth about the position), never tracked.
   */
  const cardRef = useRef(feed.card);
  useEffect(() => {
    cardRef.current = feed.card;
  }, [feed.card]);
  useQMomentSource(() => {
    const current = cardRef.current;
    if (current === null || current.pitch === null) return null;
    const video = stageRef.current?.querySelector<HTMLVideoElement>(
      "[data-slot-active] video",
    );
    if (video === null || video === undefined) return null;
    return {
      kind: "PITCH_MOMENT",
      companyId: current.companyId,
      companyLabel: current.canonicalName,
      mediaAssetId: current.pitch.mediaAssetId,
      positionSeconds: Math.max(0, Math.floor(video.currentTime || 0)),
    };
  });

  /**
   * Settling: a card becomes ACTIVE for playback only once the move to it
   * has finished (spec §9.5), so a quick run through three cards starts
   * nothing on the two it passed.
   */
  const index = feed.state.index;
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
   * Q watches the pitch with the person (founder direction, 2026-09-26):
   * opening Q does not stop the video. It keeps playing behind the sheet,
   * muted, until the person pauses it; the sound comes back when Q closes
   * if they had turned it on. Q speaking mutes it the same way. This
   * supersedes spec §9.5 4's pause-while-Q-speaks and the mobile sheet
   * pause. Playback still waits for a move to settle and for a hidden tab.
   */
  const tabHidden = useSyncExternalStore(
    subscribeVisibility,
    () => document.visibilityState === "hidden",
    () => false,
  );
  const qSpeaking = session?.voice.client.state === "Q_SPEAKING";
  const hold = settledAt !== index || tabHidden;
  const effectiveMuted = muted || qOpen || qSpeaking;

  /** Space plays or pauses the pitch in view; the element is the truth. */
  const togglePlay = useCallback(() => {
    const video = stageRef.current?.querySelector<HTMLVideoElement>(
      "[data-slot-active] video",
    );
    if (video === null || video === undefined) return;
    if (video.paused) void video.play().catch(() => undefined);
    else video.pause();
  }, []);

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
   * Keyboard is the primary control, not an afterthought.
   *
   * Doc 17 §66: every critical gesture also needs an explicit accessible
   * action. Arrows are the obvious ones, and j/k are there because someone
   * reviewing fifty companies will not reach for the arrow keys.
   *
   * The listener is on the feed's own region rather than on `window`. A
   * global one answers for a feed the reader is not in — another feed, a
   * dialog over the top, a tree that has not finished unmounting — and
   * "which feed did that arrow key move?" is not a question this should
   * be able to raise. The region takes focus on mount so the keys work
   * without asking the reader to click the page first.
   */
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const target = event.target;
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
        setMuted((current) => !current);
      }
    },
    [next, previous, togglePlay],
  );

  const hasCard = feed.card !== null;
  useEffect(() => {
    if (hasCard) stageRef.current?.focus({ preventScroll: true });
  }, [hasCard]);

  /**
   * Swipe, linked to the finger (spec §9.3): the cards follow the drag,
   * and on release either settle back or move on with the 280 ms settle.
   * No bounce at either end -- the first card does not pull down and the
   * last does not pull up. The offset is written as a custom property on
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

  const { canAdvance, canRetreat } = feed;
  const onTouchStart = useCallback((event: React.TouchEvent) => {
    const y = event.touches[0]?.clientY;
    drag.current = y === undefined ? null : { startY: y, dy: 0 };
  }, []);

  const onTouchMove = useCallback(
    (event: React.TouchEvent) => {
      const current = drag.current;
      const y = event.touches[0]?.clientY;
      if (current === null || y === undefined) return;
      let dy = y - current.startY;
      if ((dy > 0 && !canRetreat) || (dy < 0 && !canAdvance)) dy = 0;
      current.dy = dy;
      setDrag(dy);
    },
    [canAdvance, canRetreat, setDrag],
  );

  const onTouchEnd = useCallback(
    (event: React.TouchEvent) => {
      const current = drag.current;
      drag.current = null;
      setDrag(null);
      if (current === null) return;
      const end = event.changedTouches[0]?.clientY;
      const travelled = end === undefined ? -current.dy : current.startY - end;

      // A swipe, not a tap or a scroll nudge.
      if (Math.abs(travelled) < SWIPE_THRESHOLD) return;
      if (travelled > 0) next();
      else previous();
    },
    [next, previous, setDrag],
  );

  const onTouchCancel = useCallback(() => {
    drag.current = null;
    setDrag(null);
  }, [setDrag]);

  const card = feed.card;
  const notes = feed.state.notes;

  if (feed.state.status === "LOADING_FIRST") {
    return <p className="cq-status-line">Loading your recommendations…</p>;
  }

  if (card === null) {
    /*
      A feed that could not load is not an empty feed. Saying "nothing to
      review" when the request failed tells the reader something false
      about the market rather than something true about the app.
    */
    return feed.state.status === "FAILED" ? (
      <EmptyState
        title="Discover couldn't load."
        description="Nothing is wrong with your mandate. Try again in a moment."
      />
    ) : notes.includes("NO_ACTIVE_MANDATE") ? (
      /*
        Empty because the mandate is unfinished, not because nobody is
        discoverable. Saying "companies appear as founders choose to be
        discoverable" here told an investor something untrue about the
        market and gave them nowhere to go (CQ-ACCEPT-001). The way forward
        is the mandate; Q is one tap away for anything else.
      */
      <div className="flex flex-col gap-4">
        <EmptyState
          title="Finish your mandate to see companies."
          description="Discover ranks companies against what you declared. Your mandate isn't active yet, so there is nothing to rank them against."
          action={
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href="/onboarding/investor"
                className={buttonClassName("primary")}
              >
                Finish my mandate
              </Link>
              <Button variant="secondary" onClick={() => setOpen(true)}>
                Ask Q
              </Button>
            </div>
          }
        />
      </div>
    ) : (
      <div className="flex flex-col gap-4">
        <Notes notes={notes} />
        <EmptyState
          title="Nothing to review yet."
          description="Companies appear here as founders choose to be discoverable. Q can tell you about any of them once they do."
          action={
            <Button variant="secondary" onClick={() => setOpen(true)}>
              Ask Q
            </Button>
          }
        />
      </div>
    );
  }

  const decision = feed.decisionFor(card.companyId);
  const policyByCompanyId = feed.prefetch.policyByCompanyId;

  return (
    <div className="cq-stage cq-feed" data-feed-immersive>
      {/*
        Q looks at the card the person is looking at. Declaring it grants
        nothing — the Q API resolves and authorises the subject again.
      */}
      <QPageSubject
        subject={{
          kind: "COMPANY",
          companyId: card.companyId,
          label: card.canonicalName,
          scope: "network_visible",
        }}
      />

      <div
        ref={stageRef}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchCancel}
        onKeyDown={onKeyDown}
        onWheel={onWheel}
        // Programmatically focusable, not a tab stop: the controls inside
        // are the tab stops, and the region only needs focus so its keys
        // work from the moment the feed appears.
        tabIndex={-1}
        role="group"
        aria-label="Companies to review"
        className="cq-feed-stage outline-none"
        data-reduced-motion={reducedMotion ? "" : undefined}
      >
        <FeedMedia
          items={feed.state.items}
          index={index}
          policyFor={(companyId) => policyByCompanyId[companyId] ?? "NONE"}
          sourceFor={authorizations.sourceFor}
          reducedMotion={reducedMotion}
          hold={hold}
          muted={effectiveMuted}
          onMutedChange={setMuted}
          initialAuthorization={initialAuthorization}
          mediaRef={mediaRef}
        />

        <div className="cq-feed-overlay">
          <Notes notes={notes} />
          <FeedCard
            key={card.companyId}
            company={card}
            policy={policyByCompanyId[card.companyId] ?? "ACTIVE"}
            reducedMotion={reducedMotion}
            saved={decision.saved}
            deciding={feed.isDeciding(card.companyId)}
            showMedia={false}
            askQMark={
              <QAperture state={session?.presence.state ?? "IDLE"} size={24} />
            }
            onSave={() =>
              decision.saved
                ? feed.unsave(card.companyId)
                : feed.save(card.companyId)
            }
            onPass={() => {
              feed.pass(card.companyId);
              // Passing moves on. The record and the movement are separate
              // so a keyboard pass can choose not to.
              next();
            }}
            onAskQ={() => setOpen(true)}
          />
        </div>

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
            disabled={!feed.canRetreat}
            aria-label="Previous company"
          >
            <ChevronUp
              aria-hidden="true"
              size={ICON_SIZE.prominent}
              strokeWidth={ICON_STROKE}
            />
          </button>
          <p
            className="cq-caption cq-numeric text-(--cq-text-secondary)"
            aria-live="polite"
          >
            {feed.state.index + 1} of {feed.state.items.length}
            {feed.state.nextCursor === null ? "" : "+"}
          </p>
          <button
            type="button"
            className="cq-feed-nav-button"
            onClick={next}
            disabled={!feed.canAdvance}
            aria-label="Next company"
          >
            <ChevronDown
              aria-hidden="true"
              size={ICON_SIZE.prominent}
              strokeWidth={ICON_STROKE}
            />
          </button>
        </nav>
      </div>
    </div>
  );
}

function Notes({ notes }: { readonly notes: readonly DiscoveryNoteDto[] }) {
  if (notes.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      {notes.map((note) => (
        // A status line, not an error: none of these is a fault, and a
        // warning tone would tell the reader something untrue.
        <p key={note} className="cq-status-line">
          {NOTE_TEXT[note]}
        </p>
      ))}
    </div>
  );
}
