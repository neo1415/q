import type { Metadata } from "next";
import Link from "next/link";

import {
  getMyPlan,
  getRehearsalPartners,
  listRehearsals,
} from "@capital-q/api-client";
import { buttonClassName } from "@capital-q/ui/button";
import { CalendarDays, ChevronRight, ICON_SIZE } from "@capital-q/ui/icons";
import { EmptyState } from "@capital-q/ui/states";

import { PageContainer } from "@/components/app-shell/page-container";
import { remainingOf, unitsOf } from "@/features/billing/plan-words";
import { apiSession, qApiSession } from "@/features/q/context";
import { OUTCOME_WORDS, initialsOf } from "@/features/rehearsal/meet";

export const metadata: Metadata = { title: "Rehearsals" };
export const dynamic = "force-dynamic";

/**
 * Rehearsals (REHEARSE, founder direction 2026-10-01): upcoming calls to
 * rehearse first, the people you're connected to, and every past
 * rehearsal with its review. Q plays the other person. How many a month
 * is the account's plan (BILLING, ADR 0034); the page says what is left.
 */

function lobbyHref(
  kind: "INVESTOR_ORGANISATION" | "COMPANY",
  id: string,
  meetingId?: string,
): string {
  const base =
    kind === "COMPANY"
      ? `/rehearsals/company/${encodeURIComponent(id)}`
      : `/rehearsals/investor/${encodeURIComponent(id)}`;
  return meetingId === undefined
    ? base
    : `${base}?meeting=${encodeURIComponent(meetingId)}`;
}

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });

