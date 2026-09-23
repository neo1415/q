"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";

import type { DiscoveryNoteDto } from "@capital-q/contracts";
import { Button } from "@capital-q/ui/button";
import { EmptyState } from "@capital-q/ui/states";

import { useGlobalQ } from "@/components/app-shell/global-q";
import { QPageSubject } from "@/features/q/q-subject";

import { FeedCard } from "./feed-card";
import { actionFeedTransport } from "./feed/action-feed-transport";
import { useInvestorFeed } from "./feed/use-investor-feed";
import { useReducedMotionPreference } from "./player/use-pitch-playback";

/**
 * Discover, for an investor (CQ-WEB-022).
 *
 * One controller owns the feed; this is its surface. Moving between cards
 * is local — no request, no Q call, no beacon — because viewing is not
 * interest. Only Save and Pass talk to the server, and only because a
 * person asked them to.
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

export function InvestorFeedScreen() {
  const transport = useMemo(() => actionFeedTransport(), []);
  const reducedMotion = useReducedMotionPreference();
  const feed = useInvestorFeed({ transport });
  const { setOpen } = useGlobalQ();

  const stageRef = useRef<HTMLDivElement>(null);
  const touchStartY = useRef<number | null>(null);

  const { next, previous } = feed;

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
      }
    },
    [next, previous],
  );

  const hasCard = feed.card !== null;
  useEffect(() => {
    if (hasCard) stageRef.current?.focus({ preventScroll: true });
  }, [hasCard]);

  const onTouchStart = useCallback((event: React.TouchEvent) => {
    touchStartY.current = event.touches[0]?.clientY ?? null;
  }, []);

  const onTouchEnd = useCallback(
    (event: React.TouchEvent) => {
      const start = touchStartY.current;
      touchStartY.current = null;
      if (start === null) return;
      const end = event.changedTouches[0]?.clientY;
      if (end === undefined) return;

      // A swipe, not a tap or a scroll nudge.
      const travelled = start - end;
      if (Math.abs(travelled) < 48) return;
      if (travelled > 0) next();
      else previous();
    },
    [next, previous],
  );

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
    ) : (
      <div className="flex flex-col gap-4">
        <Notes notes={notes} />
        <EmptyState
          title="Nothing to review yet."
          description="Companies appear here as founders choose to be discoverable. Q can tell you about any of them once they do."
        />
      </div>
    );
  }

  const decision = feed.decisionFor(card.companyId);

  return (
    <div className="flex flex-col gap-4">
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

      <Notes notes={notes} />

      <div
        ref={stageRef}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        onKeyDown={onKeyDown}
        // Programmatically focusable, not a tab stop: the controls inside
        // are the tab stops, and the region only needs focus so its keys
        // work from the moment the feed appears.
        tabIndex={-1}
        role="group"
        aria-label="Companies to review"
        className="mx-auto w-full max-w-(--cq-layout-reading) touch-pan-y outline-none"
      >
        <FeedCard
          key={card.companyId}
          company={card}
          policy={feed.prefetch.policyByCompanyId[card.companyId] ?? "ACTIVE"}
          reducedMotion={reducedMotion}
          saved={decision.saved}
          deciding={feed.isDeciding(card.companyId)}
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
      <nav
        className="mx-auto flex w-full max-w-(--cq-layout-reading) items-center gap-2"
        aria-label="Move through the feed"
      >
        <Button
          variant="quiet"
          onClick={previous}
          disabled={!feed.canRetreat}
          aria-label="Previous company"
        >
          Previous
        </Button>
        <Button
          variant="quiet"
          onClick={next}
          disabled={!feed.canAdvance}
          aria-label="Next company"
        >
          Next
        </Button>
        <p className="cq-caption text-(--cq-text-tertiary)" aria-live="polite">
          {feed.state.index + 1} of {feed.state.items.length}
          {feed.state.nextCursor === null ? "" : "+"}
        </p>
      </nav>
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
