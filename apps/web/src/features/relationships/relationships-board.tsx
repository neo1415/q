"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";

import type {
  FitProfileDto,
  RelationshipSummaryDto,
  SavedRelationshipViewList,
} from "@capital-q/contracts";
import { cx } from "@capital-q/ui";
import { ChevronDown, Flag, ICON_SIZE } from "@capital-q/ui/icons";

import { EntityAvatar } from "@/features/entity/entity-avatar";
import { effectShown } from "@/features/q/control/perform";
import { useQControl, useQControlGroup } from "@/features/q/control/q-control";

import { crmButton, StateTag } from "./crm-kit";
import { PipelineLayoutSwitch } from "./pipeline-layout-switch";
import { pipelineHref } from "./pipeline-preferences";
import { PipelineSavedViews } from "./pipeline-saved-views";
import {
  hasUnicornScores,
  listOrdered,
  scoreOf,
  UNKNOWN_SCORES,
  type ListSort,
  type PipelineScores,
} from "./pipeline-scores";
import { PipelineExport, PipelineSearch, StateChips } from "./pipeline-toolbar";
import type { RelationshipDigest } from "./relationship-data";
import { peekClick, RelationshipPeek } from "./relationship-peek";
import { relationshipHref, STATE_WORDS } from "./relationship-words";
import { StageStrip } from "./stage-strip";
import { moreRelationshipDigestsAction } from "./relationships-actions";
import {
  isOwnStep,
  lastActivityAt,
  nextStepFor,
  PAGE_SIZE,
  rowFacts,
  since,
  type CommitmentFact,
  type ListSide,
  type NextStep,
} from "./relationships-view";
import { useT } from "@/features/i18n/language";

/**
 * The Pipeline's List layout (design 2026-10-20, "One list, three
 * layouts"): the bar (search, the layout switch, Export), the state chips
 * with counts, the saved views and the order, then one row per
 * relationship: who, what they do, where it stands in words, its one next
 * step (in the accent with a flag when it waits on this side) and when
 * anything last happened. A row opens the record peek; a modified click
 * opens the relationship. An investor's list is ranked by Suitability
 * unless they chose the latest change first (owner 2026-10-17).
 */

type Filter =
  | "ALL"
  | "NEEDS_YOU"
  | "INTEREST_EXPRESSED"
  | "CONNECTED"
  | "MEETING_HELD"
  | "IN_DILIGENCE"
  | "PAUSED"
  | "PASSED"
  | "INVESTED"
  | "DECLINED"
  | "DISCOVERED";

const FILTER_WORDS: Readonly<Record<Filter, string>> = {
  ALL: "All",
  NEEDS_YOU: "Needs you",
  INTEREST_EXPRESSED: "Awaiting reply",
  CONNECTED: STATE_WORDS.CONNECTED,
  MEETING_HELD: STATE_WORDS.MEETING_HELD,
  IN_DILIGENCE: STATE_WORDS.IN_DILIGENCE,
  PAUSED: STATE_WORDS.PAUSED,
  PASSED: STATE_WORDS.PASSED,
  INVESTED: STATE_WORDS.INVESTED,
  DECLINED: STATE_WORDS.DECLINED,
  DISCOVERED: STATE_WORDS.DISCOVERED,
};
const FILTERS = Object.keys(FILTER_WORDS) as Filter[];

/** Q's ids (literal, for the capability parity matrix). */
const Q_BOARD_LIST: Readonly<Record<string, string>> = {
  "list.relationships": "[data-relationships-list]",
};
const Q_BOARD_SEARCH: Readonly<Record<string, string>> = {
  "input.relationship-search": "[data-relationships-search]",
};

