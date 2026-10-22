"use client";

import { useEffect, useMemo } from "react";

import type { ConnectPorts } from "@/features/network/request-to-connect";
import {
  InterestCards,
  type InterestAnswerPort,
} from "@/features/network/interest-cards";
import { VisibilityScreen } from "@/features/company/visibility-screen";
import {
  InvestorDirectory,
  type DirectoryEntry,
} from "@/features/investors/investor-directory";
import {
  Shortlist,
  type ShortlistPorts,
  type ShortlistTab,
} from "@/features/discover/shortlist";
import type { TopState } from "@/features/discover/shortlist-data";
import { openSearch, rememberOpened } from "@/features/search/recent-opened";
import { SearchHome } from "@/features/search/search-home";
import { SearchPalette } from "@/features/search/search-palette";

import {
  BRIGHTFOLD,
  INTEREST_FACTS,
  PALETTE_STATES,
  PASSED_ROWS,
  RECENT,
  REVIEW_VIEWER,
  SAVED_ROWS,
  SHEET_INVESTOR,
  TOP3,
  VISIBILITY,
  comparisonOf,
  connectionStatus,
  interestItems,
  sentRequest,
  type PaletteState,
  type SheetState,
  type VisibilityState,
} from "./fixtures";

/**
 * The client half of the discovery design review: the real components,
 * with every port they would call answered from ./fixtures, and the one
 * or two presses a state needs (open a sheet, pick a company, press
 * Accept) made on mount, the way a person would. Nothing reaches a
 * service; a press that would has a fixture answer or never answers.
 */

