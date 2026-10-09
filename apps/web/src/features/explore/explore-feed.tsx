"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  DiscoveredCompanyDto,
  ExploreRelatedItemDto,
  ExploreTileDto,
  PlaybackAuthorizationDto,
} from "@capital-q/contracts";
import { ArrowLeft, ICON_STROKE } from "@capital-q/ui/icons";

import { useGlobalQ } from "@/components/app-shell/global-q";
import { QAperture } from "@/features/q-aperture";
import { useQSessionOptional } from "@/features/q/q-session";

import { FeedCard } from "../discover/feed-card";
import {
  policyForOffset,
  type FeedPreloadPolicy,
} from "../discover/feed/feed-state";
import { useFeedBudget } from "../discover/feed/use-feed-budget";
import type { PlaybackSource } from "../discover/player/pitch-playback";
import { useFeedSound } from "../discover/player/sound-policy";
import { useReducedMotionPreference } from "../discover/player/use-pitch-playback";
import { KeyHints, PitchStage } from "../discover/stage/pitch-stage";
import { REASON_WORDS, RELATED_WORDS } from "./explore-words";

/**
 * The opened pitch (E3): Discover's own stage (founder 2026-10-08: "when
 * I click a video in Explore it should be exactly the Discover player --
 * reusable components"). The same player, gestures, keys, progress bar,
 * sound policy and preload window (current ACTIVE, the next two
 * buffering, the one behind kept), and the same card over the pitch; the
 * feed is the opened pitch first, then "Related to X": pitches like it by
 * sector, stage, geography or the same founder. Back returns to the grid
 * where it was.
 *
 * Save is the person's explicit action; "Not for me" (the card's Pass)
 * only hides the pitch here, and never edits a mandate. Express interest
 * lives on the profile, as on Discover.
 */

export type ExploreFeedItem = ExploreTileDto & {
  readonly related?: ExploreRelatedItemDto["related"] | undefined;
};

function asCompany(item: ExploreTileDto): DiscoveredCompanyDto {
  return {
    companyId: item.companyId,
    canonicalName: item.canonicalName,
    websiteUrl: null,
    headquartersCountry: item.headquartersCountry,
    currentStageCode: item.currentStageCode,
    shortDescription: item.shortDescription,
    reasons: [],
    reasonCodes: [],
    pitch: item.pitch,
  };
}

function whyLine(item: ExploreFeedItem, anchorName: string): string {
  if (item.related !== undefined && item.related.length > 0) {
    return `Like ${anchorName}: ${item.related
      .map((r) => RELATED_WORDS[r].toLowerCase())
      .join(", ")}.`;
  }
  return `${REASON_WORDS[item.reason].text}.`;
}

