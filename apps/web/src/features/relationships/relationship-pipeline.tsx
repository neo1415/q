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
  type RelationshipPipelineDto,
  type RelationshipPipelineViewQuery,
  type RelationshipSummaryDto,
  type SavedRelationshipViewList,
} from "@capital-q/contracts";
import { buttonClassName } from "@capital-q/ui/button";
import { DialogContent, DialogRoot } from "@capital-q/ui/dialog";
import { Download, ICON_SIZE, Search } from "@capital-q/ui/icons";
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
import { ScoreFigure, ScoreLine, UnicornFigure } from "./pipeline-score-figure";
import {
  hasUnicornScores,
  scoreOf,
  UNKNOWN_SCORES,
  type PipelineScores,
} from "./pipeline-scores";
import { useT } from "@/features/i18n/language";

const inputClass =
  "cq-body-sm min-h-11 border border-(--cq-border) bg-(--cq-surface-raised) px-3 text-(--cq-text-primary) placeholder:text-(--cq-text-tertiary) focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring)";
/** A select reads as a quiet control in the view bar, not a form field. */
const selectClass = `${inputClass} max-w-full pe-8`;
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
const UNICORN_SUMMARY: Readonly<Record<string, string>> = {
  unicorn: "Unicorn Potential first",
  "unicorn-scored": "Unicorn Potential scored",
  "unicorn-40": "Unicorn Potential 40+",
  "unicorn-60": "Unicorn Potential 60+",
  "unicorn-80": "Unicorn Potential 80+",
  "unicorn-insufficient": "Unicorn: insufficient evidence",
};

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
}: {
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
  const stateRef = useRef<HTMLSelectElement>(null);
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
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPreferences(stored);
  }, [scopeKey]);
  useEffect(() => {
    // Server navigation replaces the form baseline after a verified page load.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSearch(query.q ?? "");
    setPreview(null);
    setLayout(initialLayout);
  }, [query.q, query.state, query.sort, query.cursor, initialLayout]);
  // Pagination and layout preserve selection; authorization/filter changes do not.
  useEffect(() => {
    // Security boundary change invalidates local selection before any new action.
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
  // What the folded panel says it holds, so a phone shows the view in use.
  const optionsSummary = [
    query.state === undefined ? null : STATE_WORDS[query.state],
    query.sort === "name"
      ? "Name A–Z"
      : query.sort === "name-desc"
        ? "Name Z–A"
        : query.sort === "oldest"
          ? "Earliest first"
          : unicornSort !== null
            ? (UNICORN_SUMMARY[unicornSort] ?? null)
            : null,
    layout === "board" ? "Board" : null,
  ]
    .filter((part): part is string => part !== null)
    .join(" · ");
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
  return (
    <div
      ref={ref}
      className="flex flex-col gap-4"
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <form
          onSubmit={submit}
          className="flex min-w-0 flex-1 basis-full items-center gap-2 sm:max-w-md sm:basis-auto"
          role="search"
          aria-label={t("Pipeline filters")}
        >
          <div className="relative min-w-0 flex-1">
            <Search
              size={ICON_SIZE.compact}
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 start-3 -translate-y-1/2 text-(--cq-text-tertiary)"
            />
            <input
              ref={searchRef}
              aria-label={
                side === "INVESTOR"
                  ? t("Search companies")
                  : t("Search investors")
              }
              placeholder={
                side === "INVESTOR"
                  ? t("Search companies")
                  : t("Search investors")
              }
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className={`${inputClass} w-full ps-9 lg:min-h-10`}
              maxLength={120}
            />
          </div>
          <button
            data-pipeline-search-button
            className={buttonClassName("secondary")}
            type="submit"
          >
            {t("Search")}
          </button>
        </form>
        <PipelineLayoutSwitch
          layout={layout}
          hrefs={{
            list: pipelineListLayoutHref(query),
            table: pipelineHref(query, "table"),
            board: pipelineHref(query, "board"),
          }}
        />
      </div>
      {/*
        One "View options" panel on a phone (production review 2026-10-15:
        the controls filled the first screen); from tablet width up the
        panel is always open and its summary hidden. Search and layout stay
        outside: they are what a person reaches for first.
      */}
      <details
        className="group md:[&::details-content]:[content-visibility:visible]"
        data-pipeline-options
      >
        <summary className="cq-body-sm flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 border border-(--cq-border) bg-(--cq-surface-raised) px-3 text-(--cq-text-primary) focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring) md:hidden [&::-webkit-details-marker]:hidden">
          <span className="font-medium">{t("View options")}</span>
          <span className="truncate text-(--cq-text-secondary)">
            {optionsSummary !== ""
              ? t(optionsSummary)
              : ranked
                ? t("All · best suited first")
                : t("All · latest first")}
          </span>
        </summary>
        <div className="flex flex-col gap-2 pt-3 md:flex-row md:flex-wrap md:items-center md:border-y md:border-(--cq-border-subtle) md:py-2">
          <div
            className="flex flex-wrap items-center gap-2"
            aria-label={t("Filter and sort")}
            role="group"
          >
            <select
              ref={stateRef}
              aria-label={t("Relationship state")}
              className={selectClass}
              value={query.state ?? "ALL"}
              onChange={(event) =>
                move({
                  ...query,
                  state:
                    event.target.value === "ALL"
                      ? undefined
                      : (event.target
                          .value as (typeof RELATIONSHIP_STATES_V2)[number]),
                  cursor: undefined,
                })
              }
            >
              <option value="ALL">{t("All states")}</option>
              {RELATIONSHIP_STATES_V2.map((state) => (
                <option key={state} value={state}>
                  {t(STATE_WORDS[state])}
                </option>
              ))}
            </select>
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
                <option value="suitability">
                  {t("Suitability, highest first")}
                </option>
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
            {unicornOn ? (
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
            ) : null}
            {layout === "table" ? (
              <details className="cq-body-sm relative">
                <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1 px-3 text-(--cq-text-secondary) hover:text-(--cq-text-primary) focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring) [&::-webkit-details-marker]:hidden">
                  {t("Columns")}
                </summary>
                <div className="flex flex-col px-3 pb-1">
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
                          ? t("State changed")
                          : t("Next step")}
                    </label>
                  ))}
                </div>
              </details>
            ) : null}
          </div>
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
          <a
            className={buttonClassName("quiet", "regular", "md:ms-auto")}
            href={`/relationships/export?${exports.toString()}`}
            // The bar says "Export"; the name says what the file holds.
            aria-label={
              selected.length === 0 ? t("Export filtered CSV") : undefined
            }
          >
            <Download size={ICON_SIZE.compact} aria-hidden="true" />
            {selected.length === 0
              ? t("Export")
              : t(`Export ${String(selected.length)} selected`)}
          </a>
        </div>
      </details>
      {notice === null ? null : (
        <p role="status" className="cq-body-sm text-(--cq-text-secondary)">
          {t(notice)}
        </p>
      )}
      <p className="cq-caption cq-numeric text-(--cq-text-secondary)">
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
      </p>
      {unicornSort !== null && unicornOn ? (
        <p className="cq-caption text-(--cq-text-secondary)" data-unicorn-note>
          {t(
            "Insufficient evidence is not a low score: those companies have no Unicorn Potential yet.",
          )}
        </p>
      ) : null}
      {data.total === 0 ? (
        <div
          className="flex flex-col items-start gap-3 border-y border-(--cq-border-subtle) py-8"
          data-pipeline-empty
        >
          <p className="cq-body text-(--cq-text-primary)">
            {unicornNarrowed
              ? t(
                  "No company in this view has a Unicorn Potential score here yet.",
                )
              : filtered
                ? t("No relationships match this view.")
                : t("No relationships yet.")}
          </p>
          <p className="cq-body-sm max-w-(--cq-layout-reading) text-(--cq-text-secondary)">
            {unicornNarrowed
              ? t(
                  "Most companies don't have enough evidence for a numerical assessment yet. Every relationship is still in your pipeline.",
                )
              : filtered
                ? t("Clear the search or the state to see every relationship.")
                : side === "INVESTOR"
                  ? t(
                      "A relationship starts when you express interest in a company.",
                    )
                  : t(
                      "When an investor expresses interest in your company, it appears here. Investors can only find you once your company is visible.",
                    )}
          </p>
          <Link
            className={buttonClassName("secondary")}
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
        </div>
      ) : layout === "table" ? (
        // `relative`: the rows' sr-only labels are absolutely positioned and
        // would otherwise escape this scroller's clip and widen the page.
        <div className="relative -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <table
            data-pipeline-records
            className="cq-body-sm w-full border-collapse text-start"
          >
            <thead className="cq-caption border-b border-(--cq-border) text-(--cq-text-secondary) [&_th]:font-medium [&_th]:whitespace-nowrap">
              <tr>
                <th className="w-11 py-2 pe-1">
                  <span className="sr-only">{t("Select")}</span>
                </th>
                <th className="py-2 pe-4">
                  {side === "INVESTOR" ? t("Company") : t("Investor")}
                </th>
                {scores === undefined ? null : (
                  <>
                    <th className="py-2 pe-4 text-end">{t("Suitability")}</th>
                    <th className="py-2 pe-4 text-end">{t("Investability")}</th>
                    {unicornOn ? (
                      <th className="py-2 pe-4 text-end">
                        {t("Unicorn Potential")}
                      </th>
                    ) : null}
                  </>
                )}
                {preferences.columns.includes("state") ? (
                  <th className="py-2 pe-4">{t("State")}</th>
                ) : null}
                {preferences.columns.includes("since") ? (
                  <th className="py-2 pe-4">{t("State changed")}</th>
                ) : null}
                {preferences.columns.includes("next") ? (
                  <th className="py-2 pe-4">{t("Next step")}</th>
                ) : null}
                <th className="py-2 text-end">
                  <span className="sr-only">{t("Details")}</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-(--cq-border-subtle)">
              {rows.map((row) => (
                <tr
                  key={row.relationshipId}
                  className="relative transition-colors duration-(--cq-motion-fast) hover:bg-(--cq-surface-subtle) has-[:checked]:bg-(--cq-surface-subtle)"
                >
                  <td className="relative py-0 pe-1 align-middle">
                    <label className="inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center">
                      <input
                        type="checkbox"
                        className="size-4 accent-(--cq-accent)"
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
                  <td className="max-w-80 py-3 pe-4">
                    {/* The whole row opens the record; the checkbox and
                        Preview sit above the link's stretched area. */}
                    <Link
                      className="line-clamp-2 font-medium break-words text-(--cq-text-primary) after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-(--cq-focus-ring)"
                      href={href(row)}
                      data-q-item
                    >
                      {row.counterpart.name}
                    </Link>
                    {scores === undefined &&
                    row.counterpart.kind === "COMPANY" ? (
                      <CompanyScoresLive companyId={row.counterpart.id} />
                    ) : null}
                  </td>
                  {scores === undefined ? null : (
                    <>
                      <td className="py-3 pe-4 text-end">
                        <ScoreFigure
                          label="Suitability"
                          value={
                            (scoreOf(scores, row) ?? UNKNOWN_SCORES).suitability
                          }
                          variant="cell"
                        />
                      </td>
                      <td className="py-3 pe-4 text-end">
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
                        <td className="py-3 pe-4 text-end whitespace-nowrap">
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
                  {preferences.columns.includes("state") ? (
                    <td className="py-3 pe-4 whitespace-nowrap text-(--cq-text-primary)">
                      {t(STATE_WORDS[row.state])}
                    </td>
                  ) : null}
                  {preferences.columns.includes("since") ? (
                    <td className="cq-numeric py-3 pe-4 whitespace-nowrap text-(--cq-text-secondary)">
                      <time dateTime={row.stateSince}>
                        {t(formatDay(row.stateSince))}
                      </time>
                    </td>
                  ) : null}
                  {preferences.columns.includes("next") ? (
                    <td className="py-3 pe-4 text-(--cq-text-secondary)">
                      {t(PIPELINE_NEXT_WORDS[row.nextStep])}
                    </td>
                  ) : null}
                  <td className="relative py-1 text-end">
                    <button
                      type="button"
                      className={buttonClassName("quiet", "compact")}
                      onClick={() => setPreview(row)}
                    >
                      {t("Preview")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        // One row of stage columns, left to right, scrolling sideways when
        // there are more than fit; a phone shows one column and a glimpse
        // of the next, so the row reads as scrollable.
        <div
          data-pipeline-records
          className="relative -mx-4 flex snap-x snap-mandatory scroll-px-4 items-start gap-3 overflow-x-auto px-4 pb-3 sm:mx-0 sm:snap-none sm:scroll-px-0 sm:px-0"
        >
          {BOARD_STATES.filter((state) =>
            rows.some((row) => row.state === state),
          ).map((state) => {
            const column = rows.filter((row) => row.state === state);
            const stopped = BOARD_STOPPED.has(state);
            return (
              <section
                key={state}
                aria-labelledby={`board-${state}`}
                className="flex w-[80%] flex-none snap-start flex-col gap-2 bg-(--cq-surface-subtle) p-2 sm:w-64"
                data-board-column={state}
              >
                <h2
                  id={`board-${state}`}
                  className="flex items-baseline justify-between gap-2 px-2 pt-1"
                >
                  <span
                    className={`cq-label ${stopped ? "text-(--cq-text-secondary)" : "text-(--cq-text-primary)"}`}
                  >
                    {t(STATE_WORDS[state])}
                  </span>{" "}
                  <span className="cq-caption cq-numeric text-(--cq-text-tertiary)">
                    {column.length}
                  </span>
                </h2>
                <ul className="flex flex-col gap-1.5">
                  {column.map((row) => (
                    <li
                      key={row.relationshipId}
                      className="relative flex items-start justify-between gap-2 border border-(--cq-border-subtle) bg-(--cq-surface-raised) py-2.5 pe-1.5 ps-3 transition-colors duration-(--cq-motion-fast) hover:border-(--cq-border)"
                    >
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <Link
                          href={href(row)}
                          data-q-item
                          className="cq-body-sm line-clamp-2 font-medium break-words text-(--cq-text-primary) after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-(--cq-focus-ring)"
                        >
                          {row.counterpart.name}
                        </Link>
                        {row.counterpart.kind !== "COMPANY" ? null : scores ===
                          undefined ? (
                          <CompanyScoresLive companyId={row.counterpart.id} />
                        ) : (
                          <ScoreLine
                            scores={scoreOf(scores, row) ?? UNKNOWN_SCORES}
                            companyId={row.counterpart.id}
                          />
                        )}
                        {row.nextStep === "NONE" ? null : (
                          <p className="cq-caption text-(--cq-text-secondary)">
                            {t(PIPELINE_NEXT_WORDS[row.nextStep])}
                          </p>
                        )}
                        <p className="cq-caption cq-numeric text-(--cq-text-tertiary)">
                          {t("Since")}{" "}
                          <time dateTime={row.stateSince}>
                            {t(formatDay(row.stateSince))}
                          </time>
                        </p>
                      </div>
                      <button
                        type="button"
                        className={buttonClassName(
                          "quiet",
                          "compact",
                          "relative flex-none",
                        )}
                        onClick={() => setPreview(row)}
                      >
                        {t("Preview")}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
      {query.cursor === undefined && data.nextCursor === null ? null : (
        <nav aria-label={t("Pages")} className="flex flex-wrap gap-2">
          {query.cursor === undefined ? null : (
            <Link
              className={buttonClassName("quiet")}
              href={pipelineHref({ ...query, cursor: undefined }, layout)}
            >
              {t("Start of view")}
            </Link>
          )}
          {data.nextCursor === null ? null : (
            <Link
              data-pipeline-next
              className={buttonClassName("secondary")}
              href={pipelineHref({ ...query, cursor: data.nextCursor }, layout)}
            >
              {t("Next page")}
            </Link>
          )}
        </nav>
      )}
      <DialogRoot
        open={preview !== null}
        onOpenChange={(open) => {
          if (!open) setPreview(null);
        }}
      >
        <DialogContent
          title={t(preview?.counterpart.name ?? t("Relationship"))}
        >
          {preview === null ? null : (
            <div className="flex flex-col gap-3">
              <p>{t(STATE_WORDS[preview.state])}</p>
              <p className="cq-body-sm">
                {t(PIPELINE_NEXT_WORDS[preview.nextStep])}
              </p>
              <Link className={buttonClassName("primary")} href={href(preview)}>
                {t("Open relationship")}
              </Link>
            </div>
          )}
        </DialogContent>
      </DialogRoot>
    </div>
  );
}
