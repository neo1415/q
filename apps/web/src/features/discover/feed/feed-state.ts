import type {
  DiscoveredCompanyDto,
  DiscoveryCompanySlateDto,
  DiscoveryNoteDto,
} from "@capital-q/contracts";

/**
 * The investor feed, as state (CQ-WEB-020; doc 19 §66-§69, doc 20 §35,
 * §43-§54, §144-§148; doc 17 §66-§68, §128).
 *
 * This module is the whole feed as a value and a function over it: no
 * React, no fetch, no storage, no clock. The player (CQ-WEB-021) and the
 * card (CQ-WEB-022) render what these selectors say and own none of it.
 *
 * Three invariants are structural here rather than remembered:
 *
 * 1. The order is the server's. `items` is appended to and never sorted,
 *    filtered or scored. Doc 19 puts ranking in a deterministic,
 *    reproducible, versioned server component; a client that re-ordered a
 *    slate would make `rankingVersion` a lie.
 * 2. Moving is free. Advancing and retreating are index arithmetic with
 *    no I/O of any kind -- no interaction record, no Q call, no analytics
 *    beacon. Viewing is not interest (doc 19 §68), so arriving at a card
 *    records nothing at all; only a person's explicit command does.
 * 3. Absence stays absence. A company nobody has decided on is not a
 *    passed company; `decisionFor` answers with an explicit "neither"
 *    rather than letting a missing key read as a negative.
 */

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

/** What the reader has done with a card. Both false is a real answer. */
export type FeedDecision = {
  readonly saved: boolean;
  readonly passed: boolean;
};

const UNDECIDED: FeedDecision = { saved: false, passed: false };

/**
 * The commands this controller owns.
 *
 * Express Interest is deliberately absent. It creates relationship state
 * and is server-confirmed (CQ-NET-010); an optimistic local flag for it
 * would show a person a relationship that does not exist yet.
 */
export type FeedDecisionIntent = "SAVE" | "UNSAVE" | "PASS";

/** An optimistic decision still in flight, with what to put back if it fails. */
export type FeedPendingDecision = {
  readonly intent: FeedDecisionIntent;
  readonly previous: FeedDecision;
};

/**
 * Apply an intent locally.
 *
 * Each intent moves only its own flag. Save does not clear a pass and pass
 * does not clear a save, because neither transition was declared by the
 * server and guessing one would put a state on screen that the next
 * reconciliation silently contradicts. The server's `state` is the
 * authority and replaces both flags when it arrives.
 */
function applyIntent(
  current: FeedDecision,
  intent: FeedDecisionIntent,
): FeedDecision {
  switch (intent) {
    case "SAVE":
      return { saved: true, passed: current.passed };
    case "UNSAVE":
      return { saved: false, passed: current.passed };
    case "PASS":
      return { saved: current.saved, passed: true };
  }
}

// ---------------------------------------------------------------------------
// Preload policy (doc 20 §44-§50)
// ---------------------------------------------------------------------------

/**
 * Doc 20 §44's levels, unchanged.
 *
 * `METADATA` is part of the vocabulary and the V1 default policy below
 * never emits it: the levels either side of it are the useful ones for a
 * 60-second pitch. It is kept so a Data Saver or provider-specific policy
 * can express it without redefining the type.
 */
export type FeedPreloadPolicy =
  "NONE" | "POSTER" | "METADATA" | "STARTUP_BUFFER" | "ACTIVE";

/**
 * How far warmth may reach, in cards.
 *
 * Preloading is billed (doc 20 §43): Cloudflare charges client-buffered
 * segments as delivered minutes, so this is a cost budget wearing the
 * shape of a window, not a performance dial to turn up.
 */
export type FeedPrefetchBudget = {
  /** Cards ahead of the active one that may load a poster. */
  readonly warmAhead: number;
  /** Cards behind it that stay lightweight but resident (doc 20 §35). */
  readonly warmBehind: number;
  /** Of those ahead, how many may buffer a startup segment. */
  readonly startupBufferAhead: number;
};

/** Doc 20 §50: current ACTIVE, next 1 startup buffer, next 2 poster, rest none. */
export const DEFAULT_PREFETCH_BUDGET: FeedPrefetchBudget = {
  warmAhead: 2,
  warmBehind: 1,
  startupBufferAhead: 1,
};

/** Doc 20 §50, constrained network: current ACTIVE, next 1 poster, rest none. */
export const CONSTRAINED_PREFETCH_BUDGET: FeedPrefetchBudget = {
  warmAhead: 1,
  warmBehind: 0,
  startupBufferAhead: 0,
};

/** The policy for a card at `offset` from the active one. */
export function policyForOffset(
  offset: number,
  budget: FeedPrefetchBudget,
): FeedPreloadPolicy {
  if (offset === 0) return "ACTIVE";
  if (offset > 0) {
    if (offset <= budget.startupBufferAhead) return "STARTUP_BUFFER";
    if (offset <= budget.warmAhead) return "POSTER";
    return "NONE";
  }
  return -offset <= budget.warmBehind ? "POSTER" : "NONE";
}

