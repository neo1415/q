"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";

import type {
  DiscoveredCompanyDto,
  DiscoveryCompanySlateDto,
} from "@capital-q/contracts";

import {
  browserFeedPositionStore,
  readFeedPosition,
  writeFeedPosition,
  type FeedPositionStore,
} from "./feed-position";
import {
  DEFAULT_LOAD_MORE_THRESHOLD,
  DEFAULT_PREFETCH_BUDGET,
  INITIAL_FEED_STATE,
  activeCard,
  canAdvance,
  canRetreat,
  decisionFor,
  feedReducer,
  isDecisionPending,
  prefetchWindow,
  shouldLoadMore,
  type FeedDecision,
  type FeedDecisionIntent,
  type FeedPrefetchBudget,
  type FeedPrefetchWindow,
  type FeedState,
} from "./feed-state";
import type { FeedTransport } from "./feed-transport";

/**
 * The investor feed controller (CQ-WEB-020).
 *
 * One owner for feed state: which cards are loaded, which one is active,
 * which are warm, what the reader has decided, and where to come back to.
 * The player (CQ-WEB-021) and the card (CQ-WEB-022) read this and hold no
 * feed state of their own -- doc 20 §54 is explicit that the preload
 * decision is one controller's job and not each component's.
 *
 * The swipe path is deliberately empty of I/O. `next` and `previous`
 * dispatch and return; no Q call, no analytics beacon, no interaction
 * record. Arriving at a card is not an event, because viewing is not
 * interest (doc 19 §68) -- only `save`, `unsave` and `pass` talk to the
 * server, and only because a person asked them to.
 *
 * Paging for the next slate page can follow a swipe. That is metadata, not
 * media and not telemetry: doc 20 §203 separates cheap next-page prefetch
 * from billable segment preload and forbids conflating them.
 */

/** Matches the contract's opaque-id shape: `^[A-Za-z0-9_:-]{8,64}$`. */
function defaultClientEventId(): string {
  const random = globalThis.crypto?.randomUUID?.();
  return (
    random ??
    `cq:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 12)}`
  );
}

export type UseInvestorFeedOptions = {
  readonly transport: FeedTransport;
  /** Defaults to doc 20 §50's window; pass the constrained one on a poor link. */
  readonly budget?: FeedPrefetchBudget;
  /** Defaults to `sessionStorage`; pass a double in tests, or null to disable. */
  readonly positionStore?: FeedPositionStore | null;
  readonly loadMoreThreshold?: number;
  readonly newClientEventId?: () => string;
  /**
   * The first page, when the server already fetched it for this render.
   *
   * The feed's first paint is its first poster (spec §9.5: the poster is
   * the LCP), and a poster cannot be in the server HTML if the slate only
   * arrives after hydration. The server hands the controller the page it
   * read under the same session; the controller still owns every page
   * after it, the position and the preload window.
   */
  readonly initialSlate?: DiscoveryCompanySlateDto | null;
};

export type InvestorFeed = {
  readonly state: FeedState;
  readonly card: DiscoveredCompanyDto | null;
  /** The one card that may own playback (doc 20 §36). */
  readonly activeCompanyId: string | null;
  readonly prefetch: FeedPrefetchWindow;
  readonly canAdvance: boolean;
  readonly canRetreat: boolean;
  readonly next: () => void;
  readonly previous: () => void;
  readonly moveTo: (companyId: string) => void;
  readonly save: (companyId: string) => void;
  readonly unsave: (companyId: string) => void;
  /** Records the pass. Advancing is the caller's, so a keyboard pass can differ. */
  readonly pass: (companyId: string) => void;
  readonly decisionFor: (companyId: string) => FeedDecision;
  readonly isDeciding: (companyId: string) => boolean;
};