export function RelationshipsBoard({
  side,
  items,
  digests: initialDigests,
  unread,
  commitments = {},
  now,
  fits,
  scores,
  sort: initialSort = "recent",
  layoutHrefs,
  exportScope,
  views,
}: {
  readonly side: ListSide;
  /**
   * Fit with the investor's own mandate by company id (ADR 0052; B3).
   * Absent: no fit is shown. A null entry: no mandate to fit against.
   */
  readonly fits?: Readonly<Record<string, FitProfileDto | null>> | undefined;
  /**
   * Suitability and Investability by company id, from the Q API (ADR 0074).
   * Absent: no scores (a founder's list). A company missing from it shows
   * them as not known yet.
   */
  readonly scores?: Readonly<Record<string, PipelineScores>> | undefined;
  /** The order the page was asked for (URL); suitability needs `scores`. */
  readonly sort?: ListSort | undefined;
  readonly items: readonly RelationshipSummaryDto[];
  readonly digests: Readonly<Record<string, RelationshipDigest>>;
  /** R34: unread chat messages per relationship id. */
  readonly unread: Readonly<Record<string, number>>;
  /** Commitments waiting on this side, by relationship id (Capital). */
  readonly commitments?: Readonly<Record<string, CommitmentFact>> | undefined;
  /** When the page was read, so server and browser say the same "2h". */
  readonly now: number;
  /** The layout switch's addresses; absent: no switch (a preview). */
  readonly layoutHrefs?:
    | { readonly list: string; readonly table: string; readonly board: string }
    | undefined;
  /**
   * The export scope binding for the whole list (from the pipeline read);
   * null: unavailable just now; absent: no Export (a preview).
   */
  readonly exportScope?: string | null | undefined;
  /** The saved views; null when they could not be read; absent: none shown. */
  readonly views?: SavedRelationshipViewList | null | undefined;
}) {
  const t = useT();
  const router = useRouter();

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("ALL");
  const [peek, setPeek] = useState<RelationshipSummaryDto | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // RECOVERY-2026-10 (C1): the board's search, list and filter, for Q. The
  // filter takes a code (ALL, NEEDS_YOU, ...) through the pills' own setter.
  const boardRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLDivElement>(null);
  useQControlGroup({ kind: "LIST", ref: boardRef, ids: Q_BOARD_LIST });
  useQControlGroup({ kind: "INPUT", ref: boardRef, ids: Q_BOARD_SEARCH });
  useQControl({
    id: "filter.relationships",
    kind: "FILTER",
    ref: filterRef,
    onAct: (intent) => {
      if (intent.act !== "FILTER") return "NOT_APPLICABLE";
      const wanted = intent.value === null ? "ALL" : intent.value;
      const key = FILTERS.find((one) => one === wanted);
      if (key === undefined) return "NOT_APPLICABLE";
      setFilter(key);
      // DONE once the chip shows it is on, not when it was asked.
      return effectShown(
        () =>
          filterRef.current
            ?.querySelector(`[data-filter="${key}"]`)
            ?.getAttribute("aria-pressed") === "true",
        2_000,
      ).then((shown) => (shown ? "DONE" : "FAILED"));
    },
  });
  const [digests, setDigests] = useState(initialDigests);
  const unicornOn = hasUnicornScores(scores);
  const sort: ListSort =
    scores === undefined || initialSort === "recent"
      ? "recent"
      : initialSort === "unicorn" && unicornOn
        ? "unicorn"
        : "suitability";
  const ordered = useMemo(
    () => listOrdered(items, scores, sort),
    [items, scores, sort],
  );
  const [shown, setShown] = useState(() => Math.min(PAGE_SIZE, ordered.length));
  const [loading, startLoading] = useTransition();
  const [moreFailed, setMoreFailed] = useState(false);

  const rows = useMemo(
    () =>
      ordered.map((item) => {
        const facts = rowFacts(
          digests[item.relationshipId],
          unread[item.relationshipId] ?? 0,
          commitments[item.relationshipId],
        );
        return {
          item,
          facts,
          step: nextStepFor(item, facts, side, now, relationshipHref(item)),
          activity: lastActivityAt(item, facts),
        };
      }),
    [ordered, digests, unread, commitments, side, now],
  );

  const counts = useMemo(() => {
    const out = new Map<Filter, number>();
    for (const key of FILTERS) {
      out.set(
        key,
        rows.filter((row) =>
          key === "ALL"
            ? true
            : key === "NEEDS_YOU"
              ? isOwnStep(row.step)
              : row.item.state === key,
        ).length,
      );
    }
    return out;
  }, [rows]);

  // The stage strip reads the same rows as the chips, so the two agree.
  const stageCounts = useMemo(() => {
    const out: Partial<Record<RelationshipSummaryDto["state"], number>> = {};
    for (const row of rows)
      out[row.item.state] = (out[row.item.state] ?? 0) + 1;
    return out;
  }, [rows]);

  const needle = query.trim().toLowerCase();
  const filtered = rows.filter(
    (row) =>
      (filter === "ALL" ||
        (filter === "NEEDS_YOU"
          ? isOwnStep(row.step)
          : row.item.state === filter)) &&
      (needle.length === 0 ||
        row.item.counterpart.name.toLowerCase().includes(needle) ||
        (digests[row.item.relationshipId]?.about ?? "")
          .toLowerCase()
          .includes(needle)),
  );
  // The cursor window applies to the whole list; a filter or a search
  // reads across everything already listed.
  const paging = filter === "ALL" && needle.length === 0;
  const visible = paging ? filtered.slice(0, shown) : filtered;

  // The next rows in this list's own order: their details are read by id,
  // so paging follows whichever order is shown.
  const more = () => {
    const ids = ordered
      .slice(shown, shown + PAGE_SIZE)
      .map((item) => item.relationshipId);
    if (ids.length === 0) return;
    setMoreFailed(false);
    startLoading(async () => {
      const page = await moreRelationshipDigestsAction(ids);
      if (!page.ok) {
        setMoreFailed(true);
        return;
      }
      setDigests((current) => ({ ...current, ...page.digests }));
      setShown((count) => count + ids.length);
    });
  };
  // Another order is a fresh server read (its first rows' details come
  // with it); the choice stays in the URL, so a reload keeps it.
  const chooseSort = (next: ListSort) => {
    const url = new URL(window.location.href);
    if (next === "suitability") url.searchParams.delete("sort");
    else url.searchParams.set("sort", next);
    router.push(`${url.pathname}${url.search}`);
  };

  const chips = FILTERS.filter(
    (key) => key === "ALL" || key === "NEEDS_YOU" || (counts.get(key) ?? 0) > 0,
  );

  // Export: exactly what is shown. A chip or a search exports those rows
  // by id (the API checks each again); with neither, the whole list.
  const narrowed = filter !== "ALL" || needle.length > 0;
  const exportIds = filtered.map((row) => row.item.relationshipId);
  const exportHref =
    exportScope === undefined || exportScope === null
      ? null
      : narrowed && (exportIds.length === 0 || exportIds.length > 200)
        ? null
        : `/relationships/export?${new URLSearchParams({
            scope: exportScope,
            ...(narrowed ? { selected: exportIds.join(",") } : {}),
          }).toString()}`;
  const peekRow =
    peek === null
      ? undefined
      : rows.find((row) => row.item.relationshipId === peek.relationshipId);

  return (
    <div
      ref={boardRef}
      className="flex flex-col gap-3.5"
      data-relationships-board
    >
      <div className="flex flex-wrap items-center gap-2.5">
        <PipelineSearch
          side={side}
          type="search"
          label={t("Search relationships")}
          value={query}
          onChange={setQuery}
          data-relationships-search
        />
        <div className="ms-auto flex items-center gap-2">
          {layoutHrefs === undefined ? null : (
            <PipelineLayoutSwitch layout="list" hrefs={layoutHrefs} />
          )}
          {exportScope === undefined ? null : (
            <PipelineExport
              href={exportHref}
              count={narrowed ? exportIds.length : rows.length}
              scope={
                filter === "ALL"
                  ? needle.length > 0
                    ? t("matching your search")
                    : t("all states")
                  : t(FILTER_WORDS[filter])
              }
              iconOnly
            />
          )}
        </div>
      </div>

      <div ref={filterRef}>
        <div className="mb-3">
          <StageStrip
            counts={stageCounts}
            needsYou={counts.get("NEEDS_YOU") ?? 0}
          />
        </div>
        <StateChips
          label={t("Show")}
          chips={chips.map((key) => ({
            key,
            label: FILTER_WORDS[key],
            count: counts.get(key) ?? 0,
            on: filter === key,
            onSelect: () => setFilter(key),
          }))}
        />
      </div>

      {views === undefined && scores === undefined ? null : (
        <div className="flex flex-wrap items-center gap-2">
          {views === undefined ? null : (
            <PipelineSavedViews
              initial={views}
              device={[]}
              onDeviceChange={() => undefined}
              current={{ query: {}, layout: "table", columns: [] }}
              onApply={(view) => {
                router.push(pipelineHref(view.query, view.layout));
                return Promise.resolve(true);
              }}
              onNotice={setNotice}
              canSave={false}
            />
          )}
          {scores === undefined ? null : (
            <label className="ms-auto inline-flex items-center gap-2 text-[13px] text-(--cq-text-secondary)">
              <span className="sr-only">{t("Sort relationships")}</span>
              <span className="relative inline-flex">
                <select
                  aria-label={t("Sort relationships")}
                  value={sort}
                  onChange={(event) =>
                    chooseSort(
                      event.target.value === "recent"
                        ? "recent"
                        : event.target.value === "unicorn"
                          ? "unicorn"
                          : "suitability",
                    )
                  }
                  className="min-h-11 appearance-none rounded-full border border-(--cq-border) bg-(--cq-surface-raised) ps-3.5 pe-8 text-[13px] font-medium text-(--cq-text-primary) focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring) lg:min-h-10"
                  data-relationships-sort
                >
                  <option value="suitability">{t("Best suited first")}</option>
                  {unicornOn ? (
                    <option value="unicorn">
                      {t("Unicorn Potential, highest first")}
                    </option>
                  ) : null}
                  <option value="recent">{t("Latest state change")}</option>
                </select>
                <ChevronDown
                  size={ICON_SIZE.compact}
                  aria-hidden="true"
                  className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-(--cq-text-tertiary)"
                />
              </span>
            </label>
          )}
        </div>
      )}
      {notice === null ? null : (
        <p role="status" className="text-[13px] text-(--cq-text-secondary)">
          {t(notice)}
        </p>
      )}

      {visible.length === 0 ? (
        <div
          className="cq-crm-swap flex flex-col items-center gap-2 rounded-(--cq-radius-lg) border border-dashed border-(--cq-border) bg-(--cq-surface-subtle) px-6 py-10 text-center"
          role="status"
          data-state="filtered-empty"
        >
          <b className="text-base text-(--cq-text-primary)">
            {needle.length > 0
              ? t(`Nothing matches “${query.trim()}”.`)
              : filter === "NEEDS_YOU"
                ? t("Nothing needs you right now.")
                : t(`None ${FILTER_WORDS[filter].toLowerCase()} right now.`)}
          </b>
          {needle.length > 0 || filter !== "ALL" ? (
            <button
              type="button"
              className={crmButton("secondary")}
              onClick={() => {
                setQuery("");
                setFilter("ALL");
              }}
            >
              {t("Clear filters")}
            </button>
          ) : null}
        </div>
      ) : (
        // One surface with hairline rows, not a card per relationship.
        <ul
          key={`${filter}:${needle}`}
          aria-label={t("Relationships")}
          className="cq-crm-swap flex flex-col divide-y divide-(--cq-border-subtle) overflow-hidden rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface-raised)"
          data-relationships-list
          data-qp-anchor="fdr.07.crm.pipeline"
        >
          {visible.map((row) => (
            <li
              key={row.item.relationshipId}
              data-relationship-id={row.item.relationshipId}
              data-q-item
            >
              <RelationshipRow
                item={row.item}
                step={row.step}
                activity={row.activity}
                about={digests[row.item.relationshipId]?.about ?? null}
                photoUrl={
                  row.item.counterpart.photoUrl ??
                  digests[row.item.relationshipId]?.photoUrl ??
                  null
                }
                unread={(row.facts?.unread ?? 0) > 0}
                now={now}
                onPeek={() => setPeek(row.item)}
              />
            </li>
          ))}
        </ul>
      )}

      {paging && shown < filtered.length ? (
        <div className="flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={more}
            disabled={loading}
            className={crmButton("quiet")}
            data-show-more
          >
            {loading ? t("Loading…") : t("Show more")}
          </button>
          {moreFailed ? (
            <p role="alert" className="cq-body-sm text-(--cq-text-secondary)">
              {t("More didn't load. Try again.")}
            </p>
          ) : null}
        </div>
      ) : null}

      <RelationshipPeek
        item={peek}
        onClose={() => setPeek(null)}
        side={side}
        now={now}
        step={peekRow?.step}
        activity={peekRow?.activity}
        scores={
          scores === undefined || peek === null
            ? undefined
            : (scoreOf(scores, peek) ?? UNKNOWN_SCORES)
        }
        fit={
          fits === undefined ||
          peek === null ||
          peek.counterpart.kind !== "COMPANY" ||
          !(peek.counterpart.id in fits)
            ? undefined
            : (fits[peek.counterpart.id] ?? null)
        }
      />
    </div>
  );
}

