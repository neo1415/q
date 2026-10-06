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
  DiscoveredCompanyDto,
  ExploreRelatedItemDto,
  ExploreTileDto,
  PlaybackAuthorizationDto,
} from "@capital-q/contracts";
import { buttonClassName } from "@capital-q/ui/button";
import {
  ArrowLeft,
  Bookmark,
  BookmarkCheck,
  ChevronDown,
  ChevronUp,
  ICON_SIZE,
  ICON_STROKE,
  X,
} from "@capital-q/ui/icons";

import { QNavIcon } from "@/components/app-shell/q-nav-icon";
import { useGlobalQ } from "@/components/app-shell/global-q";

import { policyForOffset } from "../discover/feed/feed-state";
import { useFeedBudget } from "../discover/feed/use-feed-budget";
import { attachHlsOrNativeSource } from "../discover/player/hls-source";
import { PitchPlayer } from "../discover/player/pitch-player";
import { prefersReducedMotion } from "../discover/player/use-pitch-playback";
import { exploreProfileHref } from "@capital-q/contracts";

import {
  REASON_WORDS,
  RELATED_WORDS,
  tileHook,
  tileMeta,
} from "./explore-words";
import { FitGlyph } from "./fit-glyph";

/**
 * The opened pitch (E3): full screen with that pitch first; scrolling on
 * shows "Related to X", pitches like it by sector, stage, geography or the
 * same founder. The existing pitch player plays one at a time under the
 * feed's one preload controller (current ACTIVE, next one buffers, the
 * next posters, the rest nothing). Back returns to the grid where it was.
 * On a desktop the video is centred with a side panel.
 *
 * Save is the person's explicit action; "Not for me" only hides the pitch
 * here, and never edits a mandate. Express interest lives on the profile.
 */

