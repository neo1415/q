"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";

import type {
  FitProfileDto,
  RelationshipSummaryDto,
} from "@capital-q/contracts";
import { buttonClassName } from "@capital-q/ui/button";
import { cx } from "@capital-q/ui";
import {
  CalendarDays,
  FileText,
  ICON_SIZE,
  MessageSquare,
  Search,
  Upload,
} from "@capital-q/ui/icons";

import { EntityAvatar } from "@/features/entity/entity-avatar";
import { effectShown } from "@/features/q/control/perform";
import { useQControl, useQControlGroup } from "@/features/q/control/q-control";
import { RelationshipFitLine } from "@/features/fit/relationship-fit-chips";

import { ScoreFigure, ScoreLine, UnicornFigure } from "./pipeline-score-figure";
import {
  hasUnicornScores,
  listOrdered,
  scoreOf,
  UNKNOWN_SCORES,
  type ListSort,
  type PipelineScores,
} from "./pipeline-scores";
import type { RelationshipDigest } from "./relationship-data";
import { relationshipHref, STATE_WORDS } from "./relationship-words";
import { moreRelationshipDigestsAction } from "./relationships-actions";
import {
  isOwnStep,
  lastActivityAt,
  nextStepFor,
  PAGE_SIZE,
  rowFacts,
  since,
  stageTone,
  type CommitmentFact,
  type ListSide,
  type NextStep,
} from "./relationships-view";
import { StatusPill, type StatusTone } from "./status-pill";
import { useT } from "@/features/i18n/language";

/**
 * The Relationships list (founder critique 2026-10-04): search first, then
 * where each stands as tabs with counts, then one row per relationship with its
 * counterpart, its stage, the time since anything last happened, and the
 * ONE next step as a button. For an investor, each company's Suitability
 * and Investability sit beside it and the list is ranked by Suitability,
 * unless they chose the latest change first (owner 2026-10-17); a founder's
 * list keeps the projection's own time. Row details load a page at a time.
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

const TONE: Readonly<Record<ReturnType<typeof stageTone>, StatusTone>> = {
  positive: "positive",
  waiting: "waiting",
  accent: "attention",
  neutral: "neutral",
};

/**
 * The List's columns from tablet-landscape up. An investor's rows carry the
 * two score columns after the name (literal classes, for Tailwind).
 */
const GRID_PLAIN = "lg:grid-cols-[40px_minmax(0,1fr)_150px_96px_190px]";
const GRID_SCORED =
  "lg:grid-cols-[40px_minmax(0,1fr)_84px_84px_140px_88px_176px]";
// With Unicorn Potential (premium): a third, wider score column, whose
// words ("Insufficient evidence") wrap within it rather than squeeze.
const GRID_UNICORN =
  "lg:grid-cols-[40px_minmax(0,1fr)_76px_76px_96px_128px_80px_168px]";

