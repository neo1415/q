"use client";

import Link from "next/link";
import { useState } from "react";

import type {
  QRehearsalListDto,
  QRehearsalPartnersDto,
  QRehearsalSummaryDto,
  RehearsalDifficulty,
} from "@capital-q/contracts";
import { cx } from "@capital-q/ui";
import {
  CalendarDays,
  ChevronRight,
  CircleHelp,
  ICON_SIZE,
  Mic,
} from "@capital-q/ui/icons";

import { EntityAvatar } from "@/features/entity/entity-avatar";
import {
  WorkEmpty,
  WorkSheet,
  WorkTag,
  workButton,
} from "@/features/work/work-b-kit";
import { useT } from "@/features/i18n/language";

import { OUTCOME_WORDS } from "./meet";

/**
 * The Rehearsals tab (chosen design 2026-10-21, "Pick a person, past
 * reviews", near black): who to practise with first, each person opening a
 * lobby sheet that says it is a simulation; then every past rehearsal with
 * its review. Every state the system has is drawn: nobody to pick yet, a
 * booked call to rehearse, one still in progress, one ended while Q writes
 * the review, a review with first notes, a review ready, and one that
 * ended before anything was said. Scores are Q's review of the practice,
 * computed from the ratings, never of the company.
 */

type Counterpart = QRehearsalPartnersDto["people"][number]["counterpart"];
type Researched = NonNullable<QRehearsalPartnersDto["researched"]>[number];

export function lobbyHref(
  counterpart: Counterpart,
  meetingId?: string,
): string {
  const base =
    counterpart.kind === "COMPANY"
      ? `/rehearsals/company/${encodeURIComponent(counterpart.id)}`
      : `/rehearsals/investor/${encodeURIComponent(counterpart.id)}`;
  return meetingId === undefined
    ? base
    : `${base}?meeting=${encodeURIComponent(meetingId)}`;
}

/** Where a researched (demo-access) entity's lobby lives. */
export function researchedHref(entity: Researched): string {
  return entity.investorOrganisationId === null
    ? `/rehearsals/person/${encodeURIComponent(entity.externalPersonId)}`
    : `/rehearsals/investor/${encodeURIComponent(entity.investorOrganisationId)}`;
}

/** What Q plays, in words: the role, or the person's public priorities. */
export function researchedCaption(entity: Researched): string {
  return entity.roleLine === null
    ? "Research-informed simulation of their public priorities"
    : `Research-informed simulation: ${entity.roleLine}`;
}

/** Each finished score's change on the one before with the same person. */
export function scoreChanges(
  rehearsals: QRehearsalListDto["rehearsals"],
): ReadonlyMap<string, number> {
  const out = new Map<string, number>();
  const last = new Map<string, number>();
  const oldestFirst = [...rehearsals].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );
  for (const item of oldestFirst) {
    if (item.score === null) continue;
    const before = last.get(item.counterpart.id);
    if (before !== undefined) out.set(item.id, item.score - before);
    last.set(item.counterpart.id, item.score);
  }
  return out;
}

/** A 0-100 review score as the design writes it: out of 10, one decimal. */
export function outOfTen(score: number): string {
  return (Math.round(score) / 10).toFixed(1);
}

/** Add `difficulty` to a lobby address (the sheet's choice). */
export function withDifficulty(
  href: string,
  difficulty: RehearsalDifficulty,
): string {
  if (difficulty === "REALISTIC") return href;
  return `${href}${href.includes("?") ? "&" : "?"}difficulty=${difficulty}`;
}

/**
 * Where one past rehearsal stands, from what the list carries. A finished
 * one without a review is still being written unless it ended before the
 * person answered anything, which has nothing to review.
 */
export type PastState =
  "IN_PROGRESS" | "NOTHING_TO_REVIEW" | "WRITING" | "FIRST_NOTES" | "READY";

export function pastState(item: QRehearsalSummaryDto): PastState {
  if (item.status === "ACTIVE") return "IN_PROGRESS";
  const review = item.review?.state;
  if (review === "PROVISIONAL") return "FIRST_NOTES";
  if (review === "READY" || item.score !== null) return "READY";
  return item.exchanges === 0 ? "NOTHING_TO_REVIEW" : "WRITING";
}

