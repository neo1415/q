"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import type {
  YourCompaniesPageDto,
  YourCompanyLabel,
  YourCompanyPitchItemDto,
} from "@capital-q/contracts";
import { Button, buttonClassName } from "@capital-q/ui/button";
import {
  ICON_SIZE,
  ICON_STROKE,
  MoreHorizontal,
  Play,
  Share2,
  Users,
} from "@capital-q/ui/icons";
import { EmptyState } from "@capital-q/ui/states";

import { useGlobalQ } from "@/components/app-shell/global-q";
import {
  CompanyAvatar,
  CompanyAvatarLink,
} from "@/features/company/company-avatar";
import { QAperture } from "@/features/q-aperture";
import { EntityCover } from "@/features/entity/entity-avatar";
import { countryLabel, stageLabel } from "@/features/company/declared-labels";
import { QPageSubject } from "@/features/q/q-subject";

import { asPlayable } from "./company-pitch";
import { useDiscoverTab } from "./discover-tab";
import { actionPlaybackSource } from "./feed/action-feed-transport";
import { loadYourCompaniesAction } from "./feed/feed-actions";
import type { FeedPreloadPolicy } from "./feed/feed-state";
import { attachHlsOrNativeSource } from "./player/hls-source";
import { PitchPlayer } from "./player/pitch-player";
import { useReducedMotionPreference } from "./player/use-pitch-playback";
import { shareCompany, type ShareOutcome } from "./share-company";
import { FeedSkeleton } from "./stage/feed-skeleton";
import { useLongPress } from "./stage/long-press";
import { useOnline } from "./stage/online";
import { PitchOptionsSheet } from "./stage/pitch-options";
import {
  stepPlaybackRate,
  usePlaybackRate,
  type PlaybackRate,
} from "./stage/playback-rate";
import { PitchScrubber, SEEK_STEP_SECONDS, seekBy } from "./stage/scrubber";

/**
 * "Your companies" (founder decisions 2026-10-02 and 2026-10-04):
 * Discover's second tab, like TikTok's Following beside For You. Every
 * company the investor is connected with (and later), has expressed
 * interest in, or saved, most recent activity first, one full-height card
 * at a time. A company's pitch plays only when the company makes it
 * available to them -- the API carries it only then, and authorises each
 * play again; otherwise the card says "Pitch not shared" and links the
 * profile, never a broken player. The recommended feed never lists these
 * companies; nothing here touches its ranking.
 *
 * Media rules (CLAUDE.md, doc 20): one active player (the card in view;
 * the active-player claim pauses any other), the next card a poster at
 * most, nothing else fetched; video bytes go browser to CDN under a
 * signed authorization; under reduced motion nothing plays by itself.
 */

export const YOUR_COMPANY_LABEL_WORDS: Readonly<
  Record<YourCompanyLabel, string>
> = {
  CONNECTED: "Connected",
  INTERESTED: "Interest expressed",
  SAVED: "Saved",
};

/** The preload tier for a card, from where it sits against the one in view. */
export function yourCompaniesPolicy(
  index: number,
  active: number,
): FeedPreloadPolicy {
  if (index === active) return "ACTIVE";
  if (index === active + 1) return "POSTER";
  return "NONE";
}

/** How many pages a "show me X's pitch" may read looking for X. */
const FOCUS_PAGES_MAX = 3;

function subscribeVisibility(onChange: () => void): () => void {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}

