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
} from "@capital-q/contracts";
import { Button, buttonClassName } from "@capital-q/ui/button";
import { EmptyState } from "@capital-q/ui/states";

import { useGlobalQ, useQMomentSource } from "@/components/app-shell/global-q";
import { QNavIcon } from "@/components/app-shell/q-nav-icon";
import { Q_FEED_EVENT } from "@/features/q/client-actions";
import { useQSessionOptional } from "@/features/q/q-session";
import { QPageState } from "@/features/q/q-section";
import { qPitchHoldsVoice } from "@/features/q-pitch/tour-presence";
import { QPageSubject } from "@/features/q/q-subject";

import { DossierQ } from "./dossier-q";
import { FeedCard } from "./feed-card";
import {
  EndOfSlate,
  FeedMomentToast,
  NO_TALLY,
  type FeedMoment,
  type FeedTally,
} from "./feed-moments";
import { useDiscoverTab } from "./discover-tab";
import { StartDiscoverNow } from "./start-discover-now";
import { ruleList } from "./mandate-rules";
import {
  actionFeedTransport,
  authorisePlaybackViaAction,
} from "./feed/action-feed-transport";
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
import { FeedSkeleton } from "./stage/feed-skeleton";
import { KeyHints, PitchStage } from "./stage/pitch-stage";
import { useFeedSound } from "./player/sound-policy";
import {
  SPLASH_DONE_EVENT,
  splashShowing,
} from "@/features/splash/splash-policy";
import { useT } from "@/features/i18n/language";

function subscribeSplash(onChange: () => void): () => void {
  window.addEventListener(SPLASH_DONE_EVENT, onChange);
  return () => window.removeEventListener(SPLASH_DONE_EVENT, onChange);
}
import { useReducedMotionPreference } from "./player/use-pitch-playback";
import { useQControl } from "@/features/q/control/q-control";
import { effectShown } from "@/features/q/control/perform";

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
    "You have no active mandate yet, so nothing here is matched to you. Finish your mandate and Q will match on what you told it.",
  MANDATE_HAS_NO_PREFERENCES:
    "Your mandate does not name a stage, sector or geography yet. Adding them is what turns this into a shortlist.",
  NO_DISCOVERABLE_COUNTERPARTS:
    "Nobody has made themselves discoverable yet. This fills as founders choose to be found.",
  RANKED_ON_DECLARED_PROFILE_ONLY:
    "Ordered by what each company says about itself. Nothing private is used to build this.",
  RECOMMENDATIONS_REFRESHING:
    "Your recommendations are being prepared. Check back in a moment.",
  SLATE_RESTARTED:
    "Your recommendations were refreshed while you were browsing, so this starts again from the top.",
  NONE_PASS_HARD_RULES:
    "Companies are discoverable, but your hard rules exclude every one of them.",
  NONE_MATCH_MANDATE:
    "Companies are discoverable, but none matches your mandate yet.",
  NONE_WITH_PLAYABLE_PITCH:
    "Companies pass your hard rules, but none has a pitch video yet. Search and Explore still show them.",
  NONE_MATCH_FILTERS: "No companies match these filters.",
  NONE_IN_DECLARED_GEOGRAPHY: "No companies with a pitch in your regions yet.",
};

/**
 * Final check 2026-10-30: every card in a Benelux-and-Nordics feed was
 * outside those regions, twelve Dutch companies were held out for want of
 * a pitch, and nothing said so. The sentences, in order: none here is in
 * your regions; how many there have no pitch; what is shown instead.
 */
export function outsideGeographySentences(
  withoutPitch: number | null,
): readonly string[] {
  const held =
    withoutPitch === null || withoutPitch === 0
      ? []
      : [
          withoutPitch === 1
            ? "1 company in your regions is on Capital Q without a pitch."
            : `${String(withoutPitch)} companies in your regions are on Capital Q without a pitch.`,
        ];
  return [
    NOTE_TEXT.NONE_IN_DECLARED_GEOGRAPHY,
    ...held,
    "Showing others outside your regions.",
  ];
}

