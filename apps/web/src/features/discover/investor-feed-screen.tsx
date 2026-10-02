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
  DiscoverFilters,
  DiscoveryCompanySlateDto,
  DiscoveryNoteDto,
  PlaybackAuthorizationDto,
  YourCompanyPitchItemDto,
} from "@capital-q/contracts";
import { Button, buttonClassName } from "@capital-q/ui/button";
import {
  ChevronDown,
  ChevronUp,
  ICON_SIZE,
  ICON_STROKE,
  Play,
  Users,
} from "@capital-q/ui/icons";
import { EmptyState } from "@capital-q/ui/states";

import { useGlobalQ, useQMomentSource } from "@/components/app-shell/global-q";
import { QAperture } from "@/features/q-aperture";
import { Q_FEED_EVENT } from "@/features/q/client-actions";
import { useQSessionOptional } from "@/features/q/q-session";
import { QPageSubject } from "@/features/q/q-subject";

import { FeedCard } from "./feed-card";
import { YourCompaniesRow } from "./your-companies";
import { ruleList } from "./mandate-rules";
import {
  actionFeedTransport,
  authorisePlaybackViaAction,
} from "./feed/action-feed-transport";
import type { FeedPreloadPolicy } from "./feed/feed-state";
import {
  DiscoverFilterButton,
  DiscoverFilterRow,
  DiscoverFilterSheet,
} from "./filters/discover-filter-controls";
import {
  filtersKey,
  isEmptyDiscoverFilters,
  type SectorOption,
} from "./filters/discover-filters";
import { useDiscoverFilters } from "./filters/use-discover-filters";
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
  SPLASH_DONE_EVENT,
  splashShowing,
} from "@/features/splash/splash-policy";

function subscribeSplash(onChange: () => void): () => void {
  window.addEventListener(SPLASH_DONE_EVENT, onChange);
  return () => window.removeEventListener(SPLASH_DONE_EVENT, onChange);
}
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
/** Sideways far enough to decide (founder direction 2026-09-29). */
const DECIDE_THRESHOLD = 110;
const AXIS_LOCK = 12;

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
  NONE_PASS_HARD_RULES:
    "Companies are discoverable, but your hard rules exclude every one of them.",
  NONE_MATCH_MANDATE:
    "Companies are discoverable, but none matches your mandate yet.",
  NONE_MATCH_FILTERS: "No companies match these filters.",
};

/** "12 companies are", "1 company is": the count is the market, not a score. */
function discoverableCompanies(count: number | null): string {
  if (count === null) return "Companies are";
  return count === 1 ? "1 company is" : `${String(count)} companies are`;
}

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
  paused,
}: {
  /** The person paused the card in view with a tap. */
  readonly paused: boolean;
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
      {paused ? (
        // Where the tap was answered. The tap region itself is the control,
        // so this is a picture of the state, not a second button.
        <span
          aria-hidden="true"
          data-feed-paused
          className="pointer-events-none absolute top-1/2 left-1/2 flex size-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-(--cq-stage-surface) text-(--cq-stage-text)"
        >
          <Play size={28} strokeWidth={ICON_STROKE} />
        </span>
      ) : null}
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
  /** The first cards' grants, read in parallel on the server. */
  readonly warm?: readonly {
    readonly companyId: string;
    readonly authorization: PlaybackAuthorizationDto;
  }[];
};

/**
 * Discover with its filters (ux/discover-filters). The filters belong to
 * this wrapper; the feed below is keyed by them, so a change of filters is
 * a new feed from the first page -- a fresh cursor, never a page of one
 * filter set continued under another. The server's first page is the
 * unfiltered one, so it seeds only an unfiltered feed.
 */
export function InvestorFeedScreen({
  initial = null,
  sectors = [],
  yours = [],
}: {
  readonly initial?: InvestorFeedInitial | null;
  /** The industry vocabulary, for the sector filter. */
  readonly sectors?: readonly SectorOption[];
  /** "Your companies" (2026-10-02): a row beside the feed, never in it. */
  readonly yours?: readonly YourCompanyPitchItemDto[];
} = {}) {
  const discoverFilters = useDiscoverFilters(sectors);
  const { filters, setFilters, clear, notice } = discoverFilters;
  const [sheetOpen, setSheetOpen] = useState(false);
  const unfiltered = isEmptyDiscoverFilters(filters);
  const openSheet = useCallback(() => setSheetOpen(true), []);
  const controls: FeedFilterControls = {
    active: !unfiltered,
    notice,
    button: <DiscoverFilterButton filters={filters} onOpen={openSheet} />,
    row: (className: string) => (
      <DiscoverFilterRow
        filters={filters}
        sectors={sectors}
        onChange={setFilters}
        onOpen={openSheet}
        className={className}
      />
    ),
    clear,
    yours: (className: string) => (
      <YourCompaniesRow items={yours} className={className} />
    ),
    hasYours: yours.length > 0,
  };
  return (
    <>
      <InvestorFeed
        key={filtersKey(filters)}
        initial={unfiltered ? initial : null}
        filters={unfiltered ? null : filters}
        controls={controls}
      />
      <DiscoverFilterSheet
        filters={filters}
        sectors={sectors}
        onChange={setFilters}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
      />
    </>
  );
}