/** Presses each selector once it is on the page, in order. */
function usePresses(selectors: readonly string[]) {
  const key = selectors.join("|");
  useEffect(() => {
    if (key.length === 0) return;
    let cancelled = false;
    const queue = key.split("|");
    let tries = 0;
    const step = () => {
      if (cancelled) return;
      const next = queue[0];
      if (next === undefined) return;
      const target = document.querySelector<HTMLElement>(next);
      if (target !== null) {
        queue.shift();
        target.click();
        tries = 0;
      } else if (++tries > 120) {
        return;
      }
      window.setTimeout(step, 60);
    };
    const timer = window.setTimeout(step, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [key]);
}

const NEVER = <T,>() => new Promise<T>(() => undefined);

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export function ReviewSearch({
  state,
}: {
  readonly state: "home" | "home-recent" | PaletteState;
}) {
  const palette = state === "home" || state === "home-recent" ? null : state;
  // "Recently opened" lives in this browser, per viewer: the seeded state
  // has a viewer of its own, so every other state starts with none.
  const viewer =
    state === "home-recent" ? `${REVIEW_VIEWER}-recent` : REVIEW_VIEWER;
  const search = useMemo(
    () => (query: string) =>
      Promise.resolve(
        palette === null
          ? ({ kind: "EMPTY" } as const)
          : query.trim().length === 0
            ? ({ kind: "EMPTY" } as const)
            : PALETTE_STATES[palette].answer,
      ),
    [palette],
  );
  useEffect(() => {
    if (state !== "home-recent") return;
    // This browser's own "recently opened", oldest first so the newest
    // ends on top, under a fictional viewer.
    for (const item of [...RECENT].reverse()) {
      rememberOpened(viewer, item);
    }
  }, [state, viewer]);
  useEffect(() => {
    if (palette === null) return;
    const timer = window.setTimeout(
      () => openSearch(PALETTE_STATES[palette].query),
      80,
    );
    return () => window.clearTimeout(timer);
  }, [palette]);
  return (
    <>
      <SearchHome viewer={viewer} />
      <SearchPalette viewer={viewer} search={search} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Investors directory
// ---------------------------------------------------------------------------

export type DirectoryState =
  "list" | "filtered" | "filtered-empty" | "empty" | `sheet-${SheetState}`;

export function ReviewDirectory({
  state,
  entries,
}: {
  readonly state: DirectoryState;
  readonly entries: readonly DirectoryEntry[];
}) {
  const sheet = state.startsWith("sheet-")
    ? (state.slice("sheet-".length) as SheetState)
    : null;
  const ports = useMemo((): ConnectPorts => {
    const state = sheet ?? "request";
    return {
      status: (investorOrganisationId) =>
        state === "loading"
          ? NEVER()
          : Promise.resolve(
              state === "failed"
                ? {
                    ok: false as const,
                    message:
                      "Whether you can send a request couldn't be checked just now.",
                    retryable: true,
                  }
                : {
                    ok: true as const,
                    value: connectionStatus(state, investorOrganisationId),
                  },
            ),
      send: (input) =>
        Promise.resolve({
          ok: true as const,
          value: sentRequest(input.investorOrganisationId),
        }),
    };
  }, [sheet]);
  usePresses(
    sheet !== null
      ? [
          `[data-investor-open="${SHEET_INVESTOR[sheet]}"]`,
          ...(sheet === "sent" ? ["[data-connection-request]"] : []),
        ]
      : state === "filtered"
        ? ['[data-investor-type="Venture fund"]', "[data-taking-requests]"]
        : state === "filtered-empty"
          ? ['[data-investor-type="Angel"]']
          : [],
  );
  return (
    <InvestorDirectory
      entries={state === "empty" ? [] : entries}
      connectPorts={ports}
    />
  );
}

// ---------------------------------------------------------------------------
// Saved / Passed / Compare
// ---------------------------------------------------------------------------

export type ShortlistState =
  | "saved"
  | "saved-empty"
  | "saved-error"
  | "pick-1"
  | "pick-2"
  | "pick-3"
  | "passed"
  | "passed-empty"
  | "compare-picked"
  | "compare-top"
  | "top-no-mandate"
  | "top-error";

const SHORTLIST_PORTS: ShortlistPorts = {
  decide: () =>
    Promise.resolve({
      ok: false as const,
      message: "Design review: nothing is recorded.",
    }),
  undoPass: () =>
    Promise.resolve({
      ok: false as const,
      message: "Design review: nothing is recorded.",
    }),
  compare: (ids) => Promise.resolve(comparisonOf(ids)),
};

export function ReviewShortlist({ state }: { readonly state: ShortlistState }) {
  const tab: ShortlistTab = state.startsWith("passed")
    ? "PASSED"
    : state.startsWith("compare")
      ? "COMPARE"
      : "SAVED";
  const top: TopState =
    state === "top-no-mandate"
      ? { kind: "NO_MANDATE" }
      : state === "top-error"
        ? { kind: "ERROR" }
        : { kind: "READY", comparison: TOP3 };
  const picks =
    state === "pick-1"
      ? 1
      : state === "pick-2"
        ? 2
        : state === "pick-3"
          ? 3
          : 0;
  usePresses(
    SAVED_ROWS.slice(0, picks).map((row) => `[data-pick="${row.companyId}"]`),
  );
  const picked =
    state === "compare-picked"
      ? comparisonOf(SAVED_ROWS.slice(0, 3).map((row) => row.companyId))
      : null;
  return (
    <Shortlist
      initialTab={tab}
      saved={
        state === "saved-error"
          ? null
          : state === "saved-empty"
            ? []
            : SAVED_ROWS
      }
      passed={state === "passed-empty" ? [] : PASSED_ROWS}
      top={top}
      picked={picked}
      ports={SHORTLIST_PORTS}
    />
  );
}

// ---------------------------------------------------------------------------
// Investor interest
// ---------------------------------------------------------------------------

export type InterestState =
  | "waiting"
  | "answered"
  | "accept-pending"
  | "connected"
  | "declined"
  | "empty";

export function ReviewInterest({
  state,
  now,
}: {
  readonly state: InterestState;
  readonly now: number;
}) {
  const items = useMemo(() => interestItems(now), [now]);
  const first = items[0];
  const answer: InterestAnswerPort =
    state === "accept-pending"
      ? () => NEVER()
      : (input) => {
          const item = items.find(
            (entry) => entry.interestId === input.interestId,
          );
          if (item === undefined) {
            return Promise.resolve({
              ok: false as const,
              message: "This interest isn't available to answer any more.",
              retryable: false,
            });
          }
          return Promise.resolve({
            ok: true as const,
            value: {
              interest: {
                ...item,
                response: input.decision,
                respondedAt: new Date(now).toISOString(),
              },
              deduplicated: false,
            },
          });
        };
  usePresses(
    first === undefined
      ? []
      : state === "answered"
        ? ['[data-interest-tab="ANSWERED"]']
        : state === "accept-pending" || state === "connected"
          ? [`[data-interest-id="${first.interestId}"] [data-accept]`]
          : state === "declined"
            ? [`[data-interest-id="${first.interestId}"] [data-decline]`]
            : [],
  );
  return (
    <InterestCards
      items={state === "empty" ? [] : items}
      facts={INTEREST_FACTS}
      answer={answer}
    />
  );
}

// ---------------------------------------------------------------------------
// Visibility
// ---------------------------------------------------------------------------

export function ReviewVisibility({
  state,
}: {
  readonly state: VisibilityState | "going-private";
}) {
  usePresses(state === "going-private" ? ["[data-make-private]"] : []);
  return (
    <VisibilityScreen
      companyId={BRIGHTFOLD.id}
      review={VISIBILITY[state === "going-private" ? "discoverable" : state]}
    />
  );
}