const PAST_WORDS: Readonly<Record<PastState, string>> = {
  IN_PROGRESS: "In progress",
  NOTHING_TO_REVIEW: "Ended before you answered, nothing to review",
  WRITING: "Ended. Q is writing your review",
  FIRST_NOTES: "First notes ready. Q is finishing the review",
  READY: "Review ready",
};

const dayMonth = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

const callTime = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

type Pick = {
  readonly key: string;
  readonly name: string;
  readonly line: string;
  readonly avatar: "company" | "investor";
  readonly companyId?: string | undefined;
  readonly investorOrganisationId?: string | undefined;
  readonly tag: {
    readonly tone: "stone" | "dash" | "accent";
    readonly words: string;
  };
  readonly href: string;
  readonly simulation: string;
  readonly call?: string | undefined;
};

function Avatar({
  pick,
  size,
}: {
  readonly pick: Pick;
  readonly size: "sm" | "lg";
}) {
  return pick.avatar === "company" ? (
    <EntityAvatar
      kind="company"
      name={pick.name}
      companyId={pick.companyId}
      size={size}
      decorative
    />
  ) : (
    <EntityAvatar
      kind="investor"
      name={pick.name}
      investorOrganisationId={pick.investorOrganisationId}
      size={size}
      decorative
    />
  );
}

const DIFFICULTIES: readonly {
  readonly value: RehearsalDifficulty;
  readonly label: string;
}[] = [
  { value: "GENTLE", label: "Gentle" },
  { value: "REALISTIC", label: "Realistic" },
  { value: "TOUGH", label: "Tough" },
];