function RelationshipRow({
  item,
  step,
  activity,
  about,
  photoUrl,
  unread,
  now,
  onPeek,
}: {
  readonly item: RelationshipSummaryDto;
  readonly step: NextStep;
  readonly activity: string;
  readonly about: string | null;
  readonly photoUrl: string | null;
  readonly unread: boolean;
  readonly now: number;
  readonly onPeek: () => void;
}) {
  const t = useT();
  const href = relationshipHref(item);
  const name = item.counterpart.name;
  const own = isOwnStep(step);
  const next = step.label ?? (step.why === "" ? null : step.why);
  const label =
    item.state === "INTEREST_EXPRESSED" ? "Awaiting reply" : undefined;
  return (
    <article
      aria-labelledby={`relationship-${item.relationshipId}`}
      className="relative grid min-h-16 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 transition-colors duration-(--cq-motion-fast) hover:bg-(--cq-surface-subtle) lg:grid-cols-[auto_minmax(0,1.4fr)_auto_minmax(0,1fr)_auto] lg:gap-4"
      data-relationship-card={item.state}
    >
      {item.counterpart.kind === "COMPANY" ? (
        <EntityAvatar
          kind="company"
          name={name}
          companyId={item.counterpart.id}
          src={photoUrl}
          size={28}
          decorative
        />
      ) : (
        <EntityAvatar
          kind="investor"
          name={name}
          investorOrganisationId={item.counterpart.id}
          src={photoUrl ?? undefined}
          size={28}
          decorative
        />
      )}
      <div className="min-w-0">
        <h2
          id={`relationship-${item.relationshipId}`}
          className="flex min-w-0 items-center gap-2 font-semibold text-(--cq-text-primary)"
        >
          {unread ? (
            // The next step says it in words; the dot only echoes it.
            <span
              aria-hidden="true"
              className="size-2 shrink-0 rounded-full bg-(--cq-accent)"
            />
          ) : null}
          {/* The whole row opens the peek; a modified click, the record. */}
          <Link
            href={href}
            onClick={(event) => peekClick(event, onPeek)}
            className="truncate after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-(--cq-focus-ring)"
          >
            {name}
          </Link>
        </h2>
        <p className="truncate text-[13px] text-(--cq-text-secondary)">
          {about === null ? (next === null ? null : t(next)) : t(about)}
        </p>
      </div>
      <div className="hidden lg:block">
        <StateTag state={item.state} label={label} />
      </div>
      <p
        className={cx(
          "hidden items-center gap-1.5 text-[13px] lg:flex",
          own
            ? "font-semibold text-(--cq-accent)"
            : "text-(--cq-text-secondary)",
        )}
        data-next-step-text={own ? "yours" : "theirs"}
      >
        {own ? <Flag size={14} aria-hidden="true" /> : null}
        {next === null ? null : t(next)}
      </p>
      <div className="flex items-center justify-end gap-2">
        <span className="lg:hidden">
          <StateTag state={item.state} label={label} />
        </span>
        <time
          dateTime={activity}
          className="cq-numeric hidden text-xs text-(--cq-text-tertiary) lg:inline"
        >
          {t(since(activity, now) || "No activity")}
        </time>
      </div>
    </article>
  );
}

/**
 * A counterpart's picture by id: its photo route answers only where this
 * reader may see the name.
 */
export function CounterpartAvatar({
  item,
  size,
}: {
  readonly item: RelationshipSummaryDto;
  readonly size: number;
}) {
  const name = item.counterpart.name;
  return item.counterpart.kind === "COMPANY" ? (
    <EntityAvatar
      kind="company"
      name={name}
      companyId={item.counterpart.id}
      src={item.counterpart.photoUrl}
      size={size}
      decorative
    />
  ) : (
    <EntityAvatar
      kind="investor"
      name={name}
      investorOrganisationId={item.counterpart.id}
      src={item.counterpart.photoUrl ?? undefined}
      size={size}
      decorative
    />
  );
}