const ICONS = {
  upload: Upload,
  file: FileText,
  reply: MessageSquare,
  calendar: CalendarDays,
  answer: null,
  money: null,
} as const;

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
}: {
  readonly side: ListSide;
  /**
   * Fit with the investor's own mandate by company id (ADR 0052; B3).
   * Absent: no fit is shown. A null entry: no mandate to fit against.
   */
  readonly fits?: Readonly<Record<string, FitProfileDto | null>> | undefined;
  /**
   * Suitability and Investability by company id, from the Q API (ADR 0074).
   * Absent: no score columns (a founder's list). A company missing from it
   * shows both as not known yet.
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
}) {
  const t = useT();
  const router = useRouter();

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("ALL");
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
      // DONE once the pill shows it is on, not when it was asked.
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
  const grid =
    scores === undefined ? GRID_PLAIN : unicornOn ? GRID_UNICORN : GRID_SCORED;
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

  const tabs = FILTERS.filter(
    (key) => key === "ALL" || key === "NEEDS_YOU" || (counts.get(key) ?? 0) > 0,
  );

  return (
    <div
      ref={boardRef}
      className="flex flex-col gap-5"
      data-relationships-board
    >
      <label className="flex min-h-12 items-center gap-2.5 rounded-xl border border-(--cq-border) bg-(--cq-surface-raised) px-3.5 focus-within:outline-2 focus-within:outline-(--cq-focus-ring)">
        <Search
          size={ICON_SIZE.regular}
          aria-hidden="true"
          className="shrink-0 text-(--cq-text-tertiary)"
        />
        <span className="sr-only">{t("Search relationships")}</span>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={
            side === "INVESTOR" ? t("Search companies") : t("Search investors")
          }
          className="cq-body min-w-0 flex-1 bg-transparent text-(--cq-text-primary) outline-none placeholder:text-(--cq-text-tertiary)"
          data-relationships-search
        />
      </label>

      {scores === undefined ? null : (
        <label className="cq-body-sm flex flex-wrap items-center gap-2 text-(--cq-text-secondary)">
          {t("Sort relationships")}
          <select
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
            className="cq-body-sm min-h-11 border border-(--cq-border) bg-(--cq-surface-raised) px-3 pe-8 text-(--cq-text-primary) focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring)"
            data-relationships-sort
          >
            <option value="suitability">
              {t("Suitability, highest first")}
            </option>
            {unicornOn ? (
              <option value="unicorn">
                {t("Unicorn Potential, highest first")}
              </option>
            ) : null}
            <option value="recent">{t("Latest state change")}</option>
          </select>
        </label>
      )}

      <div
        ref={filterRef}
        role="group"
        aria-label={t("Show")}
        className="relative -mx-(--cq-page-gutter) flex gap-1 overflow-x-auto border-b border-(--cq-border-subtle) px-(--cq-page-gutter) [scrollbar-width:none]"
      >
        {tabs.map((key) => {
          const count = counts.get(key) ?? 0;
          return (
            <button
              key={key}
              type="button"
              aria-pressed={filter === key}
              onClick={() => setFilter(key)}
              className={cx(
                "cq-body-sm -mb-px inline-flex min-h-11 shrink-0 items-center gap-1.5 border-b-2 px-2.5 whitespace-nowrap",
                filter === key
                  ? "border-(--cq-text-primary) font-medium text-(--cq-text-primary)"
                  : "border-transparent text-(--cq-text-secondary) hover:text-(--cq-text-primary)",
              )}
              data-filter={key}
            >
              {t(FILTER_WORDS[key])}{" "}
              <span
                className={cx(
                  "cq-caption cq-numeric rounded-full px-1.5",
                  key === "NEEDS_YOU" && count > 0
                    ? "bg-(--cq-accent) text-(--cq-text-inverse)"
                    : "bg-(--cq-surface-subtle)",
                )}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {visible.length === 0 ? (
        <p
          className="cq-body text-(--cq-text-secondary)"
          role="status"
          data-state="filtered-empty"
        >
          {needle.length > 0
            ? t(`Nothing matches “${query.trim()}”.`)
            : filter === "NEEDS_YOU"
              ? t("Nothing needs you right now.")
              : t(`None ${FILTER_WORDS[filter].toLowerCase()} right now.`)}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          <div
            aria-hidden="true"
            className={cx(
              "cq-caption hidden gap-3 px-4 text-(--cq-text-tertiary) lg:grid",
              grid,
            )}
          >
            <span />
            <span>{t("Name")}</span>
            {scores === undefined ? null : (
              <>
                <span>{t("Suitability")}</span>
                <span>{t("Investability")}</span>
                {unicornOn ? <span>{t("Unicorn Potential")}</span> : null}
              </>
            )}
            <span>{t("Stage")}</span>
            <span className="text-end">{t("Last activity")}</span>
            <span className="text-end">{t("Next step")}</span>
          </div>
          {/* One surface with hairline rows, not a card per relationship
              (redesign 2026-10-15). */}
          <ul
            aria-label={t("Relationships")}
            className="flex flex-col divide-y divide-(--cq-border-subtle) overflow-hidden rounded-xl border border-(--cq-border-subtle) bg-(--cq-surface-raised)"
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
                  grid={grid}
                  unicornColumn={unicornOn}
                  scores={
                    scores === undefined
                      ? undefined
                      : (scoreOf(scores, row.item) ?? UNKNOWN_SCORES)
                  }
                  fit={
                    fits === undefined ||
                    row.item.counterpart.kind !== "COMPANY" ||
                    !(row.item.counterpart.id in fits)
                      ? undefined
                      : (fits[row.item.counterpart.id] ?? null)
                  }
                />
              </li>
            ))}
          </ul>
        </div>
      )}

      {paging && shown < filtered.length ? (
        <div className="flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={more}
            disabled={loading}
            className={buttonClassName("quiet")}
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
  fit,
  scores,
  grid,
  unicornColumn,
}: {
  /** The list's column template, so rows align with its header. */
  readonly grid: string;
  /** The list shows Unicorn Potential (premium): this row has its column. */
  readonly unicornColumn: boolean;
  readonly item: RelationshipSummaryDto;
  readonly fit?: FitProfileDto | null | undefined;
  /** Undefined: no score columns on this list. */
  readonly scores?: PipelineScores | undefined;
  readonly step: NextStep;
  readonly activity: string;
  readonly about: string | null;
  readonly photoUrl: string | null;
  readonly unread: boolean;
  readonly now: number;
}) {
  const t = useT();

  const href = relationshipHref(item);
  const name = item.counterpart.name;
  const Icon = step.icon === null ? null : ICONS[step.icon];
  const pill = (
    <StatusPill tone={TONE[stageTone(item.state)]}>
      {t(STATE_WORDS[item.state])}
    </StatusPill>
  );
  const when = (
    <time
      dateTime={activity}
      className="cq-caption cq-numeric text-(--cq-text-tertiary)"
    >
      {t(since(activity, now))}
    </time>
  );
  const quiet = step.label === null && step.why === "";
  return (
    <article
      aria-labelledby={`relationship-${item.relationshipId}`}
      className={cx(
        "relative grid grid-cols-[40px_minmax(0,1fr)] items-center gap-x-3 gap-y-1 p-3.5 transition-colors duration-(--cq-motion-fast) hover:bg-(--cq-surface-subtle) lg:px-4 lg:py-3",
        grid,
      )}
      data-relationship-card={item.state}
    >
      {item.counterpart.kind === "COMPANY" ? (
        <EntityAvatar
          kind="company"
          name={name}
          companyId={item.counterpart.id}
          src={photoUrl}
          size={40}
          decorative
        />
      ) : (
        <EntityAvatar
          kind="investor"
          name={name}
          investorOrganisationId={item.counterpart.id}
          src={photoUrl ?? undefined}
          size={40}
          decorative
        />
      )}
      <div className="flex min-w-0 flex-col gap-0.5">
        <h2
          id={`relationship-${item.relationshipId}`}
          className="cq-body flex min-w-0 items-center gap-2 font-semibold text-(--cq-text-primary)"
        >
          {unread ? (
            <span
              // The why line says it in words; the dot only echoes it.
              aria-hidden="true"
              className="size-2 shrink-0 rounded-full bg-(--cq-accent)"
            />
          ) : null}
          {/* The whole row opens the relationship; the button stays its own. */}
          <Link
            href={href}
            className="truncate after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-(--cq-focus-ring)"
          >
            {name}
          </Link>
        </h2>
        {about === null ? null : (
          <p className="cq-body-sm hidden truncate text-(--cq-text-secondary) lg:block">
            {t(about)}
          </p>
        )}
        {fit === undefined ? null : <RelationshipFitLine profile={fit} />}
        {scores === undefined ? null : (
          // A phone card says both scores, labelled; from tablet-landscape
          // up they are the columns beside the name.
          <ScoreLine
            scores={scores}
            companyId={
              item.counterpart.kind === "COMPANY"
                ? item.counterpart.id
                : undefined
            }
            className="mt-0.5 lg:hidden"
          />
        )}
        <div className="flex items-center gap-2 lg:hidden">
          {pill}
          {when}
        </div>
      </div>
      {scores === undefined ? null : (
        <>
          <div className="hidden lg:block">
            <ScoreFigure
              label="Suitability"
              value={scores.suitability}
              variant="column"
            />
          </div>
          <div className="hidden lg:block">
            <ScoreFigure
              label="Investability"
              value={scores.investability}
              variant="column"
            />
          </div>
          {unicornColumn ? (
            <div className="hidden lg:block">
              {item.counterpart.kind !== "COMPANY" ? null : (
                <UnicornFigure
                  cell={
                    scores.unicorn ?? { status: "NOT_ASSESSED", score: null }
                  }
                  companyId={item.counterpart.id}
                  variant="column"
                />
              )}
            </div>
          ) : null}
        </>
      )}
      <div className="hidden lg:block">{pill}</div>
      <div className="hidden text-end lg:block">{when}</div>
      <div
        className={cx(
          "col-span-2 flex items-center justify-between gap-3 lg:col-span-1 lg:justify-end",
          quiet
            ? "hidden lg:flex"
            : "mt-2 border-t border-(--cq-border-subtle) pt-2.5 lg:mt-0 lg:border-0 lg:pt-0",
        )}
      >
        <span className="cq-body-sm min-w-0 truncate text-(--cq-text-secondary) lg:hidden">
          {t(step.why)}
        </span>
        {step.label === null || step.href === null ? (
          <span className="cq-body-sm hidden text-(--cq-text-tertiary) lg:inline">
            {t(step.why)}
          </span>
        ) : (
          <Link
            href={step.href}
            className={cx(
              buttonClassName(step.urgent ? "primary" : "secondary", "compact"),
              "relative shrink-0",
            )}
            data-next-step
          >
            {Icon === null ? null : (
              <Icon size={ICON_SIZE.compact} aria-hidden="true" />
            )}
            {t(step.label)}
          </Link>
        )}
      </div>
    </article>
  );
}

/**
 * Needs you: one card per relationship and action, newest first; three at
 * a time, the rest one tap away. Acting on a card (or dismissing it) clears
 * every notice it stands for.
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