/**
 * Which cards are active, warm and cold right now.
 *
 * One controller answers this for the whole feed. Doc 20 §54 and §260.6
 * both forbid the alternative -- `preload="auto"` decided card by card --
 * because a policy scattered across components has no budget and nobody
 * can say what the feed is currently downloading.
 */
export type FeedPrefetchWindow = {
  readonly active: string | null;
  readonly warm: readonly string[];
  readonly cold: readonly string[];
  readonly policyByCompanyId: Readonly<Record<string, FeedPreloadPolicy>>;
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export type FeedStatus =
  "IDLE" | "LOADING_FIRST" | "READY" | "LOADING_MORE" | "FAILED";

export type FeedState = {
  readonly status: FeedStatus;
  /** The persisted slate these items came from; null while none is servable. */
  readonly slateId: string | null;
  readonly rankingVersion: string | null;
  /** Server order, appended to and never re-ordered. */
  readonly items: readonly DiscoveredCompanyDto[];
  readonly notes: readonly DiscoveryNoteDto[];
  /** Declared exclusions V1 cannot check for any company (ADR 0020); latest page wins. */
  readonly unverifiableExclusions: readonly string[];
  /** With NONE_PASS_HARD_RULES: the rules that removed every discoverable company. */
  readonly excludingRules: readonly string[];
  /** How many companies are discoverable, when an empty page counted them. */
  readonly discoverableCount: number | null;
  readonly nextCursor: string | null;
  readonly index: number;
  readonly decisions: Readonly<Record<string, FeedDecision>>;
  readonly pending: Readonly<Record<string, FeedPendingDecision>>;
  /**
   * A card id we are paging towards after a restore, cleared once found or
   * once the cursor runs out. See `feed-position.ts` for why a restore
   * names a card rather than an index.
   */
  readonly restoreTargetCompanyId: string | null;
};

export const INITIAL_FEED_STATE: FeedState = {
  status: "IDLE",
  slateId: null,
  rankingVersion: null,
  items: [],
  notes: [],
  unverifiableExclusions: [],
  excludingRules: [],
  discoverableCount: null,
  nextCursor: null,
  index: 0,
  decisions: {},
  pending: {},
  restoreTargetCompanyId: null,
};

export type FeedAction =
  | { readonly type: "LOAD_STARTED" }
  | { readonly type: "PAGE_LOADED"; readonly slate: DiscoveryCompanySlateDto }
  | { readonly type: "LOAD_FAILED" }
  | { readonly type: "ADVANCED" }
  | { readonly type: "RETREATED" }
  | { readonly type: "MOVED_TO"; readonly companyId: string }
  | { readonly type: "RESTORE_REQUESTED"; readonly companyId: string }
  | {
      readonly type: "DECISION_REQUESTED";
      readonly companyId: string;
      readonly intent: FeedDecisionIntent;
    }
  | {
      readonly type: "DECISION_CONFIRMED";
      readonly companyId: string;
      /** The server's own answer; null when it declined to state one. */
      readonly state: FeedDecision | null;
    }
  | { readonly type: "DECISION_FAILED"; readonly companyId: string };

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

function mergeNotes(
  existing: readonly DiscoveryNoteDto[],
  incoming: readonly DiscoveryNoteDto[],
): readonly DiscoveryNoteDto[] {
  const merged = [...existing];
  for (const note of incoming) if (!merged.includes(note)) merged.push(note);
  return merged;
}

/** Append a page, dropping ids already held. A retried cursor must not duplicate. */
function appendUnique(
  existing: readonly DiscoveredCompanyDto[],
  incoming: readonly DiscoveredCompanyDto[],
): readonly DiscoveredCompanyDto[] {
  const held = new Set(existing.map((item) => item.companyId));
  const fresh = incoming.filter((item) => !held.has(item.companyId));
  return fresh.length === 0 ? existing : [...existing, ...fresh];
}

/** Move to the restore target if this load brought it into view. */
function settleRestore(state: FeedState): FeedState {
  const target = state.restoreTargetCompanyId;
  if (target === null) return state;

  const found = state.items.findIndex((item) => item.companyId === target);
  if (found >= 0) {
    return { ...state, index: found, restoreTargetCompanyId: null };
  }
  // The cursor is spent and the card never appeared -- it was passed,
  // withdrawn, or belongs to a slate that no longer exists. Stop looking
  // and stay where we are rather than paging forever.
  return state.nextCursor === null
    ? { ...state, restoreTargetCompanyId: null }
    : state;
}

export function feedReducer(state: FeedState, action: FeedAction): FeedState {
  switch (action.type) {
    case "LOAD_STARTED":
      return {
        ...state,
        status: state.items.length === 0 ? "LOADING_FIRST" : "LOADING_MORE",
      };

    case "PAGE_LOADED": {
      const { slate } = action;

      /**
       * A different slate id on a later page is not a page of this feed.
       * The server rebuilt the slate under us (the `SLATE_RESTARTED` note)
       * and its ranks are a different ordering; appending them would
       * splice two rankings into one list and make the reader's position
       * meaningless. Start again, and keep the decisions -- those are
       * about companies, not about an ordering.
       */
      const restarted =
        state.slateId !== null &&
        slate.slateId !== null &&
        slate.slateId !== state.slateId;

      const items = restarted
        ? slate.items
        : appendUnique(state.items, slate.items);

      const loaded: FeedState = {
        ...state,
        status: "READY",
        slateId: slate.slateId,
        rankingVersion: slate.rankingVersion,
        items,
        notes: restarted ? slate.notes : mergeNotes(state.notes, slate.notes),
        unverifiableExclusions: slate.unverifiableExclusions ?? [],
        excludingRules: slate.excludingRules ?? [],
        discoverableCount: slate.discoverableCount ?? null,
        nextCursor: slate.nextCursor,
        index: restarted
          ? 0
          : Math.min(state.index, Math.max(items.length - 1, 0)),
      };

      return settleRestore(loaded);
    }

    case "LOAD_FAILED":
      // Keep what is already on screen. A failed second page is not a
      // reason to empty a feed the reader is part-way through.
      return { ...state, status: "FAILED" };

    case "ADVANCED":
      return state.index >= state.items.length - 1
        ? state
        : { ...state, index: state.index + 1 };

    case "RETREATED":
      return state.index <= 0 ? state : { ...state, index: state.index - 1 };

    case "MOVED_TO": {
      const found = state.items.findIndex(
        (item) => item.companyId === action.companyId,
      );
      return found < 0 ? state : { ...state, index: found };
    }

    case "RESTORE_REQUESTED":
      return settleRestore({
        ...state,
        restoreTargetCompanyId: action.companyId,
      });

    case "DECISION_REQUESTED": {
      const previous = state.decisions[action.companyId] ?? UNDECIDED;
      return {
        ...state,
        decisions: {
          ...state.decisions,
          [action.companyId]: applyIntent(previous, action.intent),
        },
        pending: {
          ...state.pending,
          // The pre-optimistic value, so a failure reverts to what was
          // true rather than to "undecided".
          [action.companyId]: { intent: action.intent, previous },
        },
      };
    }

    case "DECISION_CONFIRMED": {
      const { [action.companyId]: _settled, ...pending } = state.pending;
      const decisions =
        action.state === null
          ? state.decisions
          : { ...state.decisions, [action.companyId]: action.state };
      return { ...state, decisions, pending };
    }

    case "DECISION_FAILED": {
      const inFlight = state.pending[action.companyId];
      if (inFlight === undefined) return state;
      const { [action.companyId]: _reverted, ...pending } = state.pending;
      return {
        ...state,
        decisions: {
          ...state.decisions,
          [action.companyId]: inFlight.previous,
        },
        pending,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

export function activeCard(state: FeedState): DiscoveredCompanyDto | null {
  return state.items[state.index] ?? null;
}

export function decisionFor(state: FeedState, companyId: string): FeedDecision {
  return state.decisions[companyId] ?? UNDECIDED;
}

export function isDecisionPending(
  state: FeedState,
  companyId: string,
): boolean {
  return state.pending[companyId] !== undefined;
}

export function canAdvance(state: FeedState): boolean {
  return state.index < state.items.length - 1;
}

export function canRetreat(state: FeedState): boolean {
  return state.index > 0;
}

/** More to fetch, and not already fetching it. */
export function canLoadMore(state: FeedState): boolean {
  return state.nextCursor !== null && state.status !== "LOADING_MORE";
}

/**
 * How close to the end the reader may get before the next page is fetched.
 *
 * Doc 20 §203 keeps this separate from media warm-up: a page of slate
 * metadata is cheap and a video segment is billable, so the metadata
 * window may reach further than the preload window does.
 */
export const DEFAULT_LOAD_MORE_THRESHOLD = 3;

export function shouldLoadMore(
  state: FeedState,
  threshold: number = DEFAULT_LOAD_MORE_THRESHOLD,
): boolean {
  if (!canLoadMore(state)) return false;
  return state.items.length - 1 - state.index <= threshold;
}

export function prefetchWindow(
  state: FeedState,
  budget: FeedPrefetchBudget = DEFAULT_PREFETCH_BUDGET,
): FeedPrefetchWindow {
  const policyByCompanyId: Record<string, FeedPreloadPolicy> = {};
  const warm: string[] = [];
  const cold: string[] = [];
  let active: string | null = null;

  state.items.forEach((item, position) => {
    const policy = policyForOffset(position - state.index, budget);
    policyByCompanyId[item.companyId] = policy;
    if (policy === "ACTIVE") active = item.companyId;
    else if (policy === "NONE") cold.push(item.companyId);
    else warm.push(item.companyId);
  });

  // An empty feed has no active card; `items[index]` would be undefined
  // and the loop above simply never runs.
  return { active, warm, cold, policyByCompanyId };
}
