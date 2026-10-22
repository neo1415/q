"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import {
  ACTIVITY_KINDS,
  type ActivityItemDto,
  type ActivityPageDto,
} from "@capital-q/contracts";
import { cx } from "@capital-q/ui";
import { Avatar } from "@capital-q/ui/avatar";
import {
  Building2,
  ChevronRight,
  CircleAlert,
  ICON_SIZE,
  ICON_STROKE,
} from "@capital-q/ui/icons";
import { QMark } from "@capital-q/ui/q-mark";

import { useT } from "@/features/i18n/language";
import { accountButton, fieldClassName } from "@/features/settings/account-styles";

import { activityAction } from "./activity-actions";
import {
  KIND_WORD,
  OUTCOME_WORD,
  activityQuery,
  dayWords,
  whenWords,
  type ActivityFilters,
} from "./role-words";

export type { ActivityFilters } from "./role-words";

/**
 * The organisation's activity: who did what for it, newest first, from the
 * accountability record (GET /v1/organisation/activity). Filters by person,
 * kind and day; "Show more" follows the server's cursor and never an
 * offset. Q appears as "Q, under <name>'s approval", because Q only ever
 * acts on a person's authority. Admins and owners only: the API decides,
 * and a refusal shows as such, never as an empty feed.
 */

export type ActivityPerson = {
  readonly userId: string;
  readonly name: string;
  readonly avatarUrl?: string | null | undefined;
};

type Status = "idle" | "loading" | "more";