type FeedFilterControls = {
  readonly active: boolean;
  readonly notice: string | null;
  /** The phone's button over the stage. */
  readonly button: React.ReactNode;
  /** The row, with the classes that decide where it shows. */
  readonly row: (className: string) => React.ReactNode;
  readonly clear: () => void;
  /** "Your companies", with the classes that decide where it shows. */
  readonly yours: (className: string) => React.ReactNode;
  /** Whether there is a "Your companies" row to reach (the phone's entry). */
  readonly hasYours: boolean;
};

function InvestorFeed({
  initial,
  filters,
  controls,
}: {
  readonly initial: InvestorFeedInitial | null;
  readonly filters: DiscoverFilters | null;
  readonly controls: FeedFilterControls;
}) {
  const transport = useMemo(() => actionFeedTransport(filters), [filters]);
  const reducedMotion = useReducedMotionPreference();
  const budget = useFeedBudget();
  const feed = useInvestorFeed({
    transport,
    budget,
    initialSlate: initial?.slate ?? null,
    // A filtered scroll is not the position to come back to: restoring it
    // could page through the whole slate looking for a filtered-out card.
    ...(filters === null ? {} : { positionStore: null }),
  });
  const { setOpen, open: qOpen } = useGlobalQ();
  const session = useQSessionOptional();
  // Sound on, like TikTok (founder direction 2026-09-29). Where the
  // browser refuses sound before the first tap, the player starts muted
  // and turns the sound on at that tap by itself.
  // Under reduced motion nothing plays by itself and audio stays off until
  // the person turns it on (ADR-001 D5); null is "not chosen yet".
  const [chosenMuted, setMuted] = useState<boolean | null>(null);
  const muted = chosenMuted ?? reducedMotion;
  // Which of a company's videos is showing (ADR 0022); the first (newest)
  // unless the person moved on. The item stays one company, ranked once.
  const [videoOf, setVideoOf] = useState<Readonly<Record<string, number>>>({});
  const withVideo = useCallback(
    (item: DiscoveredCompanyDto): DiscoveredCompanyDto => {
      const at = videoOf[item.companyId] ?? 0;
      if (at === 0 || item.pitch === null) return item;
      const all = [item.pitch, ...(item.morePitches ?? [])];
      return { ...item, pitch: all[at % all.length] ?? item.pitch };
    },
    [videoOf],
  );
  const shownItems = useMemo(
    () => feed.state.items.map(withVideo),
    [feed.state.items, withVideo],
  );
  // One owner for this feed's playback authorizations, seeded with the one
  // the server read for the first card (see playback-authorizations.ts).
  const initialAuthorization = initial?.authorization ?? null;
  const firstCompanyId = initial?.slate.items[0]?.companyId ?? null;
  const [authorizations] = useState<FeedPlaybackAuthorizations>(() =>
    feedPlaybackAuthorizations(authorisePlaybackViaAction, {
      seed: [
        ...(initial?.warm ?? []),
        ...(initialAuthorization === null || firstCompanyId === null
          ? []
          : [
              {
                companyId: firstCompanyId,
                authorization: initialAuthorization,
              },
            ]),
      ],
    }),
  );

  const stageRef = useRef<HTMLDivElement>(null);
  const mediaRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    readonly startY: number;
    readonly startX: number;
    dy: number;
    dx: number;
    /** Decided by the first few pixels: up/down browses, sideways decides. */
    axis: "x" | "y" | null;
  } | null>(null);

  const { next, previous } = feed;

  /*
   * Where in the pitch the person is when they open Q, however they open
   * it: the rail's Ask Q, the dock, or Ctrl/Cmd+K. Read from the element at
   * that instant (it is the truth about the position), never tracked.
   */
  const cardRef = useRef(feed.card === null ? null : withVideo(feed.card));
  useEffect(() => {
    cardRef.current = feed.card === null ? null : withVideo(feed.card);
  }, [feed.card, withVideo]);
  useQMomentSource(() => {
    const current = cardRef.current;
    if (current === null) return null;
    // No pitch playing or paused (poster, or none): still "this company"
    // for Q (R21), without a moment.
    const company = {
      kind: "SCREEN_COMPANY" as const,
      companyId: current.companyId,
      companyLabel: current.canonicalName,
    };
    if (current.pitch === null) return company;
    const video = stageRef.current?.querySelector<HTMLVideoElement>(
      "[data-slot-active] video",
    );
    if (video === null || video === undefined) return company;
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
  /*
   * Tap to pause (founder directive, 2026-09-27). A pause the person asked
   * for belongs to the card they asked on: moving to another card starts
   * that one normally, and coming back does not resume this one by itself.
   */
  const [pausedAt, setPausedAt] = useState<number | null>(null);
  const tapPaused = pausedAt === index;
  // The splash covers the first pitch; it starts the moment the splash goes.
  const splashUp = useSyncExternalStore(
    subscribeSplash,
    splashShowing,
    () => false,
  );
  const hold = settledAt !== index || tabHidden || tapPaused || splashUp;
  // While the voice line is open the pitch stays muted, not only while Q
  // speaks: the microphone heard the video's words as the person's and cut
  // Q off (live 2026-09-30: runs cancelled mid-"I'm interested").
  const voiceOpen = session?.voice.active === true;
  const effectiveMuted = muted || qOpen || qSpeaking || voiceOpen;

  /** Space plays or pauses the pitch in view; the element is the truth. */
  const togglePlay = useCallback(() => {
    const video = stageRef.current?.querySelector<HTMLVideoElement>(
      "[data-slot-active] video",
    );
    if (video === null || video === undefined) return;
    if (video.paused) void video.play().catch(() => undefined);
    else video.pause();
  }, []);

  /**
   * A tap on the pitch itself -- not on the overlay, the rail or a
   * control -- pauses or resumes it. Under reduced motion nothing plays by
   * itself, so the tap is also the explicit Play.
   */
  const onStageClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const target = event.target;
      if (
        !(target instanceof Element) ||
        // The details sheet is portalled: its clicks, backdrop included,
        // reach this handler through React but are not on the pitch.
        !event.currentTarget.contains(target) ||
        target.closest(
          "button, a, input, textarea, select, [role='button'], .cq-feed-overlay, .cq-feed-nav, .cq-feed-player-controls",
        ) !== null
      ) {
        return;
      }
      const video = stageRef.current?.querySelector<HTMLVideoElement>(
        "[data-slot-active] video",
      );
      if (video === null || video === undefined) return;
      if (video.paused) {
        setPausedAt(null);
        void video.play().catch(() => undefined);
      } else {
        video.pause();
        setPausedAt(index);
      }
    },
    [index],
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
      // Keys in the portalled details sheet are the sheet's.
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
        setMuted((current) => !(current ?? reducedMotion));
      }
    },
    [next, previous, togglePlay, reducedMotion],
  );

  // Q's moves on the feed (founder report 2026-09-30: "say next and it
  // goes to the next one... pass should go straight to the next video"):
  // the same controls as the keys and buttons.
  const cardForQ = feed.card;
  useEffect(() => {
    const onQ = (event: Event) => {
      const act: unknown =
        event instanceof CustomEvent ? (event.detail as unknown) : null;
      if (act === "NEXT_ITEM") next();
      else if (act === "PREVIOUS_ITEM") previous();
      else if (act === "PASS_CURRENT" && cardForQ !== null) {
        feed.pass(cardForQ.companyId);
        next();
      } else if (
        act === "SAVE_CURRENT" &&
        cardForQ !== null &&
        !feed.decisionFor(cardForQ.companyId).saved
      ) {
        feed.save(cardForQ.companyId);
      }
    };
    window.addEventListener(Q_FEED_EVENT, onQ);
    return () => window.removeEventListener(Q_FEED_EVENT, onQ);
  }, [next, previous, feed, cardForQ]);

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
        current.axis = Math.abs(dx) > Math.abs(y - current.startY) ? "x" : "y";
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
    [canAdvance, canRetreat, setDrag, setSideways],
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
        const decided = feed.card;
        if (decided === null) return;
        if (current.dx > DECIDE_THRESHOLD) {
          if (!feed.decisionFor(decided.companyId).saved) {
            feed.save(decided.companyId);
          }
          next();
        } else if (current.dx < -DECIDE_THRESHOLD) {
          feed.pass(decided.companyId);
          next();
        }
        return;
      }
      const end = event.changedTouches[0]?.clientY;
      const travelled = end === undefined ? -current.dy : current.startY - end;

      // A swipe, not a tap or a scroll nudge.
      if (Math.abs(travelled) < SWIPE_THRESHOLD) return;
      if (travelled > 0) next();
      else previous();
    },
    [next, previous, setDrag, setSideways, feed],
  );

  const onTouchCancel = useCallback(() => {
    drag.current = null;
    setDrag(null);
    setSideways(null);
  }, [setDrag, setSideways]);

  const card = feed.card;
  const notes = feed.state.notes;
  // While the slate is still being built, look again every few seconds
  // (bounded) instead of asking the person to refresh (founder 2026-09-28).
  const building =
    card === null && notes.includes("RECOMMENDATIONS_REFRESHING");
  useEffect(() => {
    if (!building) {
      try {
        window.sessionStorage.removeItem("cq-discover-building");
      } catch {
        // Nothing to reset.
      }
      return;
    }
    // Counted across reloads so a slate that never builds stops after ~1 min.
    const readTries = () => {
      try {
        return Number(
          window.sessionStorage.getItem("cq-discover-building") ?? "0",
        );
      } catch {
        return 0;
      }
    };
    const timer = window.setInterval(() => {
      const tries = readTries() + 1;
      try {
        window.sessionStorage.setItem("cq-discover-building", String(tries));
      } catch {
        // Without storage the ten-reload bound below is per page only.
      }
      if (tries > 10) {
        window.clearInterval(timer);
        return;
      }
      // Only this empty "building" screen reloads; nothing is lost.
      window.location.reload();
    }, 6000);
    return () => window.clearInterval(timer);
  }, [building]);
  const { unverifiableExclusions, excludingRules, discoverableCount } =
    feed.state;
  /*
    Said once per feed, never per card (ADR 0020): a declared exclusion V1
    cannot evaluate for anybody withholds nobody, and the investor is told
    so rather than shown a feed that silently ignores the rule.
  */
  const unverifiableLine =
    unverifiableExclusions.length === 0 ? null : (
      <p className="cq-status-line">
        Your {ruleList(unverifiableExclusions)} exclusion
        {unverifiableExclusions.length === 1 ? " can't" : "s can't"} be checked
        automatically yet, so nobody is hidden because of{" "}
        {unverifiableExclusions.length === 1 ? "it" : "them"}.
      </p>
    );

  if (feed.state.status === "LOADING_FIRST") {
    return <p className="cq-status-line">Loading your recommendations…</p>;
  }

  if (
    card === null &&
    controls.active &&
    feed.state.status !== "FAILED" &&
    !notes.includes("NO_ACTIVE_MANDATE") &&
    !notes.includes("RECOMMENDATIONS_REFRESHING")
  ) {
    /*
      The reader's own filters emptied the feed: say that, and offer the
      way back, rather than a sentence about the market that the filters,
      not the market, made true.
    */
    return (
      <div className="flex flex-col gap-4">
        {controls.row("flex")}
        {controls.notice === null ? null : (
          <p className="cq-status-line">{controls.notice}</p>
        )}
        <EmptyState
          title="No companies match these filters."
          description="Your recommendations are unchanged; these filters leave none of them in view."
          action={
            <Button variant="primary" onClick={controls.clear}>
              Clear filters
            </Button>
          }
        />
      </div>
    );
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
    ) : notes.includes("NONE_PASS_HARD_RULES") ? (
      /*
        Companies exist and the investor's own hard rules removed them.
        Saying "nobody is discoverable" here was the live defect: the way
        forward is the rules, so they are named and one tap away.
      */
      <div className="flex flex-col gap-4">
        {unverifiableLine}
        <EmptyState
          title={`${discoverableCompanies(discoverableCount)} discoverable. None passes your hard rules.`}
          description={
            excludingRules.length === 0
              ? "Every discoverable company is excluded by a rule in your mandate."
              : `Your ${ruleList(excludingRules)} exclusion${excludingRules.length === 1 ? "" : "s"} currently exclude${excludingRules.length === 1 ? "s" : ""} every one of them.`
          }
          action={
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href="/onboarding/investor?review=1"
                className={buttonClassName("primary")}
              >
                Review my hard rules
              </Link>
              <Button variant="secondary" onClick={() => setOpen(true)}>
                Ask Q
              </Button>
            </div>
          }
        />
      </div>
    ) : notes.includes("NONE_MATCH_MANDATE") ? (
      <div className="flex flex-col gap-4">
        {unverifiableLine}
        <EmptyState
          title={`${discoverableCompanies(discoverableCount)} discoverable. None matches your mandate yet.`}
          description="They pass your hard rules, but none shares a stage, country or sector you named. Widening your mandate is what brings them in."
          action={
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href="/onboarding/investor?review=1"
                className={buttonClassName("secondary")}
              >
                Review my mandate
              </Link>
              <Button variant="secondary" onClick={() => setOpen(true)}>
                Ask Q
              </Button>
            </div>
          }
        />
      </div>
    ) : notes.includes("RECOMMENDATIONS_REFRESHING") ? (
      <div className="flex flex-col gap-4">
        <Notes notes={notes} />
        {unverifiableLine}
        <EmptyState
          title="Building your list."
          description="Q is matching discoverable companies to your mandate. Check back in a moment."
        />
      </div>
    ) : (
      <div className="flex flex-col gap-4">
        <Notes notes={notes} />
        <EmptyState
          title="Nothing to review yet."
          description="Companies appear here as founders choose to be discoverable. Companies you saved or passed on are kept in Saved and Passed, with their pitches."
          action={
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" onClick={() => setOpen(true)}>
                Ask Q
              </Button>
              <SavedAndPassedLinks className="flex" />
              {controls.yours("flex")}
            </div>
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
        onClick={onStageClick}
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
          items={shownItems}
          index={index}
          policyFor={(companyId) => policyByCompanyId[companyId] ?? "NONE"}
          sourceFor={authorizations.sourceFor}
          reducedMotion={reducedMotion}
          hold={hold}
          muted={effectiveMuted}
          onMutedChange={setMuted}
          initialAuthorization={initialAuthorization}
          mediaRef={mediaRef}
          paused={tapPaused}
        />

        <span className="sr-only" role="status">
          {tapPaused ? "Paused" : ""}
        </span>

        {/* One compact control over the pitch; the row is the desktop's. */}
        <div className="cq-feed-filter flex gap-2 lg:hidden">
          {/* Your companies, one tap from the stage on a phone (2026-10-02). */}
          {controls.hasYours ? (
            <Link
              href="/discover/yours"
              aria-label="Your companies"
              className="cq-feed-filter-button"
              data-your-companies-entry
            >
              <Users size={ICON_SIZE.regular} aria-hidden="true" />
            </Link>
          ) : null}
          {controls.button}
        </div>

        {/*
          The scrim is always there on a phone (founder feedback,
          2026-09-27): stage canvas, solid at the bottom and at least 92%
          under every line of text, fading out only in the overlay's top
          padding, so the words keep ≥4.5:1 whatever frame is behind them.
          The stage is dark in both themes (ADR 0017), so the scrim is too.
          On a desktop the panel sits beside the pitch, on the canvas.
        */}
        <div className="cq-feed-overlay bg-[linear-gradient(to_top,var(--cq-stage-canvas)_0%,color-mix(in_oklch,var(--cq-stage-canvas)_92%,transparent)_calc(100%-48px),transparent_100%)] lg:bg-none">
          {controls.row("hidden lg:flex")}
          <SavedAndPassedLinks className="hidden lg:flex" />
          {controls.yours("hidden lg:flex")}
          <FeedCard
            key={card.companyId}
            company={withVideo(card)}
            videos={
              card.pitch === null || (card.morePitches ?? []).length === 0
                ? undefined
                : {
                    index: videoOf[card.companyId] ?? 0,
                    count: 1 + (card.morePitches ?? []).length,
                    onNext: () =>
                      setVideoOf((known) => ({
                        ...known,
                        [card.companyId]:
                          ((known[card.companyId] ?? 0) + 1) %
                          (1 + (card.morePitches ?? []).length),
                      })),
                  }
            }
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
            feedNotes={
              notes.length === 0 &&
              unverifiableLine === null &&
              controls.notice === null ? null : (
                <div className="flex flex-col gap-1">
                  <Notes notes={notes} />
                  {unverifiableLine}
                  {controls.notice === null ? null : (
                    <p className="cq-status-line">{controls.notice}</p>
                  )}
                </div>
              )
            }
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

/**
 * Saved and Passed, one tap from the feed (doc 19 §66–68): a pass or a
 * save takes a company out of the stream, never out of reach.
 */
function SavedAndPassedLinks({ className }: { readonly className: string }) {
  return (
    <nav
      aria-label="Saved and passed companies"
      className={`${className} flex-wrap items-center gap-2`}
    >
      <Link href="/discover/saved" className={buttonClassName("quiet")}>
        Saved
      </Link>
      <Link href="/discover/passed" className={buttonClassName("quiet")}>
        Passed
      </Link>
    </nav>
  );
}
