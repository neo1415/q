"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";

import {
  isActiveMatchState,
  isMatchedRelationshipState,
  type RelationshipSummaryDto,
} from "@capital-q/contracts";
import { cx } from "@capital-q/ui";
import {
  ArrowUpRight,
  CalendarDays,
  ICON_SIZE,
  MessageSquare,
  Search,
} from "@capital-q/ui/icons";

import { useGlobalQ } from "@/components/app-shell/global-q";
import { useDockAvoid } from "@/features/q-dock";
import { initials } from "@/features/investors/investor-labels";

import type { RelationshipDigest } from "./relationship-data";
import { StatusPill, type StatusTone } from "./status-pill";
import {
  formatRelationshipDate,
  relationshipHref,
  STATE_WORDS,
} from "./relationship-words";

/**
 * The Relationships list (founder design 2026-09-28): search, filters by
 * where each stands with their counts, a sort, and one card per
 * relationship. A card says who the counterpart is, where it stands and
 * since when, the last message, and four tiles that each open the real
 * thing: the conversation, calls, reminders, and Q. A tile whose thing
 * does not exist yet offers the action that creates it; one that cannot
 * exist yet (messages before connecting) says so and links nowhere.
 * Filters are the relationship's own states plus "Follow-up due" (a
 * reminder on it came due); nothing is scored or ranked.
 */

type Filter =
  | "ALL"
  | "AWAITING"
  | "CONNECTED"
  | "FOLLOW_UP"
  | "DISCOVERED"
  | "DECLINED"
  // relationship-state.v2 (2026-10-02): where a match went after a call.
  | "MEETING_HELD"
  | "IN_DILIGENCE"
  | "PAUSED"
  | "PASSED"
  | "INVESTED";
type Sort = "RECENT" | "NAME";

const FILTER_WORDS: Readonly<Record<Filter, string>> = {
  ALL: "All",
  AWAITING: "Awaiting reply",
  CONNECTED: "Connected",
  FOLLOW_UP: "Follow-up due",
  DISCOVERED: "Discovered",
  DECLINED: "Not taken forward",
  MEETING_HELD: STATE_WORDS.MEETING_HELD,
  IN_DILIGENCE: STATE_WORDS.IN_DILIGENCE,
  PAUSED: STATE_WORDS.PAUSED,
  PASSED: STATE_WORDS.PASSED,
  INVESTED: STATE_WORDS.INVESTED,
};

function matches(
  filter: Filter,
  item: RelationshipSummaryDto,
  digest: RelationshipDigest | undefined,
): boolean {
  switch (filter) {
    case "ALL":
      return true;
    case "AWAITING":
      return item.state === "INTEREST_EXPRESSED";
    case "CONNECTED":
      return item.state === "CONNECTED";
    case "FOLLOW_UP":
      return digest?.followUpDue === true;
    case "DISCOVERED":
      return item.state === "DISCOVERED";
    case "DECLINED":
    case "MEETING_HELD":
    case "IN_DILIGENCE":
    case "PAUSED":
    case "PASSED":
    case "INVESTED":
      return item.state === filter;
  }
}

/** The status pill's words, from the side reading it. */
function statusWords(
  item: RelationshipSummaryDto,
  digest: RelationshipDigest | undefined,
): string {
  if (digest?.followUpDue === true) return "Follow-up due";
  if (item.nextStep === "ANSWER_INTEREST") return "Needs your answer";
  if (item.nextStep === "AWAIT_ANSWER") return "Awaiting reply";
  return STATE_WORDS[item.state];
}

function statusTone(
  item: RelationshipSummaryDto,
  digest: RelationshipDigest | undefined,
): StatusTone {
  if (digest?.followUpDue === true) return "attention";
  // A live or completed match reads positive; a pause or a pass is
  // neutral, never an alarm (Pass is neutral, not red).
  if (isActiveMatchState(item.state) || item.state === "INVESTED") {
    return "positive";
  }
  if (item.state === "INTEREST_EXPRESSED") return "waiting";
  return "neutral";
}

