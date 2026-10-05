import Link from "next/link";

import type {
  QRehearsalListDto,
  QRehearsalPartnersDto,
} from "@capital-q/contracts";
import { cx } from "@capital-q/ui";
import { buttonClassName } from "@capital-q/ui/button";
import { ChevronRight, ICON_SIZE } from "@capital-q/ui/icons";

import { EntityAvatar } from "@/features/entity/entity-avatar";

import { OUTCOME_WORDS } from "./meet";
import { ScoreTrend } from "./score-trend";

/**
 * The Rehearsals page (founder critique 2026-10-05): starting a rehearsal
 * is the first thing, the person picked by face; then how the scores are
 * going; then every past rehearsal, filterable by person, each opening its
 * review. UI only: the rehearsal itself (lobby, room, review) is unchanged.
 */

type Counterpart = QRehearsalPartnersDto["people"][number]["counterpart"];

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

function Avatar({
  counterpart,
  size,
}: {
  readonly counterpart: Counterpart;
  readonly size: "sm" | "lg";
}) {
  return counterpart.kind === "COMPANY" ? (
    <EntityAvatar
      kind="company"
      name={counterpart.name}
      companyId={counterpart.id}
      size={size}
      decorative
    />
  ) : (
    <EntityAvatar
      kind="investor"
      name={counterpart.name}
      investorOrganisationId={counterpart.id}
      size={size}
      decorative
    />
  );
}

const callTime = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

const shortDate = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

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

function signed(change: number): string {
  return change > 0 ? `+${String(change)}` : String(change);
}