export function RehearsalsHome({
  basePath,
  partners,
  history,
  allowance,
  withId,
  titled = true,
}: {
  /**
   * False under Work's header (owner 2026-10-18), whose h1 is "Work" and
   * whose Rehearsals tab names the page: no second h1.
   */
  readonly titled?: boolean;
  readonly basePath: string;
  readonly partners: QRehearsalPartnersDto & {
    readonly role: "FOUNDER" | "INVESTOR";
  };
  /** Null when the history couldn't be read. */
  readonly history: QRehearsalListDto | null;
  /** What the plan leaves this month, in words, or null. */
  readonly allowance: { readonly words: string; readonly out: boolean } | null;
  /** History filtered to one person (their counterpart id). */
  readonly withId: string | null;
}) {
  const t = useT();
  const [open, setOpen] = useState<Pick | null>(null);
  const [review, setReview] = useState<QRehearsalSummaryDto | null>(null);
  const [difficulty, setDifficulty] =
    useState<RehearsalDifficulty>("REALISTIC");
  const other = partners.role === "FOUNDER" ? "investors" : "companies";
  const rehearsals = history?.rehearsals ?? [];
  const upcomingIds = new Set(partners.upcoming.map((c) => c.counterpart.id));
  const changes = scoreChanges(rehearsals);
  const live = rehearsals.find((item) => item.status === "ACTIVE") ?? null;

  const counterpartPick = (counterpart: Counterpart) => ({
    name: counterpart.name,
    avatar:
      counterpart.kind === "COMPANY"
        ? ("company" as const)
        : ("investor" as const),
    companyId: counterpart.kind === "COMPANY" ? counterpart.id : undefined,
    investorOrganisationId:
      counterpart.kind === "COMPANY" ? undefined : counterpart.id,
    simulation:
      "Q plays them from their profile, what they have shared with you and public sources. It is Q playing them, not them.",
  });

  const picks: Pick[] = [
    ...partners.upcoming.map((call) => ({
      key: `call-${call.meetingId}`,
      ...counterpartPick(call.counterpart),
      line: call.purpose.length > 0 ? call.purpose : "Your booked call",
      tag: {
        tone: "accent" as const,
        words: `Call ${callTime(call.startsAt)}`,
      },
      href: lobbyHref(call.counterpart, call.meetingId),
      call: callTime(call.startsAt),
    })),
    ...partners.people
      .filter((person) => !upcomingIds.has(person.counterpart.id))
      .map((person) => ({
        key: person.relationshipId,
        ...counterpartPick(person.counterpart),
        line:
          partners.role === "FOUNDER"
            ? "An investor you’re talking to"
            : "A company you’re talking to",
        tag:
          person.lastRehearsal === null
            ? { tone: "dash" as const, words: "Not rehearsed yet" }
            : {
                tone: "stone" as const,
                words: `Rehearsed ${dayMonth(person.lastRehearsal.at)}`,
              },
        href: lobbyHref(person.counterpart),
      })),
    ...(partners.researched ?? []).map((entity) => {
      const last = rehearsals.find(
        (item) =>
          item.counterpart.id ===
          (entity.investorOrganisationId ?? entity.externalPersonId),
      );
      return {
        key: entity.externalPersonId,
        name: entity.name,
        avatar: "investor" as const,
        investorOrganisationId: entity.investorOrganisationId ?? undefined,
        line: researchedCaption(entity),
        tag:
          last === undefined
            ? { tone: "dash" as const, words: "Not rehearsed yet" }
            : {
                tone: "stone" as const,
                words: `Rehearsed ${dayMonth(last.createdAt)}`,
              },
        href: researchedHref(entity),
        simulation: `${researchedCaption(entity)}. It is Q playing them, not them. No connection or request is needed.`,
      };
    }),
  ];

  const names = new Map<string, string>();
  for (const item of rehearsals)
    names.set(item.counterpart.id, item.counterpart.name);
  const filter = withId !== null && names.has(withId) ? withId : null;
  const shown =
    filter === null
      ? rehearsals
      : rehearsals.filter((item) => item.counterpart.id === filter);

  const choose = (pick: Pick) => {
    setDifficulty("REALISTIC");
    setOpen(pick);
  };

  return (
    <div className="cq-ink flex max-w-[980px] flex-col gap-[18px]">
      {titled ? (
        <h1 className="cq-title-xl text-(--cq-text-primary)">
          {t("Rehearsals")}
        </h1>
      ) : null}

      {live === null ? null : (
        <div
          className="flex flex-wrap items-center gap-3 rounded-(--cq-radius-lg) bg-[var(--cq-tile)] px-4 py-3 text-[var(--cq-on-tile)]"
          role="status"
          data-rehearsal-live
        >
          <Mic size={ICON_SIZE.regular} aria-hidden="true" />
          <span className="min-w-0 flex-1 text-sm">
            {t(`Your rehearsal with ${live.counterpart.name} is still open.`)}
          </span>
          <Link
            href={`/rehearsals/live/${encodeURIComponent(live.id)}`}
            className={workButton(
              "secondary",
              "border-transparent bg-[var(--cq-on-tile)] text-[var(--cq-tile)]",
              "small",
            )}
          >
            {t("Rejoin")}
          </Link>
        </div>
      )}

      <div
        className="flex flex-wrap items-center gap-3"
        data-qp-anchor="fdr.14.rehearsals.start"
      >
        <h2 className="m-0 min-w-0 flex-1 text-xl font-semibold tracking-[-0.01em] text-(--cq-text-primary)">
          {t("Who do you want to practise with?")}
        </h2>
        {allowance === null ? null : (
          <span className="inline-flex flex-wrap items-center gap-2">
            <WorkTag tone={allowance.out ? "warning" : "stone"}>
              {t(allowance.words)}
            </WorkTag>
            {allowance.out ? (
              <Link
                href="/settings/plan"
                className="text-[13px] text-(--cq-text-primary) underline underline-offset-2"
              >
                {t("Change plan")}
              </Link>
            ) : null}
          </span>
        )}
      </div>

      {picks.length === 0 ? (
        <WorkEmpty
          title={t(`No ${other} to practise with yet`)}
          icon={<Mic size={ICON_SIZE.prominent} aria-hidden="true" />}
          action={
            <Link href="/discover" className={workButton("primary")}>
              {t(`Find ${other}`)}
            </Link>
          }
          data-rehearsals-empty
        >
          {t(
            `Once you’re in touch with ${other}, you can rehearse with any of them here.`,
          )}
        </WorkEmpty>
      ) : (
        <ul
          className="m-0 grid list-none grid-cols-2 gap-2.5 p-0 md:grid-cols-4 md:gap-3.5"
          aria-label={t("People to practise with")}
        >
          {picks.map((pick) => (
            <li key={pick.key}>
              <button
                type="button"
                onClick={() => choose(pick)}
                className="cq-crm-press cq-crm-lift flex h-full min-h-[150px] w-full flex-col items-start gap-1.5 rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface-raised) p-3.5 text-start hover:border-(--cq-border) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--cq-focus-ring) md:min-h-[168px] md:p-4"
                data-rehearse-pick={pick.key}
              >
                <span className="mb-1.5">
                  <Avatar pick={pick} size="lg" />
                </span>
                <b className="line-clamp-2 text-[15px] text-(--cq-text-primary)">
                  {pick.name}
                </b>
                <span className="line-clamp-2 text-xs text-(--cq-text-tertiary)">
                  {t(pick.line)}
                </span>
                <WorkTag
                  tone={pick.tag.tone}
                  className="mt-auto whitespace-normal"
                  icon={
                    pick.call === undefined ? undefined : (
                      <CalendarDays aria-hidden="true" />
                    )
                  }
                >
                  {t(pick.tag.words)}
                </WorkTag>
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="m-0 flex items-start gap-2 text-xs text-(--cq-text-tertiary)">
        <CircleHelp size={14} aria-hidden="true" className="mt-px flex-none" />
        {t(
          "Q plays each person from what it can read about them. It is Q playing them, not them.",
        )}
      </p>

      <section
        aria-labelledby="history-title"
        className="flex flex-col gap-2.5"
        data-qp-anchor="fdr.14.rehearsals.history"
      >
        <div className="flex items-baseline gap-2.5">
          <h2
            id="history-title"
            className="m-0 text-lg font-semibold tracking-[-0.01em] text-(--cq-text-primary)"
          >
            {t("Past rehearsals")}
          </h2>
          <span className="ms-auto text-xs text-(--cq-text-tertiary)">
            {t("Newest first")}
          </span>
        </div>
        {names.size < 2 ? null : (
          <nav
            aria-label={t("Filter by person")}
            className="flex flex-wrap gap-2"
          >
            {[[null, "Everyone"] as const, ...[...names.entries()]].map(
              ([id, name]) => {
                const on = filter === id;
                return (
                  <Link
                    key={id ?? "all"}
                    href={
                      id === null
                        ? basePath
                        : `${basePath}?with=${encodeURIComponent(id)}`
                    }
                    scroll={false}
                    aria-current={on ? "page" : undefined}
                    className={cx(
                      "inline-flex min-h-10 items-center rounded-full border px-3.5 text-[13px] focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring)",
                      on
                        ? "border-[var(--cq-tile)] bg-[var(--cq-tile)] text-[var(--cq-on-tile)]"
                        : "border-(--cq-border) bg-(--cq-surface-raised) text-(--cq-text-secondary) hover:text-(--cq-text-primary)",
                    )}
                  >
                    {t(name)}
                  </Link>
                );
              },
            )}
          </nav>
        )}
        {history === null ? (
          <p className="m-0 text-sm text-(--cq-text-secondary)" role="status">
            {t("Your past rehearsals couldn’t load just now.")}
          </p>
        ) : rehearsals.length === 0 ? (
          <WorkEmpty title={t("No rehearsals yet")} data-past-empty>
            {t(
              "Your rehearsals and their reviews will appear here, newest first.",
            )}
          </WorkEmpty>
        ) : (
          <ul className="m-0 flex list-none flex-col overflow-hidden rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface-raised) p-0">
            {shown.map((item, index) => {
              const state = pastState(item);
              const change = changes.get(item.id);
              const detail =
                state === "READY" && item.review?.workOn
                  ? `${dayMonth(item.createdAt)}. Work on: ${item.review.workOn}`
                  : `${dayMonth(item.createdAt)}. ${PAST_WORDS[state]}${
                      item.outcome === null || state !== "READY"
                        ? ""
                        : `, ${OUTCOME_WORDS[item.outcome].toLowerCase()}`
                    }`;
              return (
                <li
                  key={item.id}
                  className={cx(
                    index > 0 && "border-t border-(--cq-border-subtle)",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => setReview(item)}
                    className="flex min-h-16 w-full items-center gap-3 px-4 py-3 text-start hover:bg-(--cq-surface-subtle) focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--cq-focus-ring)"
                    data-past={state}
                  >
                    <ScorePill item={item} state={state} />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <b className="truncate text-[15px] font-medium text-(--cq-text-primary)">
                        {item.counterpart.name}
                      </b>
                      <span className="text-[13px] text-(--cq-text-tertiary)">
                        {t(detail)}
                        {change === undefined
                          ? ""
                          : t(
                              ` (${change > 0 ? "+" : ""}${outOfTen(change)} on the last)`,
                            )}
                      </span>
                    </span>
                    <ChevronRight
                      size={ICON_SIZE.regular}
                      aria-hidden="true"
                      className="flex-none text-(--cq-text-tertiary) rtl:rotate-180"
                    />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {rehearsals.length === 0 ? null : (
          <p className="m-0 text-xs text-(--cq-text-tertiary)">
            {t(
              "Scores are Q’s review of each rehearsal, out of 10, from its ratings. They describe the practice, not your company.",
            )}
          </p>
        )}
      </section>

      <WorkSheet
        open={open !== null}
        onOpenChange={(next) => {
          if (!next) setOpen(null);
        }}
        tone="ink"
        title={open === null ? "" : t(`Rehearse with ${open.name}`)}
        sub={open === null ? undefined : t(open.line)}
        icon={open === null ? undefined : <Avatar pick={open} size="sm" />}
        footer={
          open === null ? null : (
            <>
              {allowance?.out === true ? (
                <Link href="/settings/plan" className={workButton("primary")}>
                  {t("Change plan")}
                </Link>
              ) : (
                <Link
                  href={withDifficulty(open.href, difficulty)}
                  className={workButton("primary")}
                  data-rehearse-start
                >
                  <Mic size={ICON_SIZE.compact} aria-hidden="true" />
                  {t("Start rehearsal")}
                </Link>
              )}
              <button
                type="button"
                onClick={() => setOpen(null)}
                className={workButton("quiet")}
              >
                {t("Not now")}
              </button>
            </>
          )
        }
        data-rehearse-lobby
      >
        {open === null ? null : (
          <>
            <p className="m-0 flex items-start gap-2 rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface-subtle) px-3 py-2.5 text-sm text-(--cq-text-secondary)">
              <CircleHelp
                size={14}
                aria-hidden="true"
                className="mt-0.5 flex-none"
              />
              {t(open.simulation)}
            </p>
            {open.call === undefined ? null : (
              <p className="m-0 text-sm text-(--cq-text-primary)">
                {t(`For your call on ${open.call}.`)}
              </p>
            )}
            <span className="text-xs text-(--cq-text-tertiary)">
              {t("How hard should they push?")}
            </span>
            <div
              role="radiogroup"
              aria-label={t("How hard should they push?")}
              className="flex flex-wrap gap-2"
            >
              {DIFFICULTIES.map((choice) => (
                <button
                  key={choice.value}
                  type="button"
                  role="radio"
                  aria-checked={difficulty === choice.value}
                  onClick={() => setDifficulty(choice.value)}
                  className={cx(
                    "inline-flex min-h-10 items-center rounded-full border px-3.5 text-[13px] font-medium focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring)",
                    difficulty === choice.value
                      ? "border-[var(--cq-tile)] bg-[var(--cq-tile)] text-[var(--cq-on-tile)]"
                      : "border-(--cq-border) text-(--cq-text-secondary) hover:text-(--cq-text-primary)",
                  )}
                >
                  {t(choice.label)}
                </button>
              ))}
            </div>
            <span className="text-xs text-(--cq-text-tertiary)">
              {allowance === null
                ? t(
                    "By voice, until a natural close. You can end it at any time.",
                  )
                : t(
                    `${allowance.words} By voice, until a natural close. You can end it at any time.`,
                  )}
            </span>
          </>
        )}
      </WorkSheet>

      <WorkSheet
        open={review !== null}
        onOpenChange={(next) => {
          if (!next) setReview(null);
        }}
        tone="ink"
        title={t("Review")}
        footer={
          review === null ? null : review.status === "ACTIVE" ? (
            <Link
              href={`/rehearsals/live/${encodeURIComponent(review.id)}`}
              className={workButton("primary")}
            >
              {t("Rejoin")}
            </Link>
          ) : (
            <Link
              href={`/rehearsals/r/${encodeURIComponent(review.id)}`}
              className={workButton("primary")}
              data-open-review
            >
              {t("Open the full review")}
            </Link>
          )
        }
        data-past-review
      >
        {review === null ? null : <PastReview item={review} />}
      </WorkSheet>
    </div>
  );
}

function ScorePill({
  item,
  state,
}: {
  readonly item: QRehearsalSummaryDto;
  readonly state: PastState;
}) {
  const t = useT();
  return item.score !== null ? (
    <span className="inline-grid h-8 min-w-[46px] flex-none place-items-center rounded-full bg-(--cq-accent-soft) text-sm font-semibold text-(--cq-accent) tabular-nums">
      {outOfTen(item.score)}
    </span>
  ) : (
    <span
      className="inline-grid h-8 min-w-[46px] flex-none place-items-center rounded-full border border-dashed border-(--cq-border) px-2 text-[11px] text-(--cq-text-tertiary)"
      aria-label={t(PAST_WORDS[state])}
    >
      {state === "IN_PROGRESS" ? (
        <Mic size={14} aria-hidden="true" />
      ) : (
        t("No score")
      )}
    </span>
  );
}

function PastReview({ item }: { readonly item: QRehearsalSummaryDto }) {
  const t = useT();
  const state = pastState(item);
  return (
    <div className="cq-crm-swap flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <span className="text-xs text-(--cq-text-tertiary)">
            {t(`${dayMonth(item.createdAt)}, with ${item.counterpart.name}`)}
          </span>
          {item.score === null ? (
            <p className="m-0 mt-1 text-[17px] font-semibold text-(--cq-text-primary)">
              {t(PAST_WORDS[state])}
            </p>
          ) : (
            <p className="m-0 text-[28px] font-semibold tracking-[-0.02em] text-(--cq-text-primary) tabular-nums">
              {outOfTen(item.score)}{" "}
              <small className="text-[13px] font-normal tracking-normal text-(--cq-text-tertiary)">
                {t("out of 10, Q’s review score")}
              </small>
            </p>
          )}
        </div>
      </div>
      {state === "READY" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <span className="text-xs text-(--cq-text-tertiary)">
              {t("Went well")}
            </span>
            <p className="m-0 mt-1 text-[15px] text-(--cq-text-primary)">
              {item.review?.wentWell ?? t("Nothing singled out.")}
            </p>
          </div>
          <div>
            <span className="text-xs text-(--cq-text-tertiary)">
              {t("Work on")}
            </span>
            <p className="m-0 mt-1 text-[15px] text-(--cq-text-primary)">
              {item.review?.workOn ?? t("Nothing singled out.")}
            </p>
          </div>
        </div>
      ) : (
        <p className="m-0 text-sm text-(--cq-text-secondary)">
          {state === "IN_PROGRESS"
            ? t("It is still open. Rejoin to carry on, or end it there.")
            : state === "NOTHING_TO_REVIEW"
              ? t(
                  "You left before answering anything, so there’s nothing to review.",
                )
              : state === "FIRST_NOTES"
                ? t(
                    "Q has written first notes from the transcript and is finishing the full review.",
                  )
                : t(
                    "Q is writing your review. It appears here when it’s ready.",
                  )}
        </p>
      )}
    </div>
  );
}
