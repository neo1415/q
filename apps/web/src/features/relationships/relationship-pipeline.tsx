"use client";

import Link from "next/link";

import { CompanyScoresLive } from "@/features/scores";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";

import {
  isPipelineUnicornSort,
  RELATIONSHIP_STATES_V2,
  RelationshipPipelineViewQuerySchema,
  RelationshipViewQuerySchema,
  type FitProfileDto,
  type RelationshipPipelineDto,
  type RelationshipPipelineViewQuery,
  type RelationshipStateV2,
  type RelationshipSummaryDto,
  type SavedRelationshipViewList,
} from "@capital-q/contracts";
import { cx } from "@capital-q/ui";
import { ChevronDown, Flag, ICON_SIZE, Search } from "@capital-q/ui/icons";
import { useQControl, useQControlGroup } from "@/features/q/control/q-control";

import { PipelineLayoutSwitch } from "./pipeline-layout-switch";
import { effectShown } from "@/features/q/control/perform";
import { currentRoute } from "@/features/q/control/route-state";
import { QPageState, useQDialog } from "@/features/q/q-section";
import { formatDay } from "@/components/date-format";
import {
  BOARD_STATES,
  BOARD_STOPPED,
  PIPELINE_NEXT_WORDS,
  pipelinePresentedRows,
} from "./pipeline-presentation";
import { STATE_WORDS } from "./relationship-words";
import { StageStrip } from "./stage-strip";
import {
  DEFAULT_PIPELINE_PREFERENCES,
  pipelineHref,
  pipelineListLayoutHref,
  readPipelinePreferences,
  writePipelinePreferences,
  type PipelineColumn,
  type PipelinePreferences,
} from "./pipeline-preferences";
import { PipelineSavedViews, type AppliedView } from "./pipeline-saved-views";
import { ScoreFigure, UnicornFigure } from "./pipeline-score-figure";
import {
  PipelineExport,
  PipelineSearch,
  StateChips,
  SuitabilityFigure,
} from "./pipeline-toolbar";
import { crmButton, StateTag, UnknownValue } from "./crm-kit";
import { peekClick, RelationshipPeek } from "./relationship-peek";
import { CounterpartAvatar } from "./relationships-board";
import { isOwnStep, since, type NextStep } from "./relationships-view";
import {
  hasUnicornScores,
  scoreOf,
  UNKNOWN_SCORES,
  type PipelineScores,
} from "./pipeline-scores";
import { useT } from "@/features/i18n/language";

/** A select reads as a quiet pill in the view bar, not a form field. */
const selectClass =
  "min-h-11 max-w-full appearance-none rounded-full border border-(--cq-border) bg-(--cq-surface-raised) ps-3.5 pe-8 text-[13px] font-medium text-(--cq-text-primary) focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring) lg:min-h-10";
const caret =
  "pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-(--cq-text-tertiary)";

/**
 * What the Table and Board know about the whole pipeline beside their own
 * page (design 2026-10-20): counts by state for the chips, each
 * relationship's one next step (Needs you), when anything last happened,
 * and the one line about each counterpart.
 */
export type PipelineOverview = {
  readonly total: number;
  readonly counts: Readonly<Partial<Record<RelationshipStateV2, number>>>;
  readonly steps: Readonly<Record<string, NextStep>>;
  readonly activity: Readonly<Record<string, string>>;
  readonly about: Readonly<Record<string, string>>;
};
const href = (row: RelationshipSummaryDto) =>
  `/relationships/${row.counterpart.kind === "COMPANY" ? "company" : "investor"}/${encodeURIComponent(row.counterpart.id)}`;
function localStorageOrNull() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * The URL's sort for a chosen option: Suitability is the investor's default
 * (no `sort`); a Unicorn Potential view is ranked by the server over the
 * whole pipeline; every other order is the API's own.
 */
function sortParam(value: string): RelationshipPipelineViewQuery["sort"] {
  return value === "oldest" ||
    value === "name" ||
    value === "name-desc" ||
    value === "recent" ||
    isPipelineUnicornSort(value)
    ? value
    : undefined;
}

/** The Unicorn Potential narrowing a person can choose (premium only). */
const UNICORN_FILTERS = [
  { value: "unicorn", label: "Unicorn Potential: all companies" },
  { value: "unicorn-scored", label: "Unicorn Potential: with a score" },
  { value: "unicorn-40", label: "Unicorn Potential: 40 and above" },
  { value: "unicorn-60", label: "Unicorn Potential: 60 and above" },
  { value: "unicorn-80", label: "Unicorn Potential: 80 and above" },
  {
    value: "unicorn-insufficient",
    label: "Unicorn Potential: insufficient evidence",
  },
] as const;