/** "12 companies are", "1 company is": the count is the market, not a score. */
function discoverableCompanies(count: number | null): string {
  if (count === null) return "Companies are";
  return count === 1 ? "1 company is" : `${String(count)} companies are`;
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
/** The pitch-mode flag changes only with a page load or the tour's start. */
function noSubscription(): () => void {
  return () => undefined;
}

export function InvestorFeedScreen({
  initial = null,
  sectors = [],
}: {
  readonly initial?: InvestorFeedInitial | null;
  /** The industry vocabulary, for the sector filter. */
  readonly sectors?: readonly SectorOption[];
} = {}) {
  const discoverFilters = useDiscoverFilters(sectors);
  const sectorLabels = useMemo(
    () => new Map(sectors.map((sector) => [sector.nodeId, sector.label])),
    [sectors],
  );
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
  };
  return (
    <>
      <InvestorFeed
        key={filtersKey(filters)}
        initial={unfiltered ? initial : null}
        filters={unfiltered ? null : filters}
        controls={controls}
        sectorLabels={sectorLabels}
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
};

function InvestorFeed({
  initial,
  filters,
  controls,
  sectorLabels,
}: {
  readonly initial: InvestorFeedInitial | null;
  readonly filters: DiscoverFilters | null;
  readonly controls: FeedFilterControls;
  readonly sectorLabels: ReadonlyMap<string, string>;
}) {
  const t = useT();
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
  const { setOpen } = useGlobalQ();
  const session = useQSessionOptional();
  // Sound on, like TikTok, every session (ADR 0026, ADR 0064): one
  // policy shared with Explore's viewer (player/sound-policy.ts).
  const { muted, setMuted } = useFeedSound(reducedMotion);
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

  const stageRef = useRef<HTMLDivElement | null>(null);
  const setStage = useCallback((node: HTMLDivElement | null) => {
    stageRef.current = node;
  }, []);
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
  // The splash covers the first pitch; it starts the moment the splash goes.
  const splashUp = useSyncExternalStore(
    subscribeSplash,
    splashShowing,
    () => false,
  );
  // The "Your companies" tab is showing: this feed waits where it is
  // (follow-55; one active player per page).
  const offTab = useDiscoverTab() !== "FOR_YOU";
  const index = feed.state.index;
  // Discover A's moments: the toast after a pass or a confirmed interest,
  // this visit's tally, and the end of the slate.
  const [moment, setMoment] = useState<FeedMoment | null>(null);
  const momentCount = useRef(0);
  const [tally, setTally] = useState<FeedTally>(NO_TALLY);
  const [ended, setEnded] = useState(false);
  // A swipe right: the card opens Express interest's confirmation.
  const [interestAsked, setInterestAsked] = useState(0);
  const hold = tabHidden || splashUp || offTab;
  // Founder, 2026-10-09: pitches are always loud from the start, also with
  // Q open or the voice line on; only Q's own speech quiets them. (Muting
  // for the whole open line, added after the microphone heard a pitch on
  // 2026-09-30, kept them silent all session once voice was always on; a
  // headset keeps the pitch out of the microphone.)
  // Q Pitch v6 (owner 16 Oct): "Discover in pitch mode is muted" -- the
  // tour never plays a pitch's sound. Read after hydration only.
  const pitchMode = useSyncExternalStore(
    noSubscription,
    qPitchHoldsVoice,
    () => false,
  );
  const effectiveMuted = muted || qSpeaking || pitchMode;

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

  // Q Pitch (premiere v5): "save this one" as a deterministic, receipted
  // act. Save is optimistic and non-consequential; DONE only once the
  // company in focus shows as saved.
  const latestFeed = useRef(feed);
  useEffect(() => {
    latestFeed.current = feed;
  });
  useQControl({
    id: "button.feed-save",
    kind: "BUTTON",
    ref: stageRef,
    onAct: async (intent) => {
      if (intent.act !== "ACTIVATE") return "NOT_APPLICABLE";
      const current = latestFeed.current.card;
      if (current === null) return "FAILED";
      const id = current.companyId;
      if (!latestFeed.current.decisionFor(id).saved) {
        latestFeed.current.save(id);
      }
      return (await effectShown(
        () => latestFeed.current.decisionFor(id).saved,
        3_000,
      ))
        ? "DONE"
        : "FAILED";
    },
  });

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
        {t(
          unverifiableExclusions.length === 1
            ? `Your ${ruleList(unverifiableExclusions)} exclusion can't be checked automatically yet, so nobody is hidden because of it.`
            : `Your ${ruleList(unverifiableExclusions)} exclusions can't be checked automatically yet, so nobody is hidden because of them.`,
        )}
      </p>
    );

  if (feed.state.status === "LOADING_FIRST") {
    return <FeedSkeleton label={t("Loading your recommendations")} />;
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
    const unicornSelection =
      filters?.unicornPotentialMin !== undefined ||
      filters?.unicornPotentialSort === true;
    return (
      <div className="flex flex-col gap-4">
        {controls.row("flex")}
        {controls.notice === null ? null : (
          <p className="cq-status-line">{controls.notice}</p>
        )}
        <EmptyState
          title={t(
            unicornSelection
              ? "No scored companies match these filters."
              : "No companies match these filters.",
          )}
          description={t(
            unicornSelection
              ? "Unicorn Potential needs sufficient current evidence before an overall score is available. This view excludes companies without a score; missing evidence is not a judgment of business quality."
              : "Your recommendations are unchanged; these filters leave none of them in view.",
          )}
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button variant="primary" onClick={controls.clear}>
                {t("Clear filters")}
              </Button>
              {unicornSelection ? (
                <Link href="/explore" className={buttonClassName("secondary")}>
                  {t("Open Explore")}
                </Link>
              ) : null}
            </div>
          }
        />
      </div>
    );
  }

  if (feed.state.status === "FAILED" && feed.premiumAccessRequired) {
    return (
      <div className="flex flex-col gap-4">
        {controls.row("flex")}
        <EmptyState
          title={t("Premium investor access required")}
          description={t(
            "Unicorn Potential filters require premium investor access. Clear filters to return to your recommendations.",
          )}
          action={
            <Button variant="primary" onClick={controls.clear}>
              {t("Clear filters")}
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
        title={t("Discover couldn't load.")}
        description={t(
          "Nothing is wrong with your mandate. Try again in a moment.",
        )}
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
          title={t("See companies with what you've told Q so far.")}
          description={t(
            "Your mandate isn't finished yet. Q can already rank companies against what you've told it, and you can finish the rest any time.",
          )}
          action={
            <div className="flex flex-wrap items-start gap-2">
              <StartDiscoverNow />
              <Link
                href="/onboarding/investor"
                className={buttonClassName("secondary")}
              >
                {t("Finish my mandate")}
              </Link>
              <Button variant="secondary" onClick={() => setOpen(true)}>
                {t("Ask Q")}
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
                {t("Review my hard rules")}
              </Link>
              <Button variant="secondary" onClick={() => setOpen(true)}>
                {t("Ask Q")}
              </Button>
            </div>
          }
        />
      </div>
    ) : notes.includes("NONE_WITH_PLAYABLE_PITCH") ? (
      <div className="flex flex-col gap-4">
        {unverifiableLine}
        <EmptyState
          title={`${discoverableCompanies(discoverableCount)} discoverable. None has a pitch video yet.`}
          description={t(
            "This feed shows only companies with a pitch you can play. The others pass your hard rules and are in Search and Explore; they join the feed when they add a pitch.",
          )}
          action={
            <div className="flex flex-wrap items-center gap-2">
              <Link href="/explore" className={buttonClassName("secondary")}>
                {t("Open Explore")}
              </Link>
              <Link href="/search" className={buttonClassName("secondary")}>
                {t("Search companies")}
              </Link>
              <Button variant="secondary" onClick={() => setOpen(true)}>
                {t("Ask Q")}
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
          description={t(
            "They pass your hard rules, but none shares a stage, country or sector you named. Widening your mandate is what brings them in.",
          )}
          action={
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href="/onboarding/investor?review=1"
                className={buttonClassName("secondary")}
              >
                {t("Review my mandate")}
              </Link>
              <Button variant="secondary" onClick={() => setOpen(true)}>
                {t("Ask Q")}
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
          title={t("Building your list.")}
          description={t(
            "Q is matching discoverable companies to your mandate. Check back in a moment.",
          )}
        />
      </div>
    ) : (
      <div className="flex flex-col gap-4">
        <Notes notes={notes} />
        <EmptyState
          title={t("Nothing to review yet.")}
          description={t(
            "Companies appear here as founders choose to be discoverable. Companies you saved or passed on are kept in Saved and Passed, with their pitches.",
          )}
          action={
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" onClick={() => setOpen(true)}>
                {t("Ask Q")}
              </Button>
              <SavedAndPassedLinks className="flex" />
            </div>
          }
        />
      </div>
    );
  }

  const decision = feed.decisionFor(card.companyId);
  const policyByCompanyId = feed.prefetch.policyByCompanyId;
  // Nothing after this card, and no page still to come.
  const lastCard = !feed.canAdvance && feed.state.nextCursor === null;
  const moveOn = () => {
    if (lastCard) setEnded(true);
    else next();
  };
  const noteMoment = (kind: FeedMoment["kind"]) => {
    momentCount.current += 1;
    setMoment({
      kind,
      id: momentCount.current,
      companyId: card.companyId,
      companyName: card.canonicalName,
    });
  };
  const save = () => {
    if (decision.saved) return;
    feed.save(card.companyId);
    setTally((was) => ({ ...was, saved: was.saved + 1 }));
    noteMoment("SAVED");
  };
  const undoSave = (companyId: string) => {
    feed.unsave(companyId);
    setTally((was) => ({ ...was, saved: Math.max(0, was.saved - 1) }));
  };
  /** Every pass from the feed: recorded, said with Undo, and moved on. */
  const passCard = () => {
    feed.pass(card.companyId);
    setTally((was) => ({ ...was, passed: was.passed + 1 }));
    noteMoment("PASSED");
    moveOn();
  };
  const undoPass = (companyId: string) => {
    feed.unpass(companyId);
    setTally((was) => ({ ...was, passed: Math.max(0, was.passed - 1) }));
    setEnded(false);
    feed.moveTo(companyId);
  };

  const onDecide = (verdict: "INTEREST" | "PASS") => {
    // Right asks for interest: its confirmation opens (it tells the
    // founder, so it is never sent by a gesture); left passes, with Undo.
    if (verdict === "INTEREST") setInterestAsked((n) => n + 1);
    else passCard();
  };
  const positionLabel = `${String(index + 1)} ${t("of")} ${String(
    shownItems.length,
  )}${feed.state.nextCursor === null ? "" : "+"}`;

  return (
    <PitchStage
      items={shownItems}
      index={index}
      next={next}
      previous={previous}
      canAdvance={feed.canAdvance}
      canRetreat={feed.canRetreat}
      policyFor={(companyId) => policyByCompanyId[companyId] ?? "NONE"}
      sourceFor={authorizations.sourceFor}
      reducedMotion={reducedMotion}
      hold={hold}
      muted={effectiveMuted}
      onMutedChange={setMuted}
      initialAuthorization={initialAuthorization}
      label={t("Companies to review")}
      onStage={setStage}
      onDecide={onDecide}
      onNotInterested={passCard}
      positionLabel={positionLabel}
      ending={
        ended ? (
          <>
            <EndOfSlate tally={tally} onBack={() => setEnded(false)} />
            <FeedMomentToast
              moment={moment}
              onUndoPass={undoPass}
              onUndoSave={undoSave}
              onPassReason={feed.passReason}
              onDone={() => setMoment(null)}
            />
          </>
        ) : null
      }
      before={
        /*
          Q looks at the card the person is looking at. Declaring it grants
          nothing — the Q API resolves and authorises the subject again.
        */
        offTab ? null : (
          <>
            <QPageSubject
              subject={{
                kind: "COMPANY",
                companyId: card.companyId,
                label: card.canonicalName,
                scope: "network_visible",
              }}
            />
            {/*
              The card in focus, on the page manifest too: Q's Next and
              Previous on this feed (carousel.feed) are DONE only once it
              moves (premiere v5 run, 16 Oct: never set, so always FAILED).
            */}
            <QPageState focus={{ kind: "COMPANY", id: card.companyId }} />
          </>
        )
      }
      top={
        /* One compact control over the pitch; the row is the desktop's. */
        <div className="flex flex-col gap-1 lg:hidden">
          <div className="cq-feed-filter flex gap-2">{controls.button}</div>
          {/* Investor lane 2026-10-30 (390 px): the honest line about
              their regions lived only in the desktop dossier and the card's
              details sheet, so a phone showed just "outside your regions"
              on the card. It is over the pitch here, at phone widths. */}
          {notes.includes("NONE_IN_DECLARED_GEOGRAPHY") ? (
            <p
              className="cq-feed-regions-line"
              role="note"
              data-feed-outside-geography-top
            >
              {t(NOTE_TEXT.NONE_IN_DECLARED_GEOGRAPHY)}
            </p>
          ) : null}
        </div>
      }
      overlay={({ openOptions }) => (
        <>
          {/* The panel's tools on one line: filters, then Saved and Passed. */}
          <div className="cq-feed-panel-tools hidden lg:flex">
            {controls.row("flex min-w-0")}
            <SavedAndPassedLinks className="flex shrink-0" />
          </div>
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
            askQMark={<QNavIcon size={20} aria-hidden="true" />}
            onSave={() =>
              decision.saved ? feed.unsave(card.companyId) : save()
            }
            // Passing moves on, with Undo and an optional reason in the
            // toast. The record and the movement stay separate in the
            // feed so a keyboard pass can choose not to.
            onPass={passCard}
            onAskQ={() => setOpen(true)}
            askPanel={<DossierQ companyName={card.canonicalName} />}
            interestRequest={interestAsked}
            onInterestConfirmed={() => {
              setTally((was) => ({ ...was, interest: was.interest + 1 }));
              noteMoment("INTEREST");
            }}
            onMore={openOptions}
            sectorLabels={sectorLabels}
            feedNotes={
              notes.length === 0 &&
              unverifiableLine === null &&
              controls.notice === null &&
              feed.decisionNotice === null ? null : (
                <div className="flex flex-col gap-1">
                  <Notes
                    notes={notes}
                    geographyWithoutPitch={
                      feed.state.declaredGeographyWithoutPitch
                    }
                  />
                  {unverifiableLine}
                  {controls.notice === null ? null : (
                    <p className="cq-status-line">{controls.notice}</p>
                  )}
                  {feed.decisionNotice === null ? null : (
                    <p
                      className="cq-status-line"
                      role="status"
                      data-feed-decision-notice
                    >
                      {feed.decisionNotice}
                    </p>
                  )}
                </div>
              )
            }
          />
          <KeyHints />
          <FeedMomentToast
            moment={moment}
            onUndoPass={undoPass}
            onUndoSave={undoSave}
            onPassReason={feed.passReason}
            onDone={() => setMoment(null)}
          />
        </>
      )}
    />
  );
}

function Notes({
  notes,
  geographyWithoutPitch = null,
}: {
  readonly notes: readonly DiscoveryNoteDto[];
  readonly geographyWithoutPitch?: number | null | undefined;
}) {
  const t = useT();
  if (notes.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      {notes.map((note) => (
        // A status line, not an error: none of these is a fault, and a
        // warning tone would tell the reader something untrue.
        <p
          key={note}
          className="cq-status-line"
          {...(note === "NONE_IN_DECLARED_GEOGRAPHY"
            ? { "data-feed-outside-geography": true }
            : {})}
        >
          {note === "NONE_IN_DECLARED_GEOGRAPHY"
            ? outsideGeographySentences(geographyWithoutPitch)
                .map((sentence) => t(sentence))
                .join(" ")
            : t(NOTE_TEXT[note])}
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
  const t = useT();
  return (
    <nav
      aria-label={t("Saved and passed companies")}
      className={`${className} flex-wrap items-center gap-2`}
    >
      <Link href="/discover/saved" className={buttonClassName("quiet")}>
        {t("Saved")}
      </Link>
      <Link href="/discover/passed" className={buttonClassName("quiet")}>
        {t("Passed")}
      </Link>
    </nav>
  );
}