function YourCompanyCard({
  item,
  index,
  total,
  policy,
  hold,
  reducedMotion,
  cardRef,
  stage,
}: {
  readonly item: YourCompanyPitchItemDto;
  readonly index: number;
  readonly total: number;
  readonly policy: FeedPreloadPolicy;
  readonly hold: boolean;
  readonly reducedMotion: boolean;
  readonly cardRef: (element: HTMLElement | null) => void;
  /** The feed's shared playback choices; the progress bar is the card in view's. */
  readonly stage: YourStage;
}) {
  const place = [
    stageLabel(item.currentStageCode),
    countryLabel(item.headquartersCountry),
  ]
    .filter((part): part is string => part !== null)
    .join(" · ");
  const pitch = item.pitch;
  const active = policy === "ACTIVE";
  const { setOpen } = useGlobalQ();
  const [shared, setShared] = useState<ShareOutcome | null>(null);
  const longPress = useLongPress(stage.openOptions, active && pitch !== null);
  const [paused, setPaused] = useState(false);
  return (
    <article
      ref={cardRef}
      className="cq-yours-card"
      aria-label={item.canonicalName}
      aria-posinset={index + 1}
      aria-setsize={total}
      data-your-company={item.companyId}
      data-index={index}
      data-clear-display={active && stage.clearDisplay ? "" : undefined}
      data-scrubbing={active && stage.scrubbing ? "" : undefined}
    >
      <div
        className="cq-yours-media"
        {...longPress.handlers}
        onClick={(event) => {
          if (longPress.consumed()) return;
          if (stage.clearDisplay) {
            stage.setClearDisplay(false);
            return;
          }
          const target = event.target;
          if (
            target instanceof Element &&
            target.closest("button, a, [role='slider']") !== null
          ) {
            return;
          }
          // Tap to pause, as on For you.
          const video = event.currentTarget.querySelector("video");
          if (video === null) return;
          if (video.paused) void video.play().catch(() => undefined);
          else video.pause();
          setPaused(!video.paused);
        }}
        onContextMenu={(event) => {
          if (pitch === null || !active) return;
          event.preventDefault();
          stage.openOptions();
        }}
      >
        {pitch === null ? (
          <div className="cq-feed-still" data-pitch-not-shared>
            {/* Without a pitch, the company's own cover stands in, under
                its card's cover scope (the server signed it or sent null). */}
            {typeof item.coverUrl === "string" ? (
              <EntityCover
                src={item.coverUrl}
                aspect="band"
                className="max-w-[48ch] rounded-md"
              />
            ) : null}
            {/* Unknown stays unknown: the API cannot say whether a pitch
                exists and is withheld, so the card never says it is. */}
            <p className="cq-body font-medium text-(--cq-stage-text)">
              No pitch to show yet
            </p>
            <p className="cq-body-sm max-w-[32ch] text-(--cq-stage-text-muted)">
              Their profile has everything {item.canonicalName} shares with you.
            </p>
          </div>
        ) : policy === "NONE" ? null : (
          <>
            <PitchPlayer
              company={asPlayable({ ...item, pitch })}
              policy={policy}
              authorize={actionPlaybackSource(item.companyId)}
              reducedMotion={reducedMotion}
              attachSource={attachHlsOrNativeSource}
              variant="stage"
              hold={hold || !active}
              rate={stage.rate}
              captionsOn={stage.captionsOn}
              offline={stage.offline}
              {...(active ? { onElement: stage.setActiveVideo } : {})}
            />
            {paused && active ? (
              <span aria-hidden="true" className="cq-feed-paused">
                <Play size={30} strokeWidth={ICON_STROKE} fill="currentColor" />
              </span>
            ) : null}
            {active ? (
              <PitchScrubber
                video={stage.activeVideo}
                durationSeconds={pitch.durationSeconds}
                companyName={item.canonicalName}
                onScrubbingChange={stage.setScrubbing}
              />
            ) : null}
          </>
        )}
      </div>
      <div className="cq-yours-info">
        <p className="cq-yours-chip" data-your-company-label={item.label}>
          {YOUR_COMPANY_LABEL_WORDS[item.label]}
        </p>
        <div className="cq-feed-company">
          <span className="cq-feed-panel-mark">
            <CompanyAvatar
              companyId={item.companyId}
              photoUrl={item.photoUrl}
              size={52}
            />
          </span>
          <span className="flex min-w-0 flex-col">
            <h2 className="cq-title-sm min-w-0 text-(--cq-text-primary)">
              <Link
                href={`/company/${item.companyId}`}
                className="underline-offset-4 hover:underline"
              >
                {item.canonicalName}
              </Link>
            </h2>
            {place === "" ? null : (
              <span className="cq-caption cq-feed-muted">{place}</span>
            )}
          </span>
        </div>
        {item.shortDescription === null ? null : (
          <p className="cq-body-sm line-clamp-2 text-(--cq-text-primary) lg:line-clamp-none">
            {item.shortDescription}
          </p>
        )}
        <div className="cq-yours-actions flex flex-wrap gap-2 pt-1 max-lg:hidden">
          <Link
            href={`/company/${item.companyId}`}
            className={buttonClassName("primary")}
            data-your-company-profile
          >
            Open profile
          </Link>
          {item.label === "SAVED" ? null : (
            <Link
              href={`/relationships/company/${item.companyId}`}
              className={buttonClassName("secondary")}
            >
              Relationship
            </Link>
          )}
        </div>

        {/* The rail, as on For you: the company first, then what the
            person can do with a company that is already theirs. */}
        <div className="cq-feed-rail" role="group" aria-label="Actions">
          <span className="cq-feed-rail-profile">
            <CompanyAvatarLink
              companyId={item.companyId}
              companyName={item.canonicalName}
              photoUrl={item.photoUrl}
            />
            <span className="cq-feed-rail-label" aria-hidden="true">
              Profile
            </span>
          </span>
          {item.label === "SAVED" ? null : (
            <Link
              href={`/relationships/company/${item.companyId}`}
              className={`${buttonClassName("quiet")} cq-feed-rail-button`}
              aria-label={`Relationship with ${item.canonicalName}`}
            >
              <Users
                aria-hidden="true"
                size={ICON_SIZE.prominent}
                strokeWidth={ICON_STROKE}
              />
              <span className="cq-feed-rail-label">Relationship</span>
            </Link>
          )}
          <Button
            variant="quiet"
            className="cq-feed-rail-button"
            onClick={() => setOpen(true)}
          >
            <QAperture state="IDLE" size={24} />
            <span className="cq-feed-rail-label">Ask Q</span>
          </Button>
          <Button
            variant="quiet"
            className="cq-feed-rail-button"
            onClick={() => {
              void shareCompany(item).then(setShared);
            }}
          >
            <Share2
              aria-hidden="true"
              size={ICON_SIZE.prominent}
              strokeWidth={ICON_STROKE}
            />
            <span className="cq-feed-rail-label">
              {shared === "COPIED" ? "Link copied" : "Share"}
            </span>
          </Button>
          {pitch === null || !active ? null : (
            <Button
              variant="quiet"
              className="cq-feed-rail-button"
              onClick={stage.openOptions}
              aria-haspopup="dialog"
            >
              <MoreHorizontal
                aria-hidden="true"
                size={ICON_SIZE.prominent}
                strokeWidth={ICON_STROKE}
              />
              <span className="cq-feed-rail-label">More</span>
            </Button>
          )}
        </div>
      </div>
    </article>
  );
}

