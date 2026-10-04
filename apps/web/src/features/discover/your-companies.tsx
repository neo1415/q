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
import { EmptyState } from "@capital-q/ui/states";

import { CompanyAvatarLink } from "@/features/company/company-avatar";
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
}: {
  readonly item: YourCompanyPitchItemDto;
  readonly index: number;
  readonly total: number;
  readonly policy: FeedPreloadPolicy;
  readonly hold: boolean;
  readonly reducedMotion: boolean;
  readonly cardRef: (element: HTMLElement | null) => void;
}) {
  const place = [
    stageLabel(item.currentStageCode),
    countryLabel(item.headquartersCountry),
  ]
    .filter((part): part is string => part !== null)
    .join(" · ");
  const pitch = item.pitch;
  return (
    <article
      ref={cardRef}
      className="cq-yours-card"
      aria-label={item.canonicalName}
      aria-posinset={index + 1}
      aria-setsize={total}
      data-your-company={item.companyId}
      data-index={index}
    >
      <div className="cq-yours-media">
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
            <p className="cq-body font-medium text-(--cq-stage-text)">
              Pitch not shared
            </p>
            <p className="cq-body-sm max-w-[32ch] text-(--cq-stage-text-muted)">
              {item.canonicalName} hasn&apos;t made a pitch available to you.
              Their profile has everything they share with you.
            </p>
          </div>
        ) : policy === "NONE" ? null : (
          <PitchPlayer
            company={asPlayable({ ...item, pitch })}
            policy={policy}
            authorize={actionPlaybackSource(item.companyId)}
            reducedMotion={reducedMotion}
            attachSource={attachHlsOrNativeSource}
            variant="stage"
            hold={hold || policy !== "ACTIVE"}
          />
        )}
      </div>
      <div className="cq-yours-info">
        <p
          className="cq-caption text-(--cq-stage-text-muted)"
          data-your-company-label={item.label}
        >
          {YOUR_COMPANY_LABEL_WORDS[item.label]}
        </p>
        <div className="flex min-w-0 items-center gap-2">
          <CompanyAvatarLink
            companyId={item.companyId}
            companyName={item.canonicalName}
            photoUrl={item.photoUrl}
          />
          <h2 className="cq-title-sm min-w-0 text-(--cq-stage-text)">
            <Link
              href={`/company/${item.companyId}`}
              className="underline-offset-4 hover:underline"
            >
              {item.canonicalName}
            </Link>
          </h2>
        </div>
        {item.shortDescription === null ? null : (
          <p className="cq-body-sm line-clamp-2 text-(--cq-stage-text)">
            {item.shortDescription}
          </p>
        )}
        {place === "" ? null : (
          <p className="cq-caption text-(--cq-stage-text-muted)">{place}</p>
        )}
        <div className="flex flex-wrap gap-2 pt-1">
          <Link
            href={`/company/${item.companyId}`}
            className={buttonClassName("secondary")}
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
      </div>
    </article>
  );
}

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
    return (
      <div className="cq-yours-feed" aria-busy="true">
        <p className="cq-body-sm p-6 text-(--cq-stage-text-muted)">
          Loading your companies…
        </p>
      </div>
    );
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
          cardRef={(element) => {
            if (element === null) cards.current.delete(index);
            else cards.current.set(index, element);
          }}
        />
      ))}
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