export function ActivityFeed({
  initial,
  people,
  filters: initialFilters = {},
  fixedMember,
  onDenied,
  review,
}: {
  /** The first page, or null when it could not be read. */
  readonly initial: ActivityPageDto | null;
  /** The team, for the person filter and avatars; empty hides that filter. */
  readonly people: readonly ActivityPerson[];
  readonly filters?: ActivityFilters | undefined;
  /** A member's own page: the feed is theirs and has no person filter. */
  readonly fixedMember?: string | undefined;
  /** The server said no on a later read (their role changed meanwhile). */
  readonly onDenied?: (() => void) | undefined;
  /** Design review only: the loading state, drawn. */
  readonly review?: { readonly loading?: boolean } | undefined;
}) {
  const t = useT();
  const [items, setItems] = useState<readonly ActivityItemDto[]>(
    initial?.items ?? [],
  );
  const [cursor, setCursor] = useState<string | null>(
    initial?.nextCursor ?? null,
  );
  const [failed, setFailed] = useState<string | null>(
    initial === null ? "Activity couldn't load. Nothing changed; try again." : null,
  );
  const [denied, setDenied] = useState(false);
  const [filters, setFilters] = useState<ActivityFilters>(() => ({
    ...initialFilters,
    ...(fixedMember === undefined ? {} : { member: fixedMember }),
  }));
  const [status, setStatus] = useState<Status>(
    review?.loading === true ? "loading" : "idle",
  );
  const [, startTransition] = useTransition();
  const byId = new Map(people.map((person) => [person.userId, person]));
  const filtered =
    (fixedMember === undefined && filters.member !== undefined) ||
    filters.kind !== undefined ||
    filters.fromDay !== undefined ||
    filters.toDay !== undefined;

  const read = (next: ActivityFilters, after?: string) => {
    setStatus(after === undefined ? "loading" : "more");
    startTransition(async () => {
      const out = await activityAction(activityQuery(next, after));
      setStatus("idle");
      if (!out.ok) {
        if (out.denied) {
          setDenied(true);
          onDenied?.();
        }
        setFailed(out.message);
        return;
      }
      setFailed(null);
      setItems((current) =>
        after === undefined ? out.value.items : [...current, ...out.value.items],
      );
      setCursor(out.value.nextCursor);
    });
  };

  const choose = (change: ActivityFilters) => {
    const next = { ...filters, ...change };
    setFilters(next);
    read(next);
  };

  if (denied) {
    return (
      <p className="m-0 text-sm text-(--cq-text-secondary)" role="alert">
        {t("Only admins and owners see this.")}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3" data-activity-feed>
      <form
        className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4"
        aria-label={t("Filter activity")}
        onSubmit={(event) => {
          event.preventDefault();
        }}
      >
        {fixedMember === undefined && people.length > 0 ? (
          <label className="flex flex-col gap-1 text-[13px] text-(--cq-text-secondary)">
            {t("Person")}
            <select
              className={fieldClassName}
              value={filters.member ?? ""}
              onChange={(event) => {
                choose({ member: event.target.value || undefined });
              }}
              data-activity-filter="member"
            >
              <option value="">{t("Everyone")}</option>
              {people.map((person) => (
                <option key={person.userId} value={person.userId}>
                  {person.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="flex flex-col gap-1 text-[13px] text-(--cq-text-secondary)">
          {t("Kind")}
          <select
            className={fieldClassName}
            value={filters.kind ?? ""}
            onChange={(event) => {
              const value = event.target.value;
              choose({
                kind: ACTIVITY_KINDS.find((kind) => kind === value),
              });
            }}
            data-activity-filter="kind"
          >
            <option value="">{t("Everything")}</option>
            {ACTIVITY_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {t(KIND_WORD[kind])}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[13px] text-(--cq-text-secondary)">
          {t("From")}
          <input
            type="date"
            className={fieldClassName}
            value={filters.fromDay ?? ""}
            max={filters.toDay}
            onChange={(event) => {
              choose({ fromDay: event.target.value || undefined });
            }}
            data-activity-filter="from"
          />
        </label>
        <label className="flex flex-col gap-1 text-[13px] text-(--cq-text-secondary)">
          {t("To")}
          <input
            type="date"
            className={fieldClassName}
            value={filters.toDay ?? ""}
            min={filters.fromDay}
            onChange={(event) => {
              choose({ toDay: event.target.value || undefined });
            }}
            data-activity-filter="to"
          />
        </label>
      </form>

      <div aria-live="polite" aria-busy={status === "loading"}>
        {status === "loading" ? (
          <ActivitySkeleton />
        ) : failed !== null && items.length === 0 ? (
          <div
            className="flex flex-col items-start gap-3 py-6"
            data-activity-state="error"
          >
            <p className="m-0 flex items-center gap-2 text-[15px] text-(--cq-text-primary)">
              <CircleAlert
                aria-hidden="true"
                size={ICON_SIZE.regular}
                strokeWidth={ICON_STROKE}
                className="text-(--cq-text-secondary)"
              />
              {t(failed)}
            </p>
            <button
              type="button"
              className={accountButton("secondary", "sm")}
              onClick={() => {
                read(filters);
              }}
            >
              {t("Try again")}
            </button>
          </div>
        ) : items.length === 0 ? (
          filtered ? (
            <div
              className="flex flex-col items-start gap-3 py-6"
              data-activity-state="filtered-empty"
            >
              <p className="m-0 text-[15px] text-(--cq-text-secondary)">
                {t("Nothing matches these filters.")}
              </p>
              <button
                type="button"
                className={accountButton("secondary", "sm")}
                onClick={() => {
                  const cleared: ActivityFilters =
                    fixedMember === undefined ? {} : { member: fixedMember };
                  setFilters(cleared);
                  read(cleared);
                }}
              >
                {t("Clear filters")}
              </button>
            </div>
          ) : (
            <p
              className="m-0 max-w-[60ch] py-6 text-[15px] text-(--cq-text-secondary)"
              data-activity-state="empty"
            >
              {fixedMember === undefined
                ? t(
                    "Nothing has happened here yet. When anyone on the team acts, or Q acts with their approval, it shows here.",
                  )
                : t("They haven't done anything here yet.")}
            </p>
          )
        ) : (
          <ol className="m-0 flex list-none flex-col p-0" data-activity-list>
            {items.map((item) => (
              <ActivityRow
                key={item.id}
                item={item}
                person={
                  item.actor.userId === null
                    ? undefined
                    : byId.get(item.actor.userId)
                }
                linkPerson={fixedMember === undefined}
              />
            ))}
          </ol>
        )}
      </div>

      {status !== "loading" && items.length > 0 ? (
        <div className="flex flex-col items-start gap-2">
          {failed === null ? null : (
            <p className="m-0 text-sm text-(--cq-text-secondary)" role="alert">
              {t(failed)}
            </p>
          )}
          {cursor === null ? (
            <p className="m-0 text-[13px] text-(--cq-text-tertiary)">
              {t("That's everything.")}
            </p>
          ) : (
            <button
              type="button"
              className={accountButton("secondary", "sm")}
              disabled={status === "more"}
              onClick={() => {
                read(filters, cursor);
              }}
              data-activity-more
            >
              {status === "more" ? t("Loading…") : t("Show more")}
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}

function ActorMark({
  item,
  person,
}: {
  readonly item: ActivityItemDto;
  readonly person: ActivityPerson | undefined;
}) {
  switch (item.actor.type) {
    case "Q":
      return <QMark size="lg" className="mt-0.5" />;
    case "PERSON":
      return (
        <Avatar
          name={person?.name ?? item.actor.display}
          size="md"
          className="mt-0.5 size-10!"
          src={person?.avatarUrl ?? undefined}
        />
      );
    case "CAPITAL_Q":
    case "CONNECTED_SYSTEM":
      return (
        <span
          aria-hidden="true"
          className="mt-0.5 grid size-10 shrink-0 place-items-center rounded-full border border-(--cq-border-subtle) bg-(--cq-surface-subtle) text-(--cq-text-secondary)"
        >
          <Building2 size={ICON_SIZE.regular} strokeWidth={ICON_STROKE} />
        </span>
      );
  }
}

export function ActivityRow({
  item,
  person,
  linkPerson = true,
  now,
}: {
  readonly item: ActivityItemDto;
  readonly person?: ActivityPerson | undefined;
  /** Off on a member's own page: their name would link to itself. */
  readonly linkPerson?: boolean | undefined;
  readonly now?: Date | undefined;
}) {
  const t = useT();
  const actorUserId = item.actor.userId;
  const name =
    linkPerson && item.actor.type === "PERSON" && actorUserId !== null ? (
      <Link
        href={`/settings/team/${actorUserId}`}
        className="font-semibold text-(--cq-text-primary) underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring)"
      >
        {item.actor.display}
      </Link>
    ) : (
      <b className="font-semibold text-(--cq-text-primary)">
        {t(item.actor.display)}
      </b>
    );
  const change = item.change;
  return (
    <li
      className="grid grid-cols-[auto_minmax(0,1fr)] gap-3.5 border-t border-(--cq-border-subtle) py-3.5 first:border-t-0"
      data-activity-item={item.actor.type}
      data-activity-outcome={item.outcome}
    >
      <ActorMark item={item} person={person} />
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="min-w-0 text-[15px]">{name}</span>
          <time
            dateTime={item.at}
            className="ms-auto text-xs whitespace-nowrap text-(--cq-text-tertiary)"
            title={t(dayWords(item.at))}
          >
            {t(whenWords(item.at, now))}
          </time>
        </div>
        <p className="m-0 text-sm text-(--cq-text-secondary)">
          {t(item.action.words)}
          {" · "}
          {item.resource.link === null ? (
            <span className="text-(--cq-text-primary)">
              {t(item.resource.label)}
            </span>
          ) : (
            <Link
              href={item.resource.link}
              className="text-(--cq-text-primary) underline underline-offset-4"
            >
              {t(item.resource.label)}
            </Link>
          )}
        </p>
        {change === null ? null : (
          <p
            className="m-0 flex flex-wrap items-center gap-1.5 text-[13px] text-(--cq-text-secondary)"
            data-activity-change
          >
            {change.before === null ? (
              <span>{t("Set to")}</span>
            ) : (
              <>
                <span className="sr-only">{t("From")}</span>
                <span className="text-(--cq-text-tertiary) line-through decoration-(--cq-text-tertiary)">
                  {t(change.before)}
                </span>
                <ChevronRight
                  aria-hidden="true"
                  size={ICON_SIZE.compact}
                  strokeWidth={ICON_STROKE}
                  className="rtl:rotate-180"
                />
                <span className="sr-only">{t("to")}</span>
              </>
            )}
            <span className="text-(--cq-text-primary)">
              {change.after === null ? t("Cleared") : t(change.after)}
            </span>
          </p>
        )}
        {item.outcome === "SUCCEEDED" ? null : (
          <p
            className="m-0 flex items-center gap-1.5 text-[13px] text-(--cq-text-primary)"
            data-activity-outcome-note
          >
            <CircleAlert
              aria-hidden="true"
              size={ICON_SIZE.compact}
              strokeWidth={ICON_STROKE}
              className="text-(--cq-text-secondary)"
            />
            {t(OUTCOME_WORD[item.outcome])}
          </p>
        )}
      </div>
    </li>
  );
}

export function ActivitySkeleton() {
  return (
    <ol
      className="m-0 flex list-none flex-col p-0"
      aria-hidden="true"
      data-activity-state="loading"
    >
      {[0, 1, 2, 3, 4].map((row) => (
        <li
          key={row}
          className={cx(
            "grid grid-cols-[auto_minmax(0,1fr)] gap-3.5 py-3.5",
            row === 0 ? null : "border-t border-(--cq-border-subtle)",
          )}
        >
          <span className="size-10 rounded-full bg-(--cq-surface-subtle) motion-safe:animate-pulse" />
          <span className="flex flex-col gap-2 pt-1">
            <span className="h-4 w-1/3 rounded bg-(--cq-surface-subtle) motion-safe:animate-pulse" />
            <span className="h-3 w-2/3 rounded bg-(--cq-surface-subtle) motion-safe:animate-pulse" />
          </span>
        </li>
      ))}
    </ol>
  );
}