/** What the cards share: one speed, one captions choice, one progress bar. */
type YourStage = {
  readonly rate: PlaybackRate;
  readonly captionsOn: boolean;
  readonly offline: boolean;
  readonly activeVideo: HTMLVideoElement | null;
  readonly setActiveVideo: (video: HTMLVideoElement | null) => void;
  readonly clearDisplay: boolean;
  readonly setClearDisplay: (clear: boolean) => void;
  readonly scrubbing: boolean;
  readonly setScrubbing: (scrubbing: boolean) => void;
  readonly openOptions: () => void;
};

export function YourCompaniesFeed({
  initial,
  focusCompanyId = null,
}: {
  /** The first page, when the server read it (the tab was linked). */
  readonly initial: YourCompaniesPageDto | null;
  /** "Show me Nixo's pitch": the company whose card to open on. */
  readonly focusCompanyId?: string | null;
}) {
  const [items, setItems] = useState<readonly YourCompanyPitchItemDto[]>(
    initial?.items ?? [],
  );
  const [nextCursor, setNextCursor] = useState<string | null>(
    initial?.nextCursor ?? null,
  );
  const [loaded, setLoaded] = useState(initial !== null);
  const [failed, setFailed] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const pagesRead = useRef(initial === null ? 0 : 1);
  const cards = useRef(new Map<number, HTMLElement>());
  const focused = useRef(false);
  const reducedMotion = useReducedMotionPreference();
  const onTab = useDiscoverTab() === "YOURS";
  const pageHidden = useSyncExternalStore(
    subscribeVisibility,
    () => document.visibilityState === "hidden",
    () => false,
  );
  const hold = !onTab || pageHidden;

  // Discover v2: one speed, captions choice and options sheet for the tab.
  const [rate, setRate] = usePlaybackRate();
  const [captionsOn, setCaptionsOn] = useState(true);
  const [activeVideo, setActiveVideo] = useState<HTMLVideoElement | null>(null);
  const [clearDisplay, setClearDisplay] = useState(false);
  const [scrubbing, setScrubbing] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const online = useOnline();
  const openOptions = useCallback(() => setOptionsOpen(true), []);
  const stage: YourStage = {
    rate,
    captionsOn,
    offline: !online,
    activeVideo,
    setActiveVideo,
    clearDisplay,
    setClearDisplay,
    scrubbing,
    setScrubbing,
    openOptions,
  };

  const inFlight = useRef(false);
  // A page's state is applied when the read answers, never as it starts:
  // the effects below only start a read (react-hooks/set-state-in-effect).
  const apply = useCallback(
    (result: Awaited<ReturnType<typeof loadYourCompaniesAction>>) => {
      setLoaded(true);
      if (!result.ok) {
        setFailed(result.message);
        return;
      }
      setFailed(null);
      pagesRead.current += 1;
      setItems((known) => {
        const seen = new Set(known.map((item) => item.companyId));
        return [
          ...known,
          ...result.value.items.filter((item) => !seen.has(item.companyId)),
        ];
      });
      setNextCursor(result.value.nextCursor);
    },
    [],
  );
  const loadMore = useCallback(
    (cursor: string | null) => {
      if (inFlight.current) return;
      inFlight.current = true;
      void loadYourCompaniesAction(cursor)
        .finally(() => {
          inFlight.current = false;
        })
        .then(apply);
    },
    [apply],
  );

  // First opened from the For you tab: the first page is read now, not
  // before, so the recommended feed keeps its whole preload budget.
  useEffect(() => {
    if (onTab && !loaded) loadMore(null);
  }, [onTab, loaded, loadMore]);

  // The card most in view is the active one: the only one that may play.
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting || entry.intersectionRatio < 0.6) continue;
          const target = entry.target;
          const index =
            target instanceof HTMLElement
              ? Number(target.dataset["index"] ?? "-1")
              : -1;
          if (index >= 0) setActive(index);
        }
      },
      { threshold: [0.6] },
    );
    for (const element of cards.current.values()) observer.observe(element);
    return () => observer.disconnect();
  }, [items.length]);

  // Near the end, the next page (cursor, never an offset).
  useEffect(() => {
    if (nextCursor !== null && active >= items.length - 2) {
      loadMore(nextCursor);
    }
  }, [active, items.length, nextCursor, loadMore]);

  // "Show me Nixo's pitch": opened on that company's card, reading a few
  // pages to find it; a company not among theirs leaves the feed as is.
  useEffect(() => {
    if (focused.current || focusCompanyId === null || items.length === 0) {
      return;
    }
    const wanted = focusCompanyId.toLowerCase();
    const index = items.findIndex(
      (item) => item.companyId.toLowerCase() === wanted,
    );
    if (index >= 0) {
      focused.current = true;
      // Made active once it is laid out and scrolled to, a frame later.
      const frame = requestAnimationFrame(() => {
        cards.current.get(index)?.scrollIntoView({ block: "start" });
        setActive(index);
      });
      return () => cancelAnimationFrame(frame);
    }
    if (nextCursor === null || pagesRead.current >= FOCUS_PAGES_MAX) {
      focused.current = true;
    } else {
      loadMore(nextCursor);
    }
  }, [focusCompanyId, items, nextCursor, loadMore]);

  if (!loaded) {
    return <FeedSkeleton label="Loading your companies" />;
  }
  if (items.length === 0) {
    return (
      <div className="cq-yours-feed cq-yours-empty" data-your-companies-empty>
        <EmptyState
          title={
            failed === null
              ? "No companies here yet."
              : "Your companies couldn't load."
          }
          description={
            failed ??
            "Companies you connect with, express interest in or save gather here, with their pitches when they share them with you."
          }
          action={
            failed === null ? null : (
              <Button variant="secondary" onClick={() => loadMore(null)}>
                Try again
              </Button>
            )
          }
        />
      </div>
    );
  }
  const current = items[active];
  return (
    <div
      className="cq-yours-feed"
      role="feed"
      aria-label="Your companies"
      // Focusable so the arrow keys scroll it; its links are the tab stops.
      tabIndex={-1}
      data-your-companies-feed
      onKeyDown={(event) => {
        const target = event.target;
        if (
          target instanceof HTMLElement &&
          (target.isContentEditable ||
            ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
        ) {
          return;
        }
        if (event.metaKey || event.ctrlKey || event.altKey) return;
        if (
          (event.key === "ArrowLeft" || event.key === "ArrowRight") &&
          activeVideo !== null
        ) {
          event.preventDefault();
          seekBy(
            activeVideo,
            event.key === "ArrowLeft" ? -SEEK_STEP_SECONDS : SEEK_STEP_SECONDS,
          );
        } else if (event.key === "<" || event.key === ">") {
          event.preventDefault();
          setRate(stepPlaybackRate(rate, event.key === "<" ? -1 : 1));
        } else if (event.key === "c") {
          event.preventDefault();
          setCaptionsOn((on) => !on);
        }
      }}
    >
      {onTab && current !== undefined ? (
        <QPageSubject
          subject={{
            kind: "COMPANY",
            companyId: current.companyId,
            label: current.canonicalName,
            scope: "network_visible",
          }}
        />
      ) : null}
      {items.map((item, index) => (
        <YourCompanyCard
          key={item.companyId}
          item={item}
          index={index}
          total={items.length}
          policy={yourCompaniesPolicy(index, active)}
          hold={hold}
          reducedMotion={reducedMotion}
          stage={stage}
          cardRef={(element) => {
            if (element === null) cards.current.delete(index);
            else cards.current.set(index, element);
          }}
        />
      ))}
      {current?.pitch == null ? null : (
        <PitchOptionsSheet
          open={optionsOpen}
          onOpenChange={setOptionsOpen}
          companyId={current.companyId}
          companyName={current.canonicalName}
          pitch={current.pitch}
          rate={rate}
          onRate={setRate}
          captionsOn={captionsOn}
          onCaptionsChange={setCaptionsOn}
          onClearDisplay={() => setClearDisplay(true)}
        />
      )}
      {failed === null ? null : (
        <div className="flex items-center gap-3 p-6">
          <p className="cq-body-sm text-(--cq-stage-text-muted)">{failed}</p>
          <Button variant="secondary" onClick={() => loadMore(nextCursor)}>
            Try again
          </Button>
        </div>
      )}
    </div>
  );
}