export function useInvestorFeed(options: UseInvestorFeedOptions): InvestorFeed {
  const {
    transport,
    budget = DEFAULT_PREFETCH_BUDGET,
    loadMoreThreshold = DEFAULT_LOAD_MORE_THRESHOLD,
    newClientEventId = defaultClientEventId,
  } = options;

  const [state, dispatch] = useReducer(
    feedReducer,
    options.initialSlate ?? null,
    (slate): FeedState =>
      slate === null
        ? INITIAL_FEED_STATE
        : feedReducer(INITIAL_FEED_STATE, { type: "PAGE_LOADED", slate }),
  );
  // Read once: a seed is for the first render, not a prop to follow.
  const seededRef = useRef(state.status === "READY");

  // Resolved once: reading `sessionStorage` during render would differ
  // between the server pass and the client one.
  const storeRef = useRef<FeedPositionStore | null | undefined>(undefined);
  if (storeRef.current === undefined) {
    storeRef.current =
      options.positionStore === undefined
        ? browserFeedPositionStore()
        : options.positionStore;
  }

  // Latest values for the effects below, so loading does not re-subscribe
  // every time the index moves.
  const transportRef = useRef(transport);
  const loadingRef = useRef(false);
  const restoreAttemptedRef = useRef(false);
  /**
   * One abort scope for the component's life, not one per load.
   *
   * A controller created inside the paging effect would be torn down by
   * every unrelated state change -- a save, a swipe -- aborting the page
   * request it had just started while `status` stayed `LOADING_MORE`, and
   * the guard that prevents concurrent loads would then never let it
   * retry. Mount owns the scope; unmount ends it.
   */
  const abortRef = useRef<AbortController | null>(null);

  const loadPage = useCallback((cursor: string | null, signal: AbortSignal) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    dispatch({ type: "LOAD_STARTED" });

    const input = cursor === null ? { signal } : { cursor, signal };

    transportRef.current
      .loadSlate(input)
      .then((slate) => {
        if (signal.aborted) return;
        dispatch({ type: "PAGE_LOADED", slate });
      })
      .catch(() => {
        if (signal.aborted) return;
        dispatch({ type: "LOAD_FAILED" });
      })
      .finally(() => {
        loadingRef.current = false;
      });
  }, []);

  // Kept current in an effect rather than during render: a ref written
  // while rendering is a write React is free to discard. Declared before
  // the loading effects so it has already run when they first fire.
  useEffect(() => {
    transportRef.current = transport;
  }, [transport]);

  // First page, unless the server already supplied it. The abort scope is
  // opened either way: later pages need it.
  useEffect(() => {
    const controller = new AbortController();
    abortRef.current = controller;
    if (!seededRef.current) loadPage(null, controller.signal);
    return () => {
      controller.abort();
      abortRef.current = null;
      loadingRef.current = false;
    };
  }, [loadPage]);

  // Restore, once, as soon as there is a slate to match against. A stored
  // position from another slate is dropped inside `readFeedPosition`.
  useEffect(() => {
    if (restoreAttemptedRef.current) return;
    if (state.status !== "READY" || state.slateId === null) return;
    restoreAttemptedRef.current = true;

    const stored = readFeedPosition(storeRef.current ?? null, state.slateId);
    if (stored !== null) {
      dispatch({ type: "RESTORE_REQUESTED", companyId: stored.companyId });
    }
  }, [state.status, state.slateId]);

  // Continue the cursor: either the reader is near the end, or a restore is
  // still paging towards a card it has not reached yet.
  useEffect(() => {
    const chasingRestore =
      state.restoreTargetCompanyId !== null && state.nextCursor !== null;
    if (!chasingRestore && !shouldLoadMore(state, loadMoreThreshold)) return;
    if (loadingRef.current || state.nextCursor === null) return;

    const signal = abortRef.current?.signal;
    if (signal === undefined || signal.aborted) return;
    loadPage(state.nextCursor, signal);
  }, [state, loadMoreThreshold, loadPage]);

  const card = activeCard(state);
  const activeCompanyId = card?.companyId ?? null;

  // Remember where we are, but not while a restore is still in flight --
  // the cards passed through on the way to the target are not where the
  // reader was.
  useEffect(() => {
    if (!restoreAttemptedRef.current) return;
    if (state.restoreTargetCompanyId !== null) return;
    if (state.slateId === null || activeCompanyId === null) return;

    writeFeedPosition(storeRef.current ?? null, {
      slateId: state.slateId,
      companyId: activeCompanyId,
    });
  }, [state.slateId, state.restoreTargetCompanyId, activeCompanyId]);

  const decide = useCallback(
    (companyId: string, intent: FeedDecisionIntent) => {
      dispatch({ type: "DECISION_REQUESTED", companyId, intent });
      transportRef.current
        .decide({
          companyId,
          intent,
          slateId: state.slateId,
          clientEventId: newClientEventId(),
        })
        .then((recorded) => {
          dispatch({
            type: "DECISION_CONFIRMED",
            companyId,
            state: recorded.state,
          });
        })
        .catch(() => {
          // The optimistic flag goes back to what it was. Showing a card as
          // saved when the save did not land is the one outcome worse than
          // showing the delay.
          dispatch({ type: "DECISION_FAILED", companyId });
        });
    },
    [state.slateId, newClientEventId],
  );

  const next = useCallback(() => dispatch({ type: "ADVANCED" }), []);
  const previous = useCallback(() => dispatch({ type: "RETREATED" }), []);
  const moveTo = useCallback(
    (companyId: string) => dispatch({ type: "MOVED_TO", companyId }),
    [],
  );
  const save = useCallback(
    (companyId: string) => decide(companyId, "SAVE"),
    [decide],
  );
  const unsave = useCallback(
    (companyId: string) => decide(companyId, "UNSAVE"),
    [decide],
  );
  const pass = useCallback(
    (companyId: string) => decide(companyId, "PASS"),
    [decide],
  );

  const prefetch = useMemo(
    () => prefetchWindow(state, budget),
    [state, budget],
  );

  return {
    state,
    card,
    activeCompanyId,
    prefetch,
    canAdvance: canAdvance(state),
    canRetreat: canRetreat(state),
    next,
    previous,
    moveTo,
    save,
    unsave,
    pass,
    decisionFor: (companyId: string) => decisionFor(state, companyId),
    isDeciding: (companyId: string) => isDecisionPending(state, companyId),
  };
}