export default async function RehearsalsPage() {
  const [session, billingSession] = await Promise.all([
    qApiSession(),
    apiSession(),
  ]);
  const [partners, history, plan] =
    session === null
      ? [null, null, null]
      : await Promise.all([
          getRehearsalPartners(session).catch(() => null),
          listRehearsals(session).catch(() => null),
          billingSession === null
            ? null
            : getMyPlan(billingSession).catch(() => null),
        ]);
  // BILLING block: what the plan leaves this month, said in words.
  const allowance =
    plan?.features.find((feature) => feature.key === "q.rehearsals") ?? null;
  const left = allowance === null ? null : remainingOf(allowance);
  // end BILLING block

  if (partners === null) {
    return (
      <PageContainer>
        <EmptyState
          title="Rehearsals couldn't load."
          description="Try again in a moment."
          action={
            <Link href="/rehearsals" className={buttonClassName("secondary")}>
              Try again
            </Link>
          }
        />
      </PageContainer>
    );
  }
  if (partners.role === null) {
    return (
      <PageContainer>
        <EmptyState
          title="Rehearsals are for founders and investors."
          description="Finish setting up your company or your fund, then rehearse your meetings here."
          action={
            <Link href="/home" className={buttonClassName("secondary")}>
              Go to Q
            </Link>
          }
        />
      </PageContainer>
    );
  }

  const other = partners.role === "FOUNDER" ? "investors" : "companies";
  return (
    <PageContainer>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-10">
        <header className="flex flex-col gap-2">
          <h1 className="cq-title-xl text-(--cq-text-primary)">Rehearsals</h1>
          <p className="cq-body text-(--cq-text-secondary)">
            Pick someone you’re meeting and rehearse the call. Q plays them by
            voice, from what you can see of them, then reviews how it went.
          </p>
          {allowance === null || left === null ? null : (
            <p className="cq-body-sm text-(--cq-text-secondary)">
              {left === 0
                ? `You've used this month's ${allowance.unitPlural} on your ${plan?.plan.name ?? ""} plan. `
                : `${String(left)} ${unitsOf(allowance, left)} left this month on your ${plan?.plan.name ?? ""} plan. `}
              <Link
                href="/settings/plan"
                className="underline underline-offset-2 text-(--cq-text-primary)"
              >
                See your plan
              </Link>
            </p>
          )}
        </header>

        {partners.upcoming.length === 0 ? null : (
          <section className="flex flex-col gap-3">
            <h2 className="cq-title-sm text-(--cq-text-primary)">
              Upcoming calls
            </h2>
            <ul className="flex flex-col divide-y divide-(--cq-border-subtle)">
              {partners.upcoming.map((call) => (
                <li
                  key={call.meetingId}
                  className="flex items-center justify-between gap-3 py-3"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <CalendarDays
                      size={ICON_SIZE.regular}
                      aria-hidden="true"
                      className="shrink-0 text-(--cq-text-tertiary)"
                    />
                    <div className="min-w-0">
                      <p className="cq-body truncate text-(--cq-text-primary)">
                        {call.counterpart.name}
                      </p>
                      <p className="cq-caption truncate text-(--cq-text-secondary)">
                        {when(call.startsAt)} · {call.purpose}
                      </p>
                    </div>
                  </div>
                  <Link
                    href={lobbyHref(
                      call.counterpart.kind,
                      call.counterpart.id,
                      call.meetingId,
                    )}
                    className={buttonClassName("primary", "compact")}
                  >
                    Rehearse
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="flex flex-col gap-3">
          <h2 className="cq-title-sm text-(--cq-text-primary)">
            People you’re connected to
          </h2>
          {partners.people.length === 0 ? (
            <div className="flex flex-col items-start gap-3">
              <p className="cq-body-sm text-(--cq-text-secondary)">
                Once you’re in touch with {other}, you can rehearse with any of
                them here.
              </p>
              <Link href="/discover" className={buttonClassName("secondary")}>
                Go to Discover
              </Link>
            </div>
          ) : (
            <ul className="flex flex-col divide-y divide-(--cq-border-subtle)">
              {partners.people.map((person) => (
                <li key={person.relationshipId}>
                  <Link
                    href={lobbyHref(
                      person.counterpart.kind,
                      person.counterpart.id,
                    )}
                    className="flex min-h-14 items-center justify-between gap-3 py-2 hover:bg-(--cq-surface-subtle)"
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <span className="cq-label flex size-9 shrink-0 items-center justify-center rounded-(--cq-radius-full) bg-(--cq-surface-subtle) text-(--cq-text-secondary)">
                        {initialsOf(person.counterpart.name)}
                      </span>
                      <span className="min-w-0">
                        <span className="cq-body block truncate text-(--cq-text-primary)">
                          {person.counterpart.name}
                        </span>
                        <span className="cq-caption block text-(--cq-text-secondary)">
                          {person.lastRehearsal === null
                            ? "Not rehearsed yet"
                            : `Last rehearsal ${new Date(person.lastRehearsal.at).toLocaleDateString()}${
                                person.lastRehearsal.score === null
                                  ? ""
                                  : ` · ${String(person.lastRehearsal.score)} / 100`
                              }`}
                        </span>
                      </span>
                    </span>
                    <ChevronRight
                      size={ICON_SIZE.regular}
                      aria-hidden="true"
                      className="shrink-0 text-(--cq-text-tertiary)"
                    />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="cq-title-sm text-(--cq-text-primary)">History</h2>
          {history === null || history.rehearsals.length === 0 ? (
            <p className="cq-body-sm text-(--cq-text-secondary)">
              {history === null
                ? "Your past rehearsals couldn't load just now."
                : "Your rehearsals and their reviews will appear here."}
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-(--cq-border-subtle)">
              {history.rehearsals.map((item) => (
                <li key={item.id}>
                  <Link
                    href={`/rehearsals/r/${encodeURIComponent(item.id)}`}
                    className="flex min-h-14 items-center justify-between gap-3 py-2 hover:bg-(--cq-surface-subtle)"
                  >
                    <span className="min-w-0">
                      <span className="cq-body block truncate text-(--cq-text-primary)">
                        {item.counterpart.name}
                      </span>
                      <span className="cq-caption block text-(--cq-text-secondary)">
                        {new Date(item.createdAt).toLocaleString()}
                        {" · "}
                        {item.outcome === null
                          ? item.status === "ACTIVE"
                            ? "Not finished"
                            : "Finished"
                          : OUTCOME_WORDS[item.outcome]}
                      </span>
                    </span>
                    <span className="cq-label shrink-0 text-(--cq-text-primary)">
                      {item.score === null ? "" : `${String(item.score)} / 100`}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </PageContainer>
  );
}