export type ExploreFeedItem = ExploreTileDto & {
  readonly related?: ExploreRelatedItemDto["related"] | undefined;
};

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
function subscribeReducedMotion(onChange: () => void): () => void {
  if (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function"
  ) {
    return () => {};
  }
  const media = window.matchMedia(REDUCED_MOTION_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

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
  posters,
  saved,
  onSave,
  onHide,
  onClose,
  startOnRequest = false,
}: {
  /** The opened pitch first, then the related ones. */
  readonly items: readonly ExploreFeedItem[];
  readonly loadingMore?: boolean;
  readonly sectorLabels: ReadonlyMap<string, string>;
  readonly authorize: (
    companyId: string,
    mediaAssetId: string,
  ) => Promise<PlaybackAuthorizationDto>;
  readonly posters: Readonly<Record<string, string>>;
  readonly saved: ReadonlySet<string>;
  readonly onSave: (item: ExploreFeedItem) => void;
  readonly onHide: (item: ExploreFeedItem) => void;
  readonly onClose: () => void;
  /** Poster first and nothing played until Play (fixtures, reduced data). */
  readonly startOnRequest?: boolean;
}) {
  const anchor = items[0];
  const [active, setActive] = useState(0);
  const [muted, setMuted] = useState(true);
  const budget = useFeedBudget();
  const reducedMotion = useSyncExternalStore(
    subscribeReducedMotion,
    prefersReducedMotion,
    () => false,
  );
  const { askAbout } = useGlobalQ();
  const scroller = useRef<HTMLDivElement | null>(null);
  const backButton = useRef<HTMLButtonElement | null>(null);

  // Which item is on screen: the one the scroll snapped to.
  useEffect(() => {
    const root = scroller.current;
    if (root === null || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.6) {
            const at = Number(
              (entry.target as HTMLElement).dataset["feedIndex"],
            );
            if (!Number.isNaN(at)) setActive(at);
          }
        }
      },
      { root, threshold: [0.6] },
    );
    for (const child of root.querySelectorAll("[data-feed-index]")) {
      observer.observe(child);
    }
    return () => observer.disconnect();
  }, [items.length]);

  useEffect(() => {
    backButton.current?.focus({ preventScroll: true });
  }, []);

  const go = useCallback(
    (to: number) => {
      const root = scroller.current;
      const next = Math.max(0, Math.min(items.length - 1, to));
      const target = root?.querySelector<HTMLElement>(
        `[data-feed-index="${String(next)}"]`,
      );
      target?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth" });
      setActive(next);
    },
    [items.length, reducedMotion],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      else if (event.key === "ArrowDown" || event.key === "j") {
        event.preventDefault();
        go(active + 1);
      } else if (event.key === "ArrowUp" || event.key === "k") {
        event.preventDefault();
        go(active - 1);
      } else if (event.key === "m") setMuted((m) => !m);
      else if (event.key === "s") {
        const current = items[active];
        if (current !== undefined) onSave(current);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, go, items, onClose, onSave]);

  if (anchor === undefined) return null;
  const current = items[active] ?? anchor;
  const relatedLabel = `Related to ${anchor.canonicalName}`;
  const upNext = items.slice(active + 1, active + 4);

  return (
    <div
      className="cq-explore-feed"
      role="dialog"
      aria-modal="true"
      aria-label={`Pitches related to ${anchor.canonicalName}`}
      data-explore-feed
    >
      <div ref={scroller} className="cq-explore-feed-scroller">
        {items.map((item, at) => {
          const offset = at - active;
          const policy = policyForOffset(offset, budget);
          const isSaved = saved.has(item.companyId);
          return (
            <section
              key={item.pitch.mediaAssetId}
              className="cq-explore-feed-item"
              data-feed-index={at}
              aria-label={`${item.canonicalName}${at === 0 ? "" : `, related to ${anchor.canonicalName}`}`}
              {...(at === active ? { "data-feed-active": "" } : {})}
            >
              <div className="cq-explore-stage">
                {policy === "NONE" ? (
                  posters[item.pitch.mediaAssetId] === undefined ? null : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={posters[item.pitch.mediaAssetId]}
                      alt=""
                      className="absolute inset-0 size-full object-cover"
                      loading="lazy"
                    />
                  )
                ) : (
                  <PitchPlayer
                    company={asCompany(item)}
                    policy={policy}
                    authorize={(mediaAssetId) =>
                      authorize(item.companyId, mediaAssetId)
                    }
                    reducedMotion={reducedMotion}
                    attachSource={attachHlsOrNativeSource}
                    variant="stage"
                    hold={at !== active}
                    muted={muted}
                    onMutedChange={setMuted}
                    startOnRequest={startOnRequest}
                  />
                )}
                <div className="cq-explore-stage-scrim" aria-hidden="true" />
                <div className="cq-explore-feed-top">
                  <button
                    ref={at === 0 ? backButton : undefined}
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
                <div className="cq-explore-info">
                  <p className="cq-title-sm">{item.canonicalName}</p>
                  <p className="cq-body-sm">{tileHook(item)}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {tileMeta(item, sectorLabels)
                      .split(" · ")
                      .filter((part) => part.length > 0)
                      .map((part) => (
                        <span key={part} className="cq-explore-chip">
                          {part}
                        </span>
                      ))}
                  </div>
                  <p className="cq-caption text-(--cq-stage-text-muted)">
                    {whyLine(item, anchor.canonicalName)}
                  </p>
                  <div>
                    <Link
                      href={exploreProfileHref("company", item.companyId)}
                      className={`${buttonClassName("secondary", "compact")} cq-explore-open-profile`}
                    >
                      Open profile
                    </Link>
                  </div>
                </div>
                <div className="cq-explore-rail">
                  <button
                    type="button"
                    aria-pressed={isSaved}
                    onClick={() => onSave(item)}
                  >
                    <span className="cq-explore-rail-icon">
                      {isSaved ? (
                        <BookmarkCheck
                          size={ICON_SIZE.prominent}
                          aria-hidden="true"
                        />
                      ) : (
                        <Bookmark
                          size={ICON_SIZE.prominent}
                          aria-hidden="true"
                        />
                      )}
                    </span>
                    {isSaved ? "Saved" : "Save"}
                  </button>
                  <button type="button" onClick={() => onHide(item)}>
                    <span className="cq-explore-rail-icon">
                      <X size={ICON_SIZE.prominent} aria-hidden="true" />
                    </span>
                    Not for me
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      askAbout(`Tell me about ${item.canonicalName}'s pitch.`)
                    }
                  >
                    <span className="cq-explore-rail-icon">
                      <QNavIcon size={24} aria-hidden="true" />
                    </span>
                    Ask Q
                  </button>
                </div>
              </div>
            </section>
          );
        })}
        {loadingMore ? (
          <p
            className="cq-body-sm p-6 text-center text-(--cq-stage-text-muted)"
            role="status"
          >
            Finding pitches like {anchor.canonicalName}…
          </p>
        ) : null}
        <div className="cq-explore-updown">
          <button
            type="button"
            aria-label="Previous pitch"
            disabled={active === 0}
            onClick={() => go(active - 1)}
          >
            <ChevronUp size={24} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="Next related pitch"
            disabled={active >= items.length - 1}
            onClick={() => go(active + 1)}
          >
            <ChevronDown size={24} aria-hidden="true" />
          </button>
        </div>
      </div>

      <aside className="cq-explore-panel" aria-label="About this pitch">
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            className="inline-grid size-11 place-items-center rounded-(--cq-radius-md) text-(--cq-text-secondary) hover:bg-(--cq-surface-subtle) hover:text-(--cq-text-primary)"
            onClick={onClose}
            aria-label="Back to Explore"
          >
            <ArrowLeft size={ICON_SIZE.prominent} aria-hidden="true" />
          </button>
          <span className="cq-body-sm text-(--cq-text-secondary)">
            {relatedLabel}
          </span>
        </div>
        <div className="flex flex-col gap-1.5">
          <h2 className="cq-title-lg">{current.canonicalName}</h2>
          <p className="cq-body">{tileHook(current)}</p>
          <p className="cq-caption text-(--cq-text-secondary)">
            {tileMeta(current, sectorLabels)}
          </p>
        </div>
        <div className="flex items-start gap-3 rounded-(--cq-radius-lg) bg-(--cq-surface-subtle) px-4 py-3.5">
          <span className="mt-0.5 text-(--cq-q-light)">
            <QNavIcon size={22} aria-hidden="true" />
          </span>
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="cq-caption text-(--cq-text-tertiary)">
              Why you&apos;re seeing this
            </p>
            <p className="cq-body-sm flex items-start gap-1.5">
              <FitGlyph
                kind={REASON_WORDS[current.reason].fit}
                className="mt-0.5 size-3.5"
              />
              <span>
                {whyLine(current, anchor.canonicalName)} Up next: pitches like{" "}
                {anchor.canonicalName}.
              </span>
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href={exploreProfileHref("company", current.companyId)}
            className={buttonClassName("primary")}
            data-explore-profile
          >
            Open profile
          </Link>
          <button
            type="button"
            className={buttonClassName("secondary")}
            aria-pressed={saved.has(current.companyId)}
            onClick={() => onSave(current)}
          >
            {saved.has(current.companyId) ? (
              <BookmarkCheck size={ICON_SIZE.compact} aria-hidden="true" />
            ) : (
              <Bookmark size={ICON_SIZE.compact} aria-hidden="true" />
            )}
            {saved.has(current.companyId) ? "Saved" : "Save"}
          </button>
          <button
            type="button"
            className={buttonClassName("secondary")}
            onClick={() => onHide(current)}
          >
            Not for me
          </button>
        </div>
        {upNext.length === 0 ? null : (
          <section className="flex flex-col gap-3" aria-label="Up next">
            <h3 className="cq-label text-(--cq-text-secondary)">Up next</h3>
            {upNext.map((item, offset) => (
              <button
                key={item.pitch.mediaAssetId}
                type="button"
                className="flex min-h-14 items-center gap-3 rounded-(--cq-radius-md) text-left hover:bg-(--cq-surface-subtle)"
                onClick={() => go(active + offset + 1)}
              >
                <span className="relative h-[71px] w-10 shrink-0 overflow-hidden rounded-lg bg-(--cq-stage-canvas)">
                  {posters[item.pitch.mediaAssetId] === undefined ? null : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={posters[item.pitch.mediaAssetId]}
                      alt=""
                      className="absolute inset-0 size-full object-cover"
                      loading="lazy"
                    />
                  )}
                </span>
                <span className="min-w-0">
                  <b className="block truncate font-medium">
                    {item.canonicalName}
                  </b>
                  <span className="cq-caption block truncate text-(--cq-text-secondary)">
                    {tileMeta(item, sectorLabels)}
                  </span>
                </span>
              </button>
            ))}
          </section>
        )}
        <p className="cq-caption text-(--cq-text-tertiary)">
          Keys: ↑ ↓ to move, M for sound, S to save. Express interest from the
          profile.
        </p>
      </aside>
    </div>
  );
}