function lastActivity(
  item: RelationshipSummaryDto,
  digest: RelationshipDigest | undefined,
): number {
  const said = digest?.messages?.last?.sentAt;
  return Math.max(
    Date.parse(item.stateSince),
    said === undefined ? 0 : Date.parse(said),
  );
}

export function RelationshipsBoard({
  items,
  digests,
  unread,
}: {
  readonly items: readonly RelationshipSummaryDto[];
  readonly digests: Readonly<Record<string, RelationshipDigest>>;
  /** R34: unread chat messages per relationship id. */
  readonly unread: Readonly<Record<string, number>>;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("ALL");
  const [sort, setSort] = useState<Sort>("RECENT");

  const counts = useMemo(() => {
    const out = new Map<Filter, number>();
    for (const key of Object.keys(FILTER_WORDS) as Filter[]) {
      out.set(
        key,
        items.filter((item) => matches(key, item, digests[item.relationshipId]))
          .length,
      );
    }
    return out;
  }, [items, digests]);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items
      .filter((item) => matches(filter, item, digests[item.relationshipId]))
      .filter(
        (item) =>
          needle.length === 0 ||
          item.counterpart.name.toLowerCase().includes(needle) ||
          (digests[item.relationshipId]?.about ?? "")
            .toLowerCase()
            .includes(needle),
      )
      .toSorted((a, b) =>
        sort === "NAME"
          ? a.counterpart.name.localeCompare(b.counterpart.name)
          : lastActivity(b, digests[b.relationshipId]) -
            lastActivity(a, digests[a.relationshipId]),
      );
  }, [items, digests, filter, query, sort]);

  // Filters with nothing in them are not offered, except the four the
  // design names, which read as zero honestly.
  const filters = (Object.keys(FILTER_WORDS) as Filter[]).filter(
    (key) =>
      key === "ALL" ||
      key === "AWAITING" ||
      key === "CONNECTED" ||
      key === "FOLLOW_UP" ||
      (counts.get(key) ?? 0) > 0,
  );

  return (
    <div className="flex flex-col gap-5" data-relationships-board>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <label className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-md border border-(--cq-border-subtle) bg-(--cq-surface) px-3 focus-within:outline-2 focus-within:outline-(--cq-focus-ring)">
          <Search
            size={ICON_SIZE.compact}
            aria-hidden="true"
            className="text-(--cq-text-tertiary)"
          />
          <span className="sr-only">Search relationships</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by name"
            className="cq-body min-w-0 flex-1 bg-transparent text-(--cq-text-primary) outline-none"
          />
        </label>
        <label className="flex items-center gap-2">
          <span className="cq-body-sm text-(--cq-text-secondary)">Sort</span>
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value as Sort)}
            className="cq-body-sm min-h-11 rounded-md border border-(--cq-border-subtle) bg-(--cq-surface) px-3 text-(--cq-text-primary)"
          >
            <option value="RECENT">Recent activity</option>
            <option value="NAME">Name</option>
          </select>
        </label>
      </div>

      <div
        role="group"
        aria-label="Filter by status"
        className="flex flex-wrap gap-2"
      >
        {filters.map((key) => (
          <button
            key={key}
            type="button"
            aria-pressed={filter === key}
            onClick={() => setFilter(key)}
            className={cx(
              "cq-body-sm inline-flex min-h-11 items-center gap-2 rounded-full border px-4",
              filter === key
                ? "border-(--cq-text-primary) bg-(--cq-text-primary) text-(--cq-surface)"
                : "border-(--cq-border-subtle) bg-(--cq-surface) text-(--cq-text-secondary) hover:text-(--cq-text-primary)",
            )}
            data-filter={key}
          >
            {FILTER_WORDS[key]}{" "}
            <span className="cq-numeric">{counts.get(key) ?? 0}</span>
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p
          className="cq-body text-(--cq-text-secondary)"
          role="status"
          data-state="filtered-empty"
        >
          {query.trim().length > 0
            ? `Nothing matches “${query.trim()}”.`
            : `No relationships are ${FILTER_WORDS[filter].toLowerCase()} right now.`}
        </p>
      ) : (
        <ul aria-label="Relationships" className="flex flex-col gap-4">
          {shown.map((item) => (
            <li
              key={item.relationshipId}
              data-relationship-id={item.relationshipId}
            >
              <RelationshipCard
                item={item}
                digest={digests[item.relationshipId]}
                unread={unread[item.relationshipId] ?? 0}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RelationshipCard({
  item,
  digest,
  unread,
}: {
  readonly item: RelationshipSummaryDto;
  readonly digest: RelationshipDigest | undefined;
  readonly unread: number;
}) {
  const { askAbout } = useGlobalQ();
  // The card's actions are never under the Q dock (ADR 0017 F1).
  const actions = useRef<HTMLUListElement>(null);
  useDockAvoid(actions);
  const href = relationshipHref(item);
  const name = item.counterpart.name;
  // The match outlives CONNECTED: the thread and calls stay open after it.
  const connected = isMatchedRelationshipState(item.state);
  const messages = digest?.messages ?? null;
  const last = messages?.last ?? null;
  const ask = () =>
    askAbout(
      `Where does our relationship with ${name} stand, what has happened so far, and what comes next?`,
    );

  return (
    <article
      className="cq-glow-card flex flex-col gap-4 rounded-2xl p-4 sm:p-5"
      aria-labelledby={`relationship-${item.relationshipId}`}
      data-relationship-card={item.state}
    >
      <div className="flex min-w-0 items-start gap-4">
        {digest?.photoUrl === null || digest?.photoUrl === undefined ? (
          <span
            aria-hidden="true"
            className="inline-flex size-12 shrink-0 items-center justify-center rounded-xl border border-(--cq-border-subtle) bg-(--cq-surface) font-semibold text-(--cq-text-secondary)"
          >
            {initials(name)}
          </span>
        ) : (
          // A short-lived signed URL; next/image would cache it past expiry.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={digest.photoUrl}
            alt=""
            width={48}
            height={48}
            className="size-12 shrink-0 rounded-xl object-cover"
          />
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2
              id={`relationship-${item.relationshipId}`}
              className="cq-body min-w-0 font-semibold text-(--cq-text-primary)"
            >
              <Link
                href={href}
                className="inline-flex items-center gap-1 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring)"
              >
                {name}
                <ArrowUpRight size={ICON_SIZE.compact} aria-hidden="true" />
              </Link>
            </h2>
            <StatusPill tone={statusTone(item, digest)}>
              {statusWords(item, digest)}
            </StatusPill>
          </div>
          {digest?.about === null || digest?.about === undefined ? null : (
            <p className="cq-body-sm line-clamp-2 text-(--cq-text-secondary)">
              {digest.about}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {(digest?.chips ?? []).map((chip) => (
              <span
                key={chip}
                className="cq-caption rounded-full bg-(--cq-surface-subtle) px-2.5 py-0.5 text-(--cq-text-secondary)"
              >
                {chip}
              </span>
            ))}
            <span className="cq-caption cq-numeric text-(--cq-text-tertiary)">
              {STATE_WORDS[item.state]} since{" "}
              {formatRelationshipDate(item.stateSince)}
            </span>
          </div>
        </div>
      </div>

      {last === null ? null : (
        <Link
          href={`${href}/messages`}
          className="flex min-h-11 min-w-0 items-center gap-3 rounded-lg bg-(--cq-surface-subtle) px-3 py-2 hover:bg-(--cq-surface) focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring)"
          data-last-message
        >
          <MessageSquare
            size={ICON_SIZE.compact}
            aria-hidden="true"
            className="shrink-0 text-(--cq-text-tertiary)"
          />
          <span className="cq-body-sm min-w-0 flex-1 truncate text-(--cq-text-secondary)">
            <span className="text-(--cq-text-primary)">
              {last.mine ? "You" : last.senderName}:
            </span>{" "}
            {last.text}
          </span>
          {unread > 0 ? (
            <span className="cq-caption cq-numeric shrink-0 rounded-full bg-(--cq-accent-soft) px-2 py-0.5 text-(--cq-text-primary)">
              {unread === 1 ? "1 new" : `${unread > 99 ? "99+" : unread} new`}
            </span>
          ) : null}
          <time
            dateTime={last.sentAt}
            className="cq-caption cq-numeric shrink-0 text-(--cq-text-tertiary)"
          >
            {formatRelationshipDate(last.sentAt)}
          </time>
        </Link>
      )}

      <ul
        ref={actions}
        className="grid grid-cols-2 gap-2"
        aria-label="At a glance"
      >
        <li>
          <Tile
            icon={<MessageSquare size={ICON_SIZE.compact} aria-hidden="true" />}
            label="Messages"
            value={
              messages === null
                ? connected
                  ? "Open the conversation"
                  : "Open once connected"
                : messages.count === 0
                  ? "Say hello"
                  : `${messages.count}${messages.more ? "+" : ""}${last === null ? "" : ` · ${formatRelationshipDate(last.sentAt)}`}`
            }
            href={connected ? `${href}/messages` : undefined}
          />
        </li>
        <li>
          <Tile
            icon={<CalendarDays size={ICON_SIZE.compact} aria-hidden="true" />}
            label="Calls"
            value={
              digest?.nextCall === null || digest?.nextCall === undefined
                ? connected
                  ? "Book a call"
                  : "After you connect"
                : `Next ${formatRelationshipDate(digest.nextCall.startsAt)}`
            }
            href={connected ? `${href}#calls` : undefined}
          />
        </li>
      </ul>
      {/*
        Two tiles, the two next steps (re-capture 2026-10-03: four tiles
        per card were dense on a phone). A reminder and Q are quiet links.
      */}
      <div className="flex flex-wrap gap-x-4">
        <Link
          href={`${href}#reminders`}
          className="cq-body-sm inline-flex min-h-11 items-center text-(--cq-text-secondary) underline-offset-4 hover:underline"
        >
          {digest?.nextReminder === null || digest?.nextReminder === undefined
            ? "Set a reminder"
            : `Reminder ${formatRelationshipDate(digest.nextReminder.dueAt)}`}
        </Link>
        <button
          type="button"
          onClick={ask}
          className="cq-body-sm inline-flex min-h-11 items-center text-(--cq-text-secondary) underline-offset-4 hover:underline"
        >
          Ask Q about this
        </button>
      </div>
    </article>
  );
}

function Tile({
  icon,
  label,
  value,
  href,
  onClick,
}: {
  readonly icon: React.ReactNode;
  readonly label: string;
  readonly value: string;
  readonly href?: string | undefined;
  readonly onClick?: (() => void) | undefined;
}) {
  const body = (
    <>
      <span className="flex items-center gap-2 text-(--cq-text-tertiary)">
        {icon}
        <span className="cq-caption">{label}</span>
      </span>
      <span className="cq-body-sm truncate text-(--cq-text-primary)">
        {value}
      </span>
    </>
  );
  const className =
    "flex h-full min-h-14 w-full min-w-0 flex-col items-start justify-center gap-1 rounded-md px-2 py-2 text-left";
  const interactive =
    "hover:bg-(--cq-surface-subtle) focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring)";
  if (href !== undefined) {
    return (
      <Link href={href} className={cx(className, interactive)}>
        {body}
      </Link>
    );
  }
  if (onClick !== undefined) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cx(className, interactive)}
      >
        {body}
      </button>
    );
  }
  return <div className={className}>{body}</div>;
}