export function RehearsalsHome({
  basePath,
  partners,
  history,
  allowance,
  withId,
}: {
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
  const other = partners.role === "FOUNDER" ? "investors" : "companies";
  const rehearsals = history?.rehearsals ?? [];
  const counts = new Map<string, number>();
  for (const item of rehearsals) {
    counts.set(item.counterpart.id, (counts.get(item.counterpart.id) ?? 0) + 1);
  }
  const upcomingIds = new Set(partners.upcoming.map((c) => c.counterpart.id));
  const people = partners.people.filter(
    (person) => !upcomingIds.has(person.counterpart.id),
  );
  const changes = scoreChanges(rehearsals);
  const scored = rehearsals
    .filter(
      (item): item is typeof item & { score: number } => item.score !== null,
    )
    .slice(0, 20)
    .reverse();
  const latest = scored[scored.length - 1];
  const latestChange =
    latest === undefined ? undefined : changes.get(latest.id);
  const names = new Map<string, string>();
  for (const item of rehearsals)
    names.set(item.counterpart.id, item.counterpart.name);
  const filter = withId !== null && names.has(withId) ? withId : null;
  const shown =
    filter === null
      ? rehearsals
      : rehearsals.filter((item) => item.counterpart.id === filter);
  const nothingToPick = partners.upcoming.length === 0 && people.length === 0;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 sm:gap-10">
      <header className="flex flex-col gap-1">
        <h1 className="cq-title-xl text-(--cq-text-primary)">Rehearsals</h1>
        {allowance === null ? null : (
          <p className="cq-body-sm text-(--cq-text-secondary)">
            {allowance.words}{" "}
            <Link
              href="/settings/plan"
              className="text-(--cq-text-primary) underline underline-offset-2"
            >
              {allowance.out ? "Change plan" : "See your plan"}
            </Link>
          </p>
        )}
      </header>

      <section aria-labelledby="start-title" className="flex flex-col gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 id="start-title" className="cq-title-sm text-(--cq-text-primary)">
            Start a rehearsal
          </h2>
          <p className="cq-body-sm text-(--cq-text-secondary)">
            Pick who to practise with. Q plays them by voice, then reviews the
            call.
          </p>
        </div>
        {nothingToPick ? (
          <div className="flex flex-col items-start gap-3 rounded-(--cq-radius-lg) border border-dashed border-(--cq-border) p-5">
            <p className="cq-body text-(--cq-text-primary)">
              Once you’re in touch with {other}, you can rehearse with any of
              them here.
            </p>
            <Link href="/discover" className={buttonClassName("primary")}>
              Find {other}
            </Link>
          </div>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {partners.upcoming.map((call) => (
              <li key={call.meetingId}>
                <Link
                  href={lobbyHref(call.counterpart, call.meetingId)}
                  className="group flex h-full min-h-44 flex-col gap-3 rounded-(--cq-radius-lg) border border-(--cq-accent) bg-(--cq-surface-raised) p-4 transition-transform duration-(--cq-motion-fast) active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring)"
                >
                  <Avatar counterpart={call.counterpart} size="lg" />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="cq-body line-clamp-2 font-medium text-(--cq-text-primary)">
                      {call.counterpart.name}
                    </span>
                    <span className="cq-caption text-(--cq-text-secondary)">
                      Call {callTime(call.startsAt)}
                    </span>
                  </span>
                  <span className="cq-body-sm mt-auto font-semibold text-(--cq-accent)">
                    Rehearse this call
                  </span>
                </Link>
              </li>
            ))}
            {people.map((person) => {
              const done = counts.get(person.counterpart.id) ?? 0;
              return (
                <li key={person.relationshipId}>
                  <Link
                    href={lobbyHref(person.counterpart)}
                    className="group flex h-full min-h-44 flex-col gap-3 rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface-raised) p-4 transition-[transform,border-color] duration-(--cq-motion-fast) hover:border-(--cq-border) active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring)"
                  >
                    <Avatar counterpart={person.counterpart} size="lg" />
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="cq-body line-clamp-2 font-medium text-(--cq-text-primary)">
                        {person.counterpart.name}
                      </span>
                      <span className="cq-caption text-(--cq-text-secondary)">
                        {person.lastRehearsal === null
                          ? "Not rehearsed yet"
                          : person.lastRehearsal.score === null
                            ? `${String(done)} ${done === 1 ? "rehearsal" : "rehearsals"}`
                            : `Last ${String(person.lastRehearsal.score)}${done > 1 ? ` · ${String(done)} rehearsals` : ""}`}
                      </span>
                    </span>
                    <span className="cq-body-sm mt-auto font-semibold text-(--cq-accent)">
                      Rehearse
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {latest === undefined || scored.length < 2 ? null : (
        <section
          aria-labelledby="trend-title"
          className="grid gap-4 rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface-raised) p-4 sm:grid-cols-[10rem_1fr] sm:items-center sm:p-5"
        >
          <div className="flex flex-col gap-0.5">
            <h2
              id="trend-title"
              className="cq-body-sm text-(--cq-text-secondary)"
            >
              Latest score
            </h2>
            <p className="text-[2.25rem] leading-none font-semibold tabular-nums text-(--cq-text-primary)">
              {latest.score}
            </p>
            <p className="cq-caption text-(--cq-text-secondary)">
              {latestChange === undefined
                ? `with ${latest.counterpart.name}`
                : `${signed(latestChange)} on your last with ${latest.counterpart.name}`}
            </p>
          </div>
          <ScoreTrend
            points={scored.map((item) => ({
              id: item.id,
              at: item.createdAt,
              name: item.counterpart.name,
              score: item.score,
            }))}
          />
        </section>
      )}

      <section aria-labelledby="history-title" className="flex flex-col gap-3">
        <h2 id="history-title" className="cq-title-sm text-(--cq-text-primary)">
          Past rehearsals
        </h2>
        {history === null ? (
          <p className="cq-body-sm text-(--cq-text-secondary)">
            Your past rehearsals couldn’t load just now.
          </p>
        ) : rehearsals.length === 0 ? (
          <p className="cq-body-sm text-(--cq-text-secondary)">
            Your rehearsals and their reviews will appear here.
          </p>
        ) : (
          <>
            {names.size < 2 ? null : (
              <nav
                aria-label="Filter by person"
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
                        aria-current={on ? "page" : undefined}
                        className={cx(
                          "cq-body-sm inline-flex min-h-11 items-center rounded-(--cq-radius-full) border px-3 focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring)",
                          on
                            ? "border-(--cq-text-primary) bg-(--cq-surface-strong) text-(--cq-text-primary)"
                            : "border-(--cq-border) text-(--cq-text-secondary) hover:text-(--cq-text-primary)",
                        )}
                      >
                        {name}
                      </Link>
                    );
                  },
                )}
              </nav>
            )}
            <ul className="flex flex-col divide-y divide-(--cq-border-subtle) border-y border-(--cq-border-subtle)">
              {shown.map((item) => {
                const change = changes.get(item.id);
                const outcome =
                  item.outcome === null
                    ? item.status === "ACTIVE"
                      ? "Not finished"
                      : "Finished"
                    : OUTCOME_WORDS[item.outcome];
                return (
                  <li key={item.id}>
                    <Link
                      href={`/rehearsals/r/${encodeURIComponent(item.id)}`}
                      className="flex min-h-16 items-center gap-3 px-1 py-2 hover:bg-(--cq-surface-subtle) focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring)"
                    >
                      <Avatar counterpart={item.counterpart} size="sm" />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="cq-body truncate text-(--cq-text-primary)">
                          {item.counterpart.name}
                        </span>
                        <span className="cq-caption truncate text-(--cq-text-secondary)">
                          {shortDate(item.createdAt)} · {outcome}
                        </span>
                      </span>
                      <span className="flex shrink-0 flex-col items-end">
                        {item.score === null ? (
                          <span className="cq-caption text-(--cq-text-secondary)">
                            No score
                          </span>
                        ) : (
                          <span className="cq-body font-semibold tabular-nums text-(--cq-text-primary)">
                            {item.score}
                          </span>
                        )}
                        {change === undefined ? null : (
                          <span className="cq-caption tabular-nums text-(--cq-text-secondary)">
                            {signed(change)}
                          </span>
                        )}
                      </span>
                      <ChevronRight
                        size={ICON_SIZE.regular}
                        aria-hidden="true"
                        className="shrink-0 text-(--cq-text-tertiary)"
                      />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}
