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
  X,
} from "@capital-q/ui/icons";

import { EntityAvatar } from "@/features/entity/entity-avatar";
import { useQControl, useQControlGroup } from "@/features/q/control/q-control";
import { RelationshipFitChips } from "@/features/fit/relationship-fit-chips";
import {
  dismissReminderAction,
  markNoticesReadAction,
} from "@/features/schedule/schedule-actions";

import type { RelationshipDigest } from "./relationship-data";
import { relationshipHref, STATE_WORDS } from "./relationship-words";
import { moreRelationshipDigestsAction } from "./relationships-actions";
import {
  lastActivityAt,
  listOrder,
  nextStepFor,
  pageAfter,
  since,
  stageTone,
  type ListSide,
  type NeedsYouCard,
  type NextStep,
  type RowFacts,
} from "./relationships-view";
import { StatusPill, type StatusTone } from "./status-pill";

/**
 * The Relationships list (founder critique 2026-10-04): search first, then
 * where each stands as tabs with counts, then "Needs you" as one card per
 * relationship and action, then one row per relationship with its
 * counterpart, its stage, the time since anything last happened, and the
 * ONE next step as a button. Rows page by cursor; nothing is ranked.
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

const ICONS = {
  upload: Upload,
  file: FileText,
  reply: MessageSquare,
  calendar: CalendarDays,
  answer: null,
} as const;

function factsOf(
  digest: RelationshipDigest | undefined,
  unread: number,
): RowFacts | undefined {
  if (digest === undefined) {
    return unread > 0
      ? {
          unread,
          followUpDue: false,
          nextCallAt: null,
          lastMessageAt: null,
          diligence: null,
        }
      : undefined;
  }
  return {
    unread,
    followUpDue: digest.followUpDue,
    nextCallAt: digest.nextCall?.startsAt ?? null,
    lastMessageAt: digest.messages?.last?.sentAt ?? null,
    diligence: digest.diligence ?? null,
  };
}

export function RelationshipsBoard({
  side,
  items,
  digests: initialDigests,
  unread,
  needsYou,
  firstCursor,
  now,
  fits,
}: {
  readonly side: ListSide;
  /**
   * Fit with the investor's own mandate by company id (ADR 0052; B3).
   * Absent: no fit is shown. A null entry: no mandate to fit against.
   */
  readonly fits?: Readonly<Record<string, FitProfileDto | null>> | undefined;
  readonly items: readonly RelationshipSummaryDto[];
  readonly digests: Readonly<Record<string, RelationshipDigest>>;
  /** R34: unread chat messages per relationship id. */
  readonly unread: Readonly<Record<string, number>>;
  readonly needsYou: readonly NeedsYouCard[];
  /** The cursor after the first page; null when it is the whole list. */
  readonly firstCursor: string | null;
  /** When the page was read, so server and browser say the same "2h". */
  readonly now: number;
}) {
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
      return "DONE";
    },
  });
  const [digests, setDigests] = useState(initialDigests);
  const [cursor, setCursor] = useState(firstCursor);
  const ordered = useMemo(() => items.toSorted(listOrder), [items]);
  const [shown, setShown] = useState(
    () => pageAfter(ordered, null).items.length,
  );
  const [loading, startLoading] = useTransition();
  const [moreFailed, setMoreFailed] = useState(false);

  const rows = useMemo(
    () =>
      ordered.map((item) => {
        const facts = factsOf(
          digests[item.relationshipId],
          unread[item.relationshipId] ?? 0,
        );
        return {
          item,
          facts,
          step: nextStepFor(item, facts, side, now, relationshipHref(item)),
          activity: lastActivityAt(item, facts),
        };
      }),
    [ordered, digests, unread, side, now],
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
              ? row.step.urgent
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
          ? row.step.urgent
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

  const more = () => {
    if (cursor === null) return;
    setMoreFailed(false);
    startLoading(async () => {
      const page = await moreRelationshipDigestsAction(cursor);
      if (!page.ok) {
        setMoreFailed(true);
        return;
      }
      setDigests((current) => ({ ...current, ...page.digests }));
      setShown((count) => count + page.ids.length);
      setCursor(page.next);
    });
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
        <span className="sr-only">Search relationships</span>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={
            side === "INVESTOR" ? "Search companies" : "Search investors"
          }
          className="cq-body min-w-0 flex-1 bg-transparent text-(--cq-text-primary) outline-none placeholder:text-(--cq-text-tertiary)"
          data-relationships-search
        />
      </label>

      <div
        ref={filterRef}
        role="group"
        aria-label="Show"
        className="-mx-(--cq-page-gutter) flex gap-1 overflow-x-auto border-b border-(--cq-border-subtle) px-(--cq-page-gutter) [scrollbar-width:none]"
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
              {FILTER_WORDS[key]}{" "}
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

      {filter === "ALL" && needle.length === 0 && needsYou.length > 0 ? (
        <NeedsYouStrip cards={needsYou} now={now} />
      ) : null}

      {visible.length === 0 ? (
        <p
          className="cq-body text-(--cq-text-secondary)"
          role="status"
          data-state="filtered-empty"
        >
          {needle.length > 0
            ? `Nothing matches “${query.trim()}”.`
            : filter === "NEEDS_YOU"
              ? "Nothing needs you right now."
              : `None ${FILTER_WORDS[filter].toLowerCase()} right now.`}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          <div
            aria-hidden="true"
            className="cq-caption hidden grid-cols-[40px_minmax(0,1fr)_150px_96px_190px] gap-3 px-4 text-(--cq-text-tertiary) lg:grid"
          >
            <span />
            <span>Name</span>
            <span>Stage</span>
            <span className="text-right">Last activity</span>
            <span className="text-right">Next step</span>
          </div>
          <ul
            aria-label="Relationships"
            className="flex flex-col gap-2"
            data-relationships-list
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

      {paging && cursor !== null && shown < filtered.length ? (
        <div className="flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={more}
            disabled={loading}
            className={buttonClassName("quiet")}
            data-show-more
          >
            {loading ? "Loading…" : "Show more"}
          </button>
          {moreFailed ? (
            <p role="alert" className="cq-body-sm text-(--cq-text-secondary)">
              More didn&apos;t load. Try again.
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
}: {
  readonly item: RelationshipSummaryDto;
  readonly fit?: FitProfileDto | null | undefined;
  readonly step: NextStep;
  readonly activity: string;
  readonly about: string | null;
  readonly photoUrl: string | null;
  readonly unread: boolean;
  readonly now: number;
}) {
  const href = relationshipHref(item);
  const name = item.counterpart.name;
  const Icon = step.icon === null ? null : ICONS[step.icon];
  const pill = (
    <StatusPill tone={TONE[stageTone(item.state)]}>
      {STATE_WORDS[item.state]}
    </StatusPill>
  );
  const when = (
    <time
      dateTime={activity}
      className="cq-caption cq-numeric text-(--cq-text-tertiary)"
    >
      {since(activity, now)}
    </time>
  );
  const quiet = step.label === null && step.why === "";
  return (
    <article
      aria-labelledby={`relationship-${item.relationshipId}`}
      className="relative grid grid-cols-[40px_minmax(0,1fr)] items-center gap-x-3 gap-y-1 rounded-xl border border-(--cq-border-subtle) bg-(--cq-surface-raised) p-3.5 shadow-(--cq-shadow-xs) lg:grid-cols-[40px_minmax(0,1fr)_150px_96px_190px] lg:px-4 lg:py-3"
      data-relationship-card={item.state}
    >
      {item.counterpart.kind === "COMPANY" ? (
        <EntityAvatar
          kind="company"
          name={name}
          companyId={item.counterpart.id}
          src={photoUrl ?? undefined}
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
            className="truncate after:absolute after:inset-0 after:rounded-xl after:content-[''] focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-(--cq-focus-ring)"
          >
            {name}
          </Link>
        </h2>
        {about === null ? null : (
          <p className="cq-body-sm hidden truncate text-(--cq-text-secondary) lg:block">
            {about}
          </p>
        )}
        {fit === undefined ? null : <RelationshipFitChips profile={fit} />}
        <div className="flex items-center gap-2 lg:hidden">
          {pill}
          {when}
        </div>
      </div>
      <div className="hidden lg:block">{pill}</div>
      <div className="hidden text-right lg:block">{when}</div>
      <div
        className={cx(
          "col-span-2 flex items-center justify-between gap-3 lg:col-span-1 lg:justify-end",
          quiet
            ? "hidden lg:flex"
            : "mt-2 border-t border-(--cq-border-subtle) pt-2.5 lg:mt-0 lg:border-0 lg:pt-0",
        )}
      >
        <span className="cq-body-sm min-w-0 truncate text-(--cq-text-secondary) lg:hidden">
          {step.why}
        </span>
        {step.label === null || step.href === null ? (
          <span className="cq-body-sm hidden text-(--cq-text-tertiary) lg:inline">
            {step.why}
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
            {step.label}
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
function NeedsYouStrip({
  cards,
  now,
}: {
  readonly cards: readonly NeedsYouCard[];
  readonly now: number;
}) {
  const router = useRouter();
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const [all, setAll] = useState(false);
  const [, startClearing] = useTransition();
  const left = cards.filter((card) => !gone.has(card.key));
  if (left.length === 0) return null;
  const shown = all ? left : left.slice(0, 3);

  const clear = (card: NeedsYouCard) => {
    setGone((current) => new Set([...current, card.key]));
    startClearing(async () => {
      if (card.noticeIds.length > 0) {
        await markNoticesReadAction([...card.noticeIds]);
      }
      if (card.reminderId !== null) {
        await dismissReminderAction(card.reminderId);
      }
    });
  };

  return (
    <section
      aria-labelledby="needs-you"
      className="flex flex-col gap-2.5"
      data-needs-you
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="needs-you" className="cq-title-sm text-(--cq-text-primary)">
          Needs you
        </h2>
        {left.length > 3 ? (
          <button
            type="button"
            onClick={() => setAll((open) => !open)}
            className="cq-body-sm inline-flex min-h-11 items-center text-(--cq-text-secondary) hover:text-(--cq-text-primary)"
            aria-expanded={all}
          >
            {all ? "Show fewer" : `See all ${String(left.length)}`}
          </button>
        ) : null}
      </div>
      <ul
        className={cx(
          "-mx-(--cq-page-gutter) grid snap-x snap-mandatory gap-2.5 overflow-x-auto px-(--cq-page-gutter) pb-1 [scrollbar-width:none] md:mx-0 md:grid-flow-row md:grid-cols-3 md:overflow-visible md:px-0",
          all ? "grid-flow-row" : "auto-cols-[82%] grid-flow-col",
        )}
      >
        {shown.map((card, index) => {
          const relationship = card.relationship;
          return (
            <li key={card.key} className="snap-start">
              <article
                aria-label={card.title}
                className="relative flex h-full flex-col gap-3 rounded-xl border border-(--cq-border-subtle) bg-(--cq-surface-raised) p-3.5 shadow-(--cq-shadow-xs)"
                data-needs-you-card
              >
                <div className="flex min-w-0 items-center gap-2.5 pr-9">
                  {relationship === null ? null : (
                    <CounterpartAvatar item={relationship} size={32} />
                  )}
                  <span className="flex min-w-0 flex-col">
                    {relationship === null ? null : (
                      <span className="cq-body-sm truncate font-semibold text-(--cq-text-primary)">
                        {relationship.counterpart.name}
                      </span>
                    )}
                    <span className="cq-caption cq-numeric text-(--cq-text-tertiary)">
                      {card.count > 1
                        ? `${String(card.count)} updates · ${since(card.latestAt, now)}`
                        : since(card.latestAt, now)}
                    </span>
                  </span>
                </div>
                <p className="cq-body line-clamp-2 font-medium text-(--cq-text-primary)">
                  {card.title}
                </p>
                <div className="mt-auto">
                  {card.action.href === null ? (
                    <button
                      type="button"
                      onClick={() => clear(card)}
                      className={buttonClassName("secondary", "compact")}
                    >
                      {card.action.label}
                    </button>
                  ) : (
                    <Link
                      href={card.action.href}
                      onClick={(event) => {
                        event.preventDefault();
                        clear(card);
                        router.push(card.action.href ?? "/relationships");
                      }}
                      className={buttonClassName(
                        index === 0 ? "primary" : "secondary",
                        "compact",
                      )}
                    >
                      {card.action.label === "Upload & share" ? (
                        <Upload size={ICON_SIZE.compact} aria-hidden="true" />
                      ) : null}
                      {card.action.label}
                    </Link>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => clear(card)}
                  aria-label={`Dismiss ${card.title}`}
                  className="absolute top-1 right-1 inline-flex size-11 items-center justify-center rounded-md text-(--cq-text-tertiary) hover:text-(--cq-text-primary)"
                >
                  <X size={ICON_SIZE.compact} aria-hidden="true" />
                </button>
              </article>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function CounterpartAvatar({
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
      src={item.counterpart.photoUrl ?? undefined}
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