export function ExploreFeed({
  items,
  loadingMore = false,
  sectorLabels,
  authorize,
  saved,
  onSave,
  onHide,
  onClose,
  startOnRequest = false,
  posterOnly = false,
  initialIndex = 0,
}: {
  /** Where the feed starts (design review of "related next"). */
  readonly initialIndex?: number;
  /** The opened pitch first, then the related ones. */
  readonly items: readonly ExploreFeedItem[];
  readonly loadingMore?: boolean;
  readonly sectorLabels: ReadonlyMap<string, string>;
  readonly authorize: (
    companyId: string,
    mediaAssetId: string,
  ) => Promise<PlaybackAuthorizationDto>;
  /** Kept for the screen's signature; the stage warms its own posters. */
  readonly posters?: Readonly<Record<string, string>>;
  readonly saved: ReadonlySet<string>;
  readonly onSave: (item: ExploreFeedItem) => void;
  readonly onHide: (item: ExploreFeedItem) => void;
  readonly onClose: () => void;
  /** Poster first and nothing played (fixtures, reduced data). */
  readonly startOnRequest?: boolean;
  /** Design review with fixtures: posters only. */
  readonly posterOnly?: boolean;
}) {
  const anchor = items[0];
  const [active, setActive] = useState(() =>
    Math.max(0, Math.min(initialIndex, items.length - 1)),
  );
  const budget = useFeedBudget();
  const reducedMotion = useReducedMotionPreference();
  const { muted, setMuted } = useFeedSound(reducedMotion);
  const { askAbout } = useGlobalQ();
  const session = useQSessionOptional();

  const companies = useMemo(() => items.map(asCompany), [items]);
  const at = Math.min(active, Math.max(0, items.length - 1));
  const next = useCallback(
    () => setActive((current) => Math.min(items.length - 1, current + 1)),
    [items.length],
  );
  const previous = useCallback(
    () => setActive((current) => Math.max(0, current - 1)),
    [],
  );

  const policies = useMemo(() => {
    const byCompany = new Map<string, FeedPreloadPolicy>();
    items.forEach((item, position) => {
      const policy = policyForOffset(position - at, budget);
      byCompany.set(
        item.companyId,
        (posterOnly || startOnRequest) && policy !== "NONE" ? "POSTER" : policy,
      );
    });
    return byCompany;
  }, [items, at, budget, posterOnly, startOnRequest]);
  const policyFor = useCallback(
    (companyId: string) => policies.get(companyId) ?? "NONE",
    [policies],
  );
  // One source per company, so a player's authorize prop is stable.
  const sources = useRef(new Map<string, PlaybackSource>());
  const sourceFor = useCallback(
    (companyId: string): PlaybackSource => {
      const known = sources.current.get(companyId);
      if (known !== undefined) return known;
      const source: PlaybackSource = (mediaAssetId) =>
        authorize(companyId, mediaAssetId);
      sources.current.set(companyId, source);
      return source;
    },
    [authorize],
  );

  // Escape closes wherever focus is (the dialog's own key).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const current = items[at] ?? anchor;
  if (anchor === undefined || current === undefined) return null;
  const relatedLabel = `Related to ${anchor.canonicalName}`;
  const isSaved = saved.has(current.companyId);

  return (
    <div
      className="cq-explore-feed"
      role="dialog"
      aria-modal="true"
      aria-label={`Pitches related to ${anchor.canonicalName}`}
      data-explore-feed
    >
      <PitchStage
        items={companies}
        index={at}
        next={next}
        previous={previous}
        canAdvance={at < items.length - 1}
        canRetreat={at > 0}
        policyFor={policyFor}
        sourceFor={sourceFor}
        reducedMotion={reducedMotion}
        hold={false}
        // Loud from the start; only Q's own speech quiets it, as on Discover.
        muted={muted || session?.voice.client.state === "Q_SPEAKING"}
        onMutedChange={setMuted}
        label={`Pitches related to ${anchor.canonicalName}`}
        nextLabel="Next related pitch"
        previousLabel="Previous pitch"
        onDecide={(verdict) => {
          if (verdict === "SAVE") {
            if (!isSaved) onSave(current);
          } else {
            onHide(current);
          }
          next();
        }}
        onNotInterested={() => {
          onHide(current);
          next();
        }}
        onExtraKey={(key) => {
          if (key !== "s") return false;
          onSave(current);
          return true;
        }}
        top={
          <div className="cq-explore-feed-top" data-explore-top>
            <button
              type="button"
              className="cq-explore-stage-button"
              onClick={onClose}
              aria-label="Back to Explore"
              data-explore-back
            >
              <ArrowLeft
                size={22}
                strokeWidth={ICON_STROKE}
                aria-hidden="true"
              />
            </button>
            <span className="cq-body truncate font-semibold">
              {relatedLabel}
            </span>
          </div>
        }
        overlay={({ openOptions }) => (
          <>
            <FeedCard
              key={current.companyId}
              company={asCompany(current)}
              policy={policyFor(current.companyId)}
              reducedMotion={reducedMotion}
              saved={isSaved}
              deciding={false}
              showMedia={false}
              askQMark={
                <QAperture
                  state={session?.presence.state ?? "IDLE"}
                  size={24}
                />
              }
              onSave={() => onSave(current)}
              onPass={() => {
                onHide(current);
                next();
              }}
              onAskQ={() =>
                askAbout(`Tell me about ${current.canonicalName}'s pitch.`)
              }
              onMore={openOptions}
              sectorLabels={sectorLabels}
              feedNotes={
                <div className="flex flex-col gap-1">
                  <p className="cq-status-line" data-explore-why>
                    {whyLine(current, anchor.canonicalName)}
                  </p>
                  {loadingMore ? (
                    <p className="cq-status-line" role="status">
                      Finding pitches like {anchor.canonicalName}…
                    </p>
                  ) : null}
                </div>
              }
            />
            <KeyHints />
          </>
        )}
      />
    </div>
  );
}