/** Presentation and personal preferences only. The API owns scope/filter/state. */
export function RelationshipPipeline({
  data,
  query,
  scopeKey,
  layout: initialLayout,
  side,
  views = null,
  scores,
  ranked = false,
  overview,
  fits,
  now = 0,
}: {
  /** The whole pipeline's counts and steps; null when it couldn't be read. */
  readonly overview?: PipelineOverview | null | undefined;
  /** Fit with the investor's own mandate by company id, for the peek. */
  readonly fits?: Readonly<Record<string, FitProfileDto | null>> | undefined;
  /** When the page was read, so server and browser say the same "2h". */
  readonly now?: number | undefined;
  /**
   * Suitability and Investability by company id, from the Q API (ADR
   * 0074); investor only. Absent: no score columns.
   */
  readonly scores?: Readonly<Record<string, PipelineScores>> | undefined;
  /** No sort chosen: the server ranked this page by Suitability. */
  readonly ranked?: boolean | undefined;
  /** The server's saved views; null when they could not be read. */
  readonly views?: SavedRelationshipViewList | null;
  readonly data: RelationshipPipelineDto;
  readonly query: RelationshipPipelineViewQuery;
  readonly scopeKey: string;
  readonly layout: "table" | "board";
  readonly side: "INVESTOR" | "COMPANY";
}) {
  const t = useT();

  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);
  const stateRef = useRef<HTMLDivElement>(null);
  const [needsOnly, setNeedsOnly] = useState(false);
  const sortRef = useRef<HTMLSelectElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState(query.q ?? "");
  const [preferences, setPreferences] = useState<PipelinePreferences>(
    DEFAULT_PIPELINE_PREFERENCES,
  );
  const [layout, setLayout] = useState(initialLayout);
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [preview, setPreview] = useState<RelationshipSummaryDto | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    const stored = readPipelinePreferences(scopeKey, localStorageOrNull());
    // Synchronize external device preferences after SSR; never canonical data.

    setPreferences(stored);
  }, [scopeKey]);
  useEffect(() => {
    // Server navigation replaces the form baseline after a verified page load.

    setSearch(query.q ?? "");
    setPreview(null);
    setLayout(initialLayout);
  }, [query.q, query.state, query.sort, query.cursor, initialLayout]);
  // Pagination and layout preserve selection; authorization/filter changes do not.
  useEffect(() => {
    // Security boundary change invalidates local selection before any new action.

    setSelected([]);
  }, [scopeKey, data.scope]);
  const persist = (next: PipelinePreferences) => {
    setPreferences(next);
    if (!writePipelinePreferences(scopeKey, next, localStorageOrNull()))
      setNotice("Preferences could not be saved on this device.");
  };
  const unicornOn = hasUnicornScores(scores);
  const unicornSort =
    unicornOn && isPipelineUnicornSort(query.sort) ? query.sort : null;
  const shown = (target: string, next: RelationshipPipelineViewQuery) =>
    currentRoute() === target &&
    document.querySelector<HTMLElement>("[data-pipeline-root]")?.dataset[
      "pipelineQuery"
    ] === JSON.stringify(RelationshipPipelineViewQuerySchema.parse(next));
  const move = (next: RelationshipPipelineViewQuery) =>
    router.push(pipelineHref(next, layout));
  useQControlGroup({
    kind: "LIST",
    ref,
    ids: { "list.pipeline": "[data-pipeline-records]" },
  });
  useQControlGroup({
    kind: "BUTTON",
    ref,
    ids: {
      "button.pipeline-search": "[data-pipeline-search-button]",
      "button.pipeline-next": "[data-pipeline-next]",
    },
  });
  useQControl({
    id: "filter.pipeline-search",
    kind: "FILTER",
    ref: searchRef,
    onAct: async (intent) => {
      if (intent.act !== "FILTER") return "NOT_APPLICABLE";
      const value = intent.value === null ? "" : intent.value;
      if (typeof value !== "string" || value.trim().length > 120)
        return "FAILED";
      const next = {
        ...query,
        q: value.trim() || undefined,
        cursor: undefined,
      };
      const target = pipelineHref(next, layout);
      move(next);
      return (await effectShown(() => shown(target, next))) ? "DONE" : "FAILED";
    },
  });
  useQControl({
    id: "filter.pipeline-state",
    kind: "FILTER",
    ref: stateRef,
    onAct: async (intent) => {
      if (
        typeof intent.value !== "string" ||
        (intent.value !== "ALL" &&
          !RELATIONSHIP_STATES_V2.includes(
            intent.value as (typeof RELATIONSHIP_STATES_V2)[number],
          ))
      )
        return "NOT_APPLICABLE";
      const next = {
        ...query,
        state:
          intent.value === "ALL"
            ? undefined
            : (intent.value as (typeof RELATIONSHIP_STATES_V2)[number]),
        cursor: undefined,
      };
      const target = pipelineHref(next, layout);
      move(next);
      return (await effectShown(() => shown(target, next))) ? "DONE" : "FAILED";
    },
  });
  useQControl({
    id: "filter.pipeline-sort",
    kind: "FILTER",
    ref: sortRef,
    onAct: async (intent) => {
      if (
        typeof intent.value !== "string" ||
        !(
          ["recent", "oldest", "name", "name-desc", "suitability"].includes(
            intent.value,
          ) || isPipelineUnicornSort(intent.value)
        ) ||
        (intent.value === "suitability" && scores === undefined) ||
        (isPipelineUnicornSort(intent.value) && !unicornOn)
      )
        return "NOT_APPLICABLE";
      const next = {
        ...query,
        sort: sortParam(intent.value),
        cursor: undefined,
      };
      const target = pipelineHref(next, layout);
      move(next);
      return (await effectShown(() => shown(target, next))) ? "DONE" : "FAILED";
    },
  });
  useQDialog(
    preview !== null,
    "pipeline-preview",
    "OTHER",
    preview === null
      ? []
      : [{ kind: preview.counterpart.kind, id: preview.counterpart.id }],
  );
  function submit(event: FormEvent) {
    event.preventDefault();
    move({ ...query, q: search, cursor: undefined });
  }
  /** A saved view: its filters as the URL, its layout and columns here. */
  async function applyView(view: AppliedView): Promise<boolean> {
    persist({
      ...preferences,
      columns: [...view.columns],
      layout: view.layout,
    });
    const target = pipelineHref(view.query, view.layout);
    router.push(target);
    return effectShown(() => shown(target, view.query));
  }
  function setColumn(column: PipelineColumn, checked: boolean) {
    persist({
      ...preferences,
      columns: checked
        ? [...preferences.columns.filter((entry) => entry !== column), column]
        : preferences.columns.filter((entry) => entry !== column),
    });
  }
  const exports = new URLSearchParams({ scope: data.scope });
  // A Unicorn view is the web's own ranking: the export (the API's) keeps
  // its filters and never carries premium scores.
  for (const [key, value] of Object.entries(query))
    if (
      key !== "cursor" &&
      key !== "pageSize" &&
      value !== undefined &&
      !(key === "sort" && isPipelineUnicornSort(value))
    )
      exports.set(key, String(value));
  if (selected.length > 0) exports.set("selected", selected.join(","));
  const unicornNarrowed = unicornSort !== null && unicornSort !== "unicorn";
  const filtered =
    query.q !== undefined || query.state !== undefined || unicornNarrowed;
  const rows = pipelinePresentedRows(data.items, layout);
  const needsOf = (row: RelationshipSummaryDto) => {
    const step = overview?.steps[row.relationshipId];
    return step !== undefined && isOwnStep(step);
  };
  const needsCount =
    overview === null || overview === undefined
      ? null
      : Object.values(overview.steps).filter((step) => isOwnStep(step)).length;
  const shownRows = needsOnly ? rows.filter(needsOf) : rows;
  const stateCount = (state: RelationshipStateV2) =>
    overview === null || overview === undefined
      ? null
      : (overview.counts[state] ?? 0);
  const chips = [
    {
      key: "ALL",
      label: "All",
      count: overview?.total ?? null,
      on: query.state === undefined && !needsOnly,
      onSelect: () => {
        setNeedsOnly(false);
        if (query.state !== undefined)
          move({ ...query, state: undefined, cursor: undefined });
      },
    },
    {
      key: "NEEDS_YOU",
      label: "Needs you",
      count: needsCount,
      on: needsOnly,
      onSelect: () => {
        setNeedsOnly((on) => !on);
        if (query.state !== undefined)
          move({ ...query, state: undefined, cursor: undefined });
      },
    },
    ...BOARD_STATES.filter(
      (state) =>
        query.state === state ||
        // Without the whole pipeline's counts, the states on this page.
        (stateCount(state) ??
          (rows.some((row) => row.state === state) ? 1 : 0)) > 0,
    ).map((state) => ({
      key: state,
      label:
        state === "INTEREST_EXPRESSED" ? "Awaiting reply" : STATE_WORDS[state],
      count: stateCount(state),
      on: query.state === state && !needsOnly,
      onSelect: () => {
        setNeedsOnly(false);
        move({ ...query, state, cursor: undefined });
      },
    })),
  ];
  const nextWords = (row: RelationshipSummaryDto) => {
    const step = overview?.steps[row.relationshipId];
    if (step === undefined) return t(PIPELINE_NEXT_WORDS[row.nextStep]);
    const words = step.label ?? (step.why === "" ? null : step.why);
    return words === null ? t(PIPELINE_NEXT_WORDS[row.nextStep]) : t(words);
  };
  const activityOf = (row: RelationshipSummaryDto) =>
    overview?.activity[row.relationshipId] ?? row.stateSince;
  const sortedBy =
    query.sort === "name" || query.sort === "name-desc"
      ? "company"
      : query.sort === "recent" || query.sort === "oldest"
        ? "activity"
        : query.sort === undefined && ranked
          ? "suitability"
          : unicornSort !== null
            ? "unicorn"
            : null;
  const headerSort = (
    column: "company" | "activity" | "suitability",
    label: string,
    className?: string,
  ) => (
    <th
      className={cx(
        "border-b border-(--cq-border-subtle) bg-(--cq-surface-subtle) px-3 py-2.5 text-xs font-medium whitespace-nowrap",
        sortedBy === column
          ? "text-(--cq-text-primary)"
          : "text-(--cq-text-tertiary)",
        className,
      )}
      aria-sort={
        sortedBy !== column
          ? undefined
          : query.sort === "name-desc" ||
              query.sort === "recent" ||
              column === "suitability"
            ? "descending"
            : "ascending"
      }
    >
      <button
        type="button"
        className="inline-flex min-h-7 items-center gap-1 focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring)"
        onClick={() =>
          move({
            ...query,
            sort:
              column === "company"
                ? query.sort === "name"
                  ? "name-desc"
                  : "name"
                : column === "activity"
                  ? query.sort === "recent"
                    ? "oldest"
                    : "recent"
                  : undefined,
            cursor: undefined,
          })
        }
      >
        {t(label)}
        {sortedBy === column ? (
          <ChevronDown size={14} aria-hidden="true" />
        ) : null}
      </button>
    </th>
  );
  const th =
    "border-b border-(--cq-border-subtle) bg-(--cq-surface-subtle) px-3 py-2.5 text-xs font-medium whitespace-nowrap text-(--cq-text-tertiary)";
  const td = "border-b border-(--cq-border-subtle) px-3 py-2.5 align-middle";
  const peekRow = preview;
  const forward = BOARD_STATES.filter((state) => !BOARD_STOPPED.has(state));
  const columns = [
    ...forward,
    ...BOARD_STATES.filter(
      (state) =>
        BOARD_STOPPED.has(state) &&
        shownRows.some((row) => row.state === state),
    ),
  ].filter((state) => query.state === undefined || query.state === state);
  return (
    <div
      ref={ref}
      className="flex flex-col gap-3.5"
      data-state={data.total === 0 ? "empty" : "ready"}
      data-pipeline-root
      data-pipeline-query={JSON.stringify(query)}
    >
      <QPageState
        filters={{
          view: "pipeline",
          ...(query.state === undefined ? {} : { stage: query.state }),
        }}
      />
      <div className="flex flex-wrap items-center gap-2.5">
        <PipelineSearch
          ref={searchRef}
          side={side}
          value={search}
          onChange={setSearch}
          onSubmit={submit}
        >
          <button
            data-pipeline-search-button
            className={crmButton("secondary", "sr-only focus:not-sr-only")}
            type="submit"
          >
            {t("Search")}
          </button>
        </PipelineSearch>
        <div className="ms-auto flex items-center gap-2">
          <PipelineLayoutSwitch
            layout={layout}
            hrefs={{
              list: pipelineListLayoutHref(query),
              table: pipelineHref(query, "table"),
              board: pipelineHref(query, "board"),
            }}
          />
          <PipelineExport
            href={`/relationships/export?${exports.toString()}`}
            count={
              selected.length > 0
                ? selected.length
                : data.totalExact === false
                  ? null
                  : data.total
            }
            scope={
              query.state === undefined
                ? query.q === undefined
                  ? t("all states")
                  : t("matching your search")
                : t(STATE_WORDS[query.state])
            }
            selected={selected.length}
            iconOnly
          />
        </div>
      </div>

      <div ref={stateRef}>
        {overview === null || overview === undefined ? null : (
          <div className="mb-3">
            <StageStrip counts={overview.counts} needsYou={needsCount} />
          </div>
        )}
        <StateChips label={t("Relationship state")} chips={chips} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <PipelineSavedViews
          initial={views}
          device={preferences.views}
          onDeviceChange={(next) =>
            persist({ ...preferences, views: [...next] })
          }
          current={{
            query: RelationshipViewQuerySchema.parse(
              Object.fromEntries(
                Object.entries(query).filter(([key]) => key !== "cursor"),
              ),
            ),
            layout,
            columns: preferences.columns,
          }}
          onApply={applyView}
          onNotice={setNotice}
        />
        <div className="ms-auto flex flex-wrap items-center gap-2">
          {unicornOn ? (
            <span className="relative inline-flex">
              <select
                aria-label={t("Unicorn Potential")}
                className={selectClass}
                value={unicornSort ?? "any"}
                onChange={(event) =>
                  move({
                    ...query,
                    sort:
                      event.target.value === "any"
                        ? undefined
                        : sortParam(event.target.value),
                    cursor: undefined,
                  })
                }
                data-pipeline-unicorn-filter
              >
                <option value="any">{t("Unicorn Potential: any")}</option>
                {UNICORN_FILTERS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {t(option.label)}
                  </option>
                ))}
              </select>
              <ChevronDown
                size={ICON_SIZE.compact}
                aria-hidden="true"
                className={caret}
              />
            </span>
          ) : null}
          <span className="relative inline-flex">
            <select
              ref={sortRef}
              aria-label={t("Sort relationships")}
              className={selectClass}
              value={query.sort ?? (ranked ? "suitability" : "recent")}
              onChange={(event) =>
                move({
                  ...query,
                  sort: sortParam(event.target.value),
                  cursor: undefined,
                })
              }
            >
              {scores === undefined ? null : (
                <option value="suitability">{t("Best suited first")}</option>
              )}
              {unicornOn ? (
                <option value={unicornSort ?? "unicorn"}>
                  {t("Unicorn Potential, highest first")}
                </option>
              ) : null}
              <option value="recent">{t("Latest state change")}</option>
              <option value="oldest">{t("Earliest state change")}</option>
              <option value="name">{t("Name A–Z")}</option>
              <option value="name-desc">{t("Name Z–A")}</option>
            </select>
            <ChevronDown
              size={ICON_SIZE.compact}
              aria-hidden="true"
              className={caret}
            />
          </span>
          {layout === "table" ? (
            <details className="relative text-[13px]">
              <summary
                className={`${selectClass} inline-flex cursor-pointer list-none items-center [&::-webkit-details-marker]:hidden`}
              >
                {t("Columns")}
              </summary>
              <div className="absolute end-0 z-(--cq-z-popover) mt-1 flex min-w-48 flex-col rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface-raised) px-3 py-1 shadow-(--cq-shadow-sm)">
                {(["state", "since", "next"] as const).map((column) => (
                  <label
                    key={column}
                    className="flex min-h-11 items-center gap-2 text-(--cq-text-primary)"
                  >
                    <input
                      type="checkbox"
                      className="size-4 accent-(--cq-accent)"
                      checked={preferences.columns.includes(column)}
                      onChange={(event) =>
                        setColumn(column, event.target.checked)
                      }
                    />
                    {column === "state"
                      ? t("State")
                      : column === "since"
                        ? t("Last activity")
                        : t("Next step")}
                  </label>
                ))}
              </div>
            </details>
          ) : null}
        </div>
      </div>
      {notice === null ? null : (
        <p role="status" className="text-[13px] text-(--cq-text-secondary)">
          {t(notice)}
        </p>
      )}
      <p className="cq-numeric text-xs text-(--cq-text-tertiary)">
        {/* An upper bound until every row was checked against the reader's
            current sight of the counterpart: said as such, never as exact. */}
        {String(data.items.length)} {t("on this page ·")}{" "}
        {data.totalExact === false ? t("up to ") : ""}
        {String(data.total)} {t("matching relationships")}
        {ranked && (data.nextCursor !== null || query.cursor !== undefined)
          ? ` · ${t("ranked by suitability within each page")}`
          : ""}
        {unicornSort !== null && unicornOn
          ? ` · ${t("ranked by Unicorn Potential across your pipeline")}`
          : ""}
        {needsOnly ? ` · ${t("needs you, on this page")}` : ""}
      </p>
      {unicornSort !== null && unicornOn ? (
        <p className="text-xs text-(--cq-text-tertiary)" data-unicorn-note>
          {t(
            "Insufficient evidence is not a low score: those companies have no Unicorn Potential yet.",
          )}
        </p>
      ) : null}
      {data.total === 0 || shownRows.length === 0 ? (
        <div
          className="cq-crm-swap flex flex-col items-center gap-2 rounded-(--cq-radius-lg) border border-dashed border-(--cq-border) bg-(--cq-surface-subtle) px-6 py-10 text-center"
          data-pipeline-empty
        >
          <span
            aria-hidden="true"
            className="grid size-12 place-items-center rounded-full bg-(--cq-surface-strong) text-(--cq-text-secondary)"
          >
            <Search size={22} />
          </span>
          <b className="text-base text-(--cq-text-primary)">
            {needsOnly && data.total > 0
              ? t("Nothing on this page needs you.")
              : unicornNarrowed
                ? t(
                    "No company in this view has a Unicorn Potential score here yet.",
                  )
                : filtered
                  ? t("No relationships match this view.")
                  : t("No relationships yet.")}
          </b>
          <p className="max-w-[44ch] text-sm text-(--cq-text-secondary)">
            {needsOnly && data.total > 0
              ? t("Other pages may still have steps waiting on you.")
              : unicornNarrowed
                ? t(
                    "Most companies don't have enough evidence for a numerical assessment yet. Every relationship is still in your pipeline.",
                  )
                : filtered
                  ? t(
                      "Clear the search or the state to see every relationship.",
                    )
                  : side === "INVESTOR"
                    ? t(
                        "A relationship starts when you express interest in a company.",
                      )
                    : t(
                        "When an investor expresses interest in your company, it appears here. Investors can only find you once your company is visible.",
                      )}
          </p>
          {needsOnly && data.total > 0 ? (
            <button
              type="button"
              className={crmButton("secondary")}
              onClick={() => setNeedsOnly(false)}
            >
              {t("Show all relationships")}
            </button>
          ) : (
            <Link
              className={crmButton("secondary")}
              href={
                unicornNarrowed
                  ? pipelineHref({ q: query.q, state: query.state }, layout)
                  : filtered
                    ? pipelineHref(
                        { sort: unicornSort === null ? query.sort : undefined },
                        layout,
                      )
                    : side === "INVESTOR"
                      ? "/discover"
                      : "/company/visibility"
              }
            >
              {unicornNarrowed
                ? t("Show all relationships")
                : filtered
                  ? t("Clear filters")
                  : side === "INVESTOR"
                    ? t("Open Discover")
                    : t("Check visibility")}
            </Link>
          )}
        </div>
      ) : layout === "table" ? (
        // `relative`: the rows' sr-only labels are absolutely positioned and
        // would otherwise escape this scroller's clip and widen the page.
        <div className="cq-crm-swap relative -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <table
            data-pipeline-records
            className="w-full border-separate border-spacing-0 overflow-hidden rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface-raised) text-start text-sm"
          >
            <thead>
              <tr>
                <th className={cx(th, "w-11")}>
                  <span className="sr-only">{t("Select")}</span>
                </th>
                {headerSort(
                  "company",
                  side === "INVESTOR" ? "Company" : "Investor",
                  "text-start",
                )}
                {preferences.columns.includes("state") ? (
                  <th className={cx(th, "text-start")}>{t("State")}</th>
                ) : null}
                {scores === undefined ? null : (
                  <>
                    {headerSort("suitability", "Suitability", "text-start")}
                    <th className={cx(th, "text-start")}>
                      {t("Investability")}
                    </th>
                    {unicornOn ? (
                      <th
                        className={cx(
                          th,
                          "text-start",
                          sortedBy === "unicorn" && "text-(--cq-text-primary)",
                        )}
                      >
                        {t("Unicorn Potential")}
                      </th>
                    ) : null}
                  </>
                )}
                {preferences.columns.includes("next") ? (
                  <th className={cx(th, "text-start")}>{t("Next step")}</th>
                ) : null}
                {preferences.columns.includes("since")
                  ? headerSort("activity", "Last activity", "text-start")
                  : null}
              </tr>
            </thead>
            <tbody>
              {shownRows.map((row) => {
                const need = needsOf(row);
                return (
                  <tr
                    key={row.relationshipId}
                    className="relative transition-colors duration-(--cq-motion-fast) last:[&>td]:border-b-0 hover:bg-(--cq-surface-subtle) has-[:checked]:bg-(--cq-accent-soft)"
                  >
                    <td className={cx(td, "relative py-0 pe-1")}>
                      <label className="relative z-[1] inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center">
                        <input
                          type="checkbox"
                          className="size-5 rounded-(--cq-radius-sm) accent-(--cq-accent)"
                          aria-label={t(`Select ${row.counterpart.name}`)}
                          checked={selected.includes(row.relationshipId)}
                          onChange={(event) =>
                            setSelected(
                              event.target.checked
                                ? [...selected, row.relationshipId]
                                : selected.filter(
                                    (id) => id !== row.relationshipId,
                                  ),
                            )
                          }
                        />
                      </label>
                    </td>
                    <td className={cx(td, "max-w-80")}>
                      {/* The whole row opens the peek; the checkbox sits
                          above the link's stretched area. */}
                      <span className="flex items-center gap-2.5 font-semibold">
                        <CounterpartAvatar item={row} size={28} />
                        <Link
                          className="line-clamp-2 break-words text-(--cq-text-primary) after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-(--cq-focus-ring)"
                          href={href(row)}
                          onClick={(event) =>
                            peekClick(event, () => setPreview(row))
                          }
                          data-q-item
                        >
                          {row.counterpart.name}
                        </Link>
                      </span>
                      {scores === undefined &&
                      row.counterpart.kind === "COMPANY" ? (
                        <CompanyScoresLive companyId={row.counterpart.id} />
                      ) : null}
                    </td>
                    {preferences.columns.includes("state") ? (
                      <td className={cx(td, "whitespace-nowrap")}>
                        <StateTag
                          state={row.state}
                          label={
                            row.state === "INTEREST_EXPRESSED"
                              ? "Awaiting reply"
                              : undefined
                          }
                        />
                      </td>
                    ) : null}
                    {scores === undefined ? null : (
                      <>
                        <td className={cx(td, "whitespace-nowrap")}>
                          <SuitabilityFigure
                            value={
                              (scoreOf(scores, row) ?? UNKNOWN_SCORES)
                                .suitability
                            }
                          />
                        </td>
                        <td className={cx(td, "whitespace-nowrap")}>
                          <ScoreFigure
                            label="Investability"
                            value={
                              (scoreOf(scores, row) ?? UNKNOWN_SCORES)
                                .investability
                            }
                            variant="cell"
                          />
                        </td>
                        {unicornOn ? (
                          <td className={cx(td, "whitespace-nowrap")}>
                            {row.counterpart.kind !== "COMPANY" ? null : (
                              <UnicornFigure
                                cell={
                                  scoreOf(scores, row)?.unicorn ?? {
                                    status: "NOT_ASSESSED",
                                    score: null,
                                  }
                                }
                                companyId={row.counterpart.id}
                                variant="cell"
                              />
                            )}
                          </td>
                        ) : null}
                      </>
                    )}
                    {preferences.columns.includes("next") ? (
                      <td
                        className={cx(
                          td,
                          need
                            ? "font-semibold text-(--cq-accent)"
                            : "text-(--cq-text-secondary)",
                        )}
                      >
                        {nextWords(row)}
                      </td>
                    ) : null}
                    {preferences.columns.includes("since") ? (
                      <td
                        className={cx(
                          td,
                          "cq-numeric whitespace-nowrap text-xs text-(--cq-text-tertiary)",
                        )}
                      >
                        <time dateTime={activityOf(row)}>
                          {t(
                            since(activityOf(row), now) ||
                              formatDay(row.stateSince),
                          )}
                        </time>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        // The states as columns, left to right, forward path first; a
        // phone shows one column and a glimpse of the next. Cards move when
        // something happens, never by dragging.
        <div
          data-pipeline-records
          className="cq-crm-swap relative -mx-4 flex snap-x snap-mandatory scroll-px-4 items-start gap-2.5 overflow-x-auto px-4 pb-2 lg:mx-0 lg:snap-none lg:scroll-px-0 lg:px-0"
        >
          {columns.map((state) => {
            const column = shownRows.filter((row) => row.state === state);
            const stopped = BOARD_STOPPED.has(state);
            const count = needsOnly
              ? column.length
              : (stateCount(state) ?? column.length);
            const more = count - column.length;
            return (
              <section
                key={state}
                aria-labelledby={`board-${state}`}
                className="flex w-[290px] flex-none snap-start flex-col gap-2 rounded-(--cq-radius-lg) bg-(--cq-surface-strong) p-2 lg:min-h-[560px] lg:w-auto lg:min-w-40 lg:flex-1"
                data-board-column={state}
              >
                <h2
                  id={`board-${state}`}
                  className="flex items-baseline justify-between gap-2 px-1.5 pt-1.5 pb-1 text-[13px] font-semibold"
                >
                  <span
                    className={
                      stopped
                        ? "text-(--cq-text-secondary)"
                        : "text-(--cq-text-primary)"
                    }
                  >
                    {t(
                      state === "INTEREST_EXPRESSED"
                        ? "Awaiting reply"
                        : STATE_WORDS[state],
                    )}
                  </span>{" "}
                  <span className="cq-numeric font-normal text-(--cq-text-tertiary)">
                    {count}
                  </span>
                </h2>
                <ul className="flex flex-col gap-2">
                  {column.map((row) => {
                    const need = needsOf(row);
                    const about = overview?.about[row.relationshipId] ?? null;
                    const suitability =
                      scores === undefined
                        ? undefined
                        : (scoreOf(scores, row) ?? UNKNOWN_SCORES).suitability;
                    return (
                      <li
                        key={row.relationshipId}
                        className={cx(
                          // Less curved than the prototype (owner
                          // 2026-10-20): the 6px radius.
                          "cq-crm-lift relative flex flex-col gap-1.5 rounded-(--cq-radius-sm) border bg-(--cq-surface-raised) p-2.5",
                          need
                            ? "border-(--cq-accent)/60 shadow-[inset_3px_0_0_var(--cq-accent)]"
                            : "border-(--cq-border-subtle)",
                        )}
                        data-board-card={row.relationshipId}
                      >
                        <span className="flex min-w-0 items-center gap-2 text-[13px] font-semibold">
                          <CounterpartAvatar item={row} size={28} />
                          <Link
                            href={href(row)}
                            onClick={(event) =>
                              peekClick(event, () => setPreview(row))
                            }
                            data-q-item
                            className="truncate text-(--cq-text-primary) after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-(--cq-focus-ring)"
                          >
                            {row.counterpart.name}
                          </Link>
                        </span>
                        {about === null ? null : (
                          <span className="line-clamp-2 text-xs leading-[1.35] text-(--cq-text-secondary)">
                            {t(about)}
                          </span>
                        )}
                        <span className="flex items-center justify-between gap-2 text-xs text-(--cq-text-tertiary)">
                          {suitability === undefined ? (
                            <span>{t(PIPELINE_NEXT_WORDS[row.nextStep])}</span>
                          ) : suitability === null ? (
                            <UnknownValue className="text-xs">
                              {t("Not enough evidence")}
                            </UnknownValue>
                          ) : (
                            <span data-pipeline-score="suitability">
                              {t("Suitability")}{" "}
                              <b className="text-(--cq-text-primary)">
                                {String(suitability)}
                              </b>
                            </span>
                          )}
                          <time
                            className="cq-numeric"
                            dateTime={activityOf(row)}
                          >
                            {t(since(activityOf(row), now))}
                          </time>
                        </span>
                        {need ? (
                          <span className="flex items-start gap-1 text-xs font-semibold text-(--cq-accent)">
                            <Flag
                              size={14}
                              aria-hidden="true"
                              className="mt-px flex-none"
                            />
                            {nextWords(row)}
                          </span>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
                {more > 0 ? (
                  <p className="p-1.5 text-center text-xs text-(--cq-text-tertiary)">
                    {t(`${String(more)} more`)}
                  </p>
                ) : null}
              </section>
            );
          })}
        </div>
      )}
      {query.cursor === undefined && data.nextCursor === null ? null : (
        <nav aria-label={t("Pages")} className="flex flex-wrap gap-2">
          {query.cursor === undefined ? null : (
            <Link
              className={crmButton("quiet")}
              href={pipelineHref({ ...query, cursor: undefined }, layout)}
            >
              {t("Start of view")}
            </Link>
          )}
          {data.nextCursor === null ? null : (
            <Link
              data-pipeline-next
              className={crmButton("secondary")}
              href={pipelineHref({ ...query, cursor: data.nextCursor }, layout)}
            >
              {t("Next page")}
            </Link>
          )}
        </nav>
      )}
      <RelationshipPeek
        item={peekRow}
        onClose={() => setPreview(null)}
        side={side}
        now={now}
        step={
          peekRow === null ? undefined : overview?.steps[peekRow.relationshipId]
        }
        activity={peekRow === null ? undefined : activityOf(peekRow)}
        scores={
          scores === undefined || peekRow === null
            ? undefined
            : (scoreOf(scores, peekRow) ?? UNKNOWN_SCORES)
        }
        fit={
          peekRow === null ||
          fits === undefined ||
          peekRow.counterpart.kind !== "COMPANY" ||
          !(peekRow.counterpart.id in fits)
            ? undefined
            : (fits[peekRow.counterpart.id] ?? null)
        }
      />
    </div>
  );
}
